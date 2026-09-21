# Part 12 — zod retrofit for existing routes

**Delivers:** validation on the highest-risk existing endpoints. **Separable** —
proctoring is complete without this, so it can be deferred if time is short.

**Files**
- Create: `src/lib/schemas/admin.ts`
- Modify: `src/app/api/admin/tests/route.ts`
- Modify: `src/app/api/admin/tests/[id]/route.ts`
- Modify: `src/app/api/admin/colleges/route.ts` and `[id]/route.ts`
- Modify: `src/app/api/admin/questions/route.ts` and `[id]/route.ts`
- Modify: `src/app/api/admin/job-openings/route.ts` and `[id]/route.ts`
- Modify: `src/lib/question-picker.ts` (consume the validated type only)
- Create: `tests/admin-validation.test.ts`

**Interfaces — Consumes:** Part 4 `parseBody`.

---

## Scope is bounded on purpose

The owner chose the bounded retrofit over all 47 routes. What is in:

1. **Admin write routes that pass `body` straight into Prisma.** Today
   `api/admin/colleges/route.ts` does `data: { name: body.name, ... }` with no
   validation — mass assignment is limited only by which fields happen to be
   listed, and a wrong type reaches Postgres as a driver error surfaced to the
   client as a 500 carrying `err.message`.
2. **`assessmentConfig`**, which is the highest-value target. It is written
   unvalidated (`api/admin/tests/route.ts:32`) and read as `any[]` by
   `pickQuestionsByConfig`. A malformed config is not caught at write time — it
   surfaces when a **candidate** tries to start a test and the paper cannot be
   built. That is a production incident during a live drive.

What is out: student attempt routes (already hardened by `sanitizeAnswers` and
the `require*` helpers), read-only GETs, and the import routes (they do
row-by-row validation already, and rewriting them is its own piece of work).

---

## Do not change behaviour while adding validation

Two traps:

- **`assessmentConfig` shape drift.** The schema comment says
  `{area, count, marks}`; the builder actually writes
  `{area, count, easyPct, mediumPct, hardPct}`. The schema must match what is
  **in the database**, not what the comment claims. Check real rows first.
- **Existing tests must still pass.** If a fixture sends something the new schema
  rejects, that is a finding about the schema being too strict, not a licence to
  loosen the test.

---

## Steps

- [ ] **Step 1: Look at what is actually stored before writing a schema**

```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.test.findMany({select:{id:true,title:true,assessmentConfig:true},take:10}).then(r=>{console.log(JSON.stringify(r,null,2));return p.\$disconnect()})"
```

Write the schema against these rows. If any existing row would fail it, decide
deliberately: loosen the schema, or migrate the data — do not ship something that
rejects rows already in production.

- [ ] **Step 2: Write `src/lib/schemas/admin.ts`**

```ts
import { z } from 'zod'
import { AREAS } from '@/lib/areas'

/**
 * Validation for admin write routes.
 *
 * These endpoints previously handed the request body straight to Prisma. The
 * damage that does is quiet: a wrong type reaches Postgres and returns a driver
 * error that the route then leaks to the client inside a 500.
 */

/**
 * One assessment area's share of a paper.
 *
 * The schema comment on Test.assessmentConfig says {area, count, marks}; the
 * builder writes {area, count, easyPct, mediumPct, hardPct}. This matches what
 * is in the database. Percentages are optional because older rows predate them.
 */
export const areaConfigSchema = z.object({
  area: z.enum(AREAS as unknown as [string, ...string[]]),
  count: z.number().int().min(0).max(500),
  easyPct: z.number().min(0).max(100).optional(),
  mediumPct: z.number().min(0).max(100).optional(),
  hardPct: z.number().min(0).max(100).optional(),
}).refine(
  c => {
    const given = [c.easyPct, c.mediumPct, c.hardPct].filter(v => v !== undefined)
    if (given.length === 0) return true          // legacy row, no mix specified
    if (given.length !== 3) return false         // partial mix is a bug
    return Math.abs((c.easyPct! + c.mediumPct! + c.hardPct!) - 100) < 0.01
  },
  { message: 'difficulty percentages must be absent entirely or sum to 100' }
)

export const assessmentConfigSchema = z.array(areaConfigSchema).min(1).max(20)

export const testCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullish(),
  durationMinutes: z.number().int().min(1).max(600),
  totalMarks: z.number().min(0).max(10_000),
  passingMarks: z.number().min(0).max(10_000),
  status: z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
  isWalkIn: z.boolean().optional(),
  isActive: z.boolean().optional(),
  jobOpeningId: z.string().nullish(),
  companyPptUrl: z.string().nullish(),
  proctoringEnabled: z.boolean().optional(),
  assessmentConfig: assessmentConfigSchema,
}).refine(t => t.passingMarks <= t.totalMarks, {
  message: 'passingMarks cannot exceed totalMarks',
  path: ['passingMarks'],
})

export const collegeWriteSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).nullish(),
  city: z.string().max(100).nullish(),
  state: z.string().max(100).nullish(),
  contactEmail: z.string().email().nullish().or(z.literal('')),
  contactPhone: z.string().max(32).nullish(),
  isActive: z.boolean().optional(),
})

export const questionWriteSchema = z.object({
  area: z.enum(AREAS as unknown as [string, ...string[]]),
  questionText: z.string().min(1).max(10_000),
  optionA: z.string().min(1).max(2000),
  optionB: z.string().min(1).max(2000),
  optionC: z.string().min(1).max(2000),
  optionD: z.string().min(1).max(2000),
  correctAnswer: z.enum(['A', 'B', 'C', 'D']),
  weightage: z.number().min(0).max(100).optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  isActive: z.boolean().optional(),
})
```

Note `correctAnswer: z.enum(['A','B','C','D'])`. Today nothing stops an admin
writing `"a"` or `"E"`, and `gradeAttempt` compares against
`correctAnswer.trim().toUpperCase()` — so `"E"` would silently mark every
candidate wrong on that question, with no error anywhere.

- [ ] **Step 3: Retrofit one route and confirm the shape**

Start with `src/app/api/admin/tests/route.ts`:

```ts
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await parseBody(req, testCreateSchema)
    const test = await prisma.test.create({ data: body })
    return NextResponse.json(test, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'Test create error', 'Could not create the test.')
  }
}
```

Three changes at once, and all three are the point: `requireAdmin` replaces the
inline check (403 where it should be 403), `parseBody` replaces raw `body`, and
`errorResponse` replaces the `err.message` leak.

- [ ] **Step 4: Retrofit the rest**, same pattern. Keep response shapes
      **byte-identical** — the admin pages parse them today. This is a validation
      change, not an API redesign.

- [ ] **Step 5: Tighten `pickQuestionsByConfig`**

It currently takes `any[]`. Change the parameter to the inferred type from
`areaConfigSchema` and remove the `as any[]` casts at the four call sites in the
student routes. Do **not** change its behaviour — this part adds types, it does
not touch paper selection.

- [ ] **Step 6: Write `tests/admin-validation.test.ts`**

```
- a valid test payload passes
- passingMarks > totalMarks is rejected
- an unknown assessment area is rejected
- difficulty percentages that do not sum to 100 are rejected
- percentages absent entirely are accepted (legacy rows)
- a partial mix (easyPct only) is rejected
- correctAnswer 'E' is rejected
- correctAnswer 'a' is rejected  <- lowercase would grade every candidate wrong
- an extra unexpected field is stripped, not passed through to Prisma
- every assessmentConfig currently in the local database validates
```

That last one is the important one:

```ts
it('accepts every assessmentConfig already in the database', async () => {
  const tests = await prisma.test.findMany({ select: { id: true, assessmentConfig: true } })
  for (const t of tests) {
    const r = assessmentConfigSchema.safeParse(t.assessmentConfig)
    // A schema that rejects live data is a schema that breaks the admin UI on
    // the next edit of an existing test.
    expect(r.success, `test ${t.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true)
  }
})
```

- [ ] **Step 7: Run everything**

```bash
npx vitest run tests/admin-validation.test.ts
```

```bash
npx tsc --noEmit -p tsconfig.json && npm test && npm run build
```

- [ ] **Step 8: Exercise the admin UI by hand**

Validation changes are exactly the kind that pass tests and break a form. With
`npm run dev`, at minimum: create a test, edit an existing test, create a
college, edit a question. Each must still work and still show useful errors.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "proctoring part 12: zod validation for high-risk admin write routes"
```

Do not push.

- [ ] **Step 10: Update `PROGRESS.md`** — list exactly which routes were
      retrofitted, so it is clear what remains on Convention A.

---

## Done when

- The listed admin write routes validate with zod and use `requireAdmin` +
  `errorResponse`.
- No admin route returns `err.message` to a client any more.
- Every `assessmentConfig` already in the database validates.
- Response shapes are unchanged and the admin UI still works, checked by hand.
