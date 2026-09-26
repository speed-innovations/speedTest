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

- [x] **Step 1: Look at what is actually stored before writing a schema**

```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.test.findMany({select:{id:true,title:true,assessmentConfig:true},take:10}).then(r=>{console.log(JSON.stringify(r,null,2));return p.\$disconnect()})"
```

Write the schema against these rows. If any existing row would fail it, decide
deliberately: loosen the schema, or migrate the data — do not ship something that
rejects rows already in production.

- [x] **Step 2: Write `src/lib/schemas/admin.ts`**

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

- [x] **Step 3: Retrofit one route and confirm the shape**

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

- [x] **Step 4: Retrofit the rest**, same pattern. Keep response shapes
      **byte-identical** — the admin pages parse them today. This is a validation
      change, not an API redesign.

- [x] **Step 5: Tighten `pickQuestionsByConfig`**

It currently takes `any[]`. Change the parameter to the inferred type from
`areaConfigSchema` and remove the `as any[]` casts at the four call sites in the
student routes. Do **not** change its behaviour — this part adds types, it does
not touch paper selection.

- [x] **Step 6: Write `tests/admin-validation.test.ts`**

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

- [x] **Step 7: Run everything**

```bash
npx vitest run tests/admin-validation.test.ts
```

```bash
npx tsc --noEmit -p tsconfig.json && npm test && npm run build
```

- [ ] **Step 8: Exercise the admin UI by hand** — **NOT DONE. Deferred to Part 14.**

  Attempted and abandoned for a real reason: running `npx next build` while the
  dev server is up overwrites the shared `.next`, and the dev server then serves
  HTML referencing chunk files that no longer exist (404s on every static asset,
  blank page). The server needs a restart, which is the owner's process.

  Covered instead by a stronger, deterministic substitute — see the new
  "payloads the admin forms actually send" block in
  `tests/admin-validation.test.ts`, which pins the exact body each real submit
  handler builds against its schema. That catches the failure this step exists
  to catch (a form shape the schema rejects) without a browser. What it does not
  cover is rendering and error display, which Part 14 must still do by hand.

Validation changes are exactly the kind that pass tests and break a form. With
`npm run dev`, at minimum: create a test, edit an existing test, create a
college, edit a question. Each must still work and still show useful errors.

- [x] **Step 9: Commit**

```bash
git add -A && git commit -m "proctoring part 12: zod validation for high-risk admin write routes"
```

Do not push.

- [x] **Step 10: Update `PROGRESS.md`** — list exactly which routes were
      retrofitted, so it is clear what remains on Convention A.

---

## Found while building this part

- **A real data-loss bug, now fixed.** `PUT /api/admin/tests/[id]` read
  `jobOpeningId: body.jobOpeningId || null`, so an omitted field became `null`.
  Every single-field PUT from the tests list — the walk-in toggle, and the
  proctoring toggle added in Part 10 — silently unlinked the test's job opening.
  Confirmed against the old code with a throwaway probe before changing
  anything: a PUT of `{proctoringEnabled: true}` left title, description and
  duration intact and set `jobOpeningId` to null. Now `undefined` means absent
  and only an explicit `null` clears it. Pinned by two tests.

- **`pickQuestionsByConfig` does NOT take `any[]`** — it already had a typed
  `AreaConfig` interface. The part file's Step 5 was wrong about that. More
  importantly the README forbids modifying `src/lib/question-picker.ts` at all,
  which contradicts this part's file list. Resolved by not touching it: the
  schema exports `AreaConfigInput` and the four student call sites use it in
  place of `as any[]`. Type-only, no runtime change, and deliberately **no
  parse at read time** — a legacy row must not start throwing for a candidate
  mid-drive. Strictness belongs on the write path, which is this part's thesis.

- **Both assessmentConfig shapes are live.** Three rows carry
  `{area, count, easyPct, mediumPct, hardPct}`; the oldest carries
  `{area, count, marks}` with no percentages. Nothing reads `marks`, but the
  schema keeps it rather than stripping it — silently rewriting a stored row as
  a side effect of an unrelated edit is not something a validation change
  should do.

- **Update schemas are `.partial()`, and that is load-bearing.** The admin UI
  genuinely sends single-field bodies. A strict update schema would have broken
  both toggles on the tests list. The passingMarks/totalMarks rule only fires
  when both are present.

- **Four tests in `proctoring-test-toggle.test.ts` were updated, not loosened.**
  They asserted the old behaviour: a non-boolean `proctoringEnabled` accepted
  and silently ignored (now a 400), and 401 for an authenticated non-admin (now
  403). Both changes are the improvement this part exists to make.

- **`vitest.config.ts` now sets `fileParallelism: false`.** Every integration
  suite here shares one database, and running the files in parallel meant one
  suite's fixtures landed in another's aggregates. Once Part 11 added a sweep
  that *deletes* expired assets it got worse — another suite's fixtures would
  vanish mid-test. Four separate intermittent failures traced to this, each of
  which reads like a real bug. Sequential files cost ~17s and buy determinism;
  six consecutive full runs are green.

## Done when

- The listed admin write routes validate with zod and use `requireAdmin` +
  `errorResponse`.
- No admin route returns `err.message` to a client any more.
- Every `assessmentConfig` already in the database validates.
- Response shapes are unchanged and the admin UI still works, checked by hand.
