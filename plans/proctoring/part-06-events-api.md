# Part 6 — Events API

**Delivers:** batched proctoring event ingest with client-id deduplication. The
last backend piece before the client.

**Files**
- Create: `src/lib/proctoring/events.ts`
- Create: `src/app/api/student/proctoring/events/route.ts`
- Modify: `src/lib/proctoring/schemas.ts`
- Create: `tests/proctoring-events-api.test.ts`

**Interfaces — Consumes**
Part 4 `resolveOwnedAttempt`, `activeSessionFor`, `parseBody`; Part 5 `rateLimit`.

**Interfaces — Produces**

```ts
export async function ingestEvents(
  sessionId: string, events: IncomingEvent[], assignedQuestionIds: string[]
): Promise<{ accepted: number; duplicates: number }>
```

---

## Why dedup has to be server-side

The client retries a failed batch. A batch that succeeded but whose *response*
was lost will be retried too, and the server cannot tell the difference. Without
a dedup key, one dropped response inflates a candidate's gaze-warning count — and
that count is evidence a human will read.

`@@unique([proctoringSessionId, clientEventId])` from Part 1 is the key.
`createMany({ skipDuplicates: true })` makes the retry a no-op in one statement,
which matters: this endpoint is called every few seconds by every active
candidate, and the pg pool is `max: 3`.

---

## Steps

- [x] **Step 1: Extend `src/lib/proctoring/schemas.ts`**

```ts
export const eventTypeSchema = z.enum([
  'GAZE_LEFT', 'GAZE_RIGHT', 'GAZE_UP', 'GAZE_DOWN',
  'FACE_NOT_DETECTED', 'MULTIPLE_FACES_DETECTED',
  'SCREEN_SHARE_STOPPED', 'SCREEN_SHARE_RESUMED',
  'CAMERA_STOPPED', 'MICROPHONE_STOPPED',
  'TAB_HIDDEN', 'WINDOW_BLURRED',
  'PROCTORING_STARTED', 'PROCTORING_ENDED',
  'UPLOAD_FAILURE', 'UPLOAD_RECOVERED',
])

const eventSchema = z.object({
  /** Client-generated, stable across retries. The dedup key. */
  clientEventId: z.string().min(8).max(64),
  type: eventTypeSchema,
  direction: z.enum(['LEFT', 'RIGHT', 'UP', 'DOWN']).optional(),
  occurredAt: z.string().datetime(),
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  severity: z.enum(['INFO', 'WARN']).default('INFO'),
  questionId: idSchema.optional(),
  /**
   * Small, bounded. Never landmarks, never image data.
   *
   * The key schema is given explicitly so client-supplied key names are bounded
   * too - the value bound alone would still admit a megabyte of key text.
   */
  metadata: z.record(
    z.string().max(40),
    z.union([z.string().max(200), z.number(), z.boolean()])
  ).optional(),
})

export const eventBatchSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  parentId: idSchema,
  // Bounded: a batch is 5-10 events in normal operation. The cap stops a
  // hostile client shipping 10k rows in one request.
  events: z.array(eventSchema).min(1).max(50),
})

export type IncomingEvent = z.infer<typeof eventSchema>
```

- [x] **Step 2: Write `src/lib/proctoring/events.ts`**

```ts
import { prisma } from '@/lib/db'
import type { IncomingEvent } from './schemas'

/**
 * Proctoring event ingest.
 *
 * These rows are evidence for a human reviewer. They are never inputs to
 * scoring, and they never carry raw frames or face landmarks - only the
 * classification the browser arrived at, and when.
 */

/** Events that count towards the session's gaze warning tally. */
const GAZE_TYPES = new Set(['GAZE_LEFT', 'GAZE_RIGHT', 'GAZE_UP', 'GAZE_DOWN'])

export async function ingestEvents(
  sessionId: string,
  events: IncomingEvent[],
  assignedQuestionIds: string[]
): Promise<{ accepted: number; duplicates: number }> {
  const assigned = new Set(assignedQuestionIds)
  const now = new Date()

  const rows = events.map(e => ({
    proctoringSessionId: sessionId,
    clientEventId: e.clientEventId,
    type: e.type,
    direction: e.direction ?? null,
    // The client clock orders events within a batch; receivedAt is the
    // server's own and is authoritative when the two disagree.
    occurredAt: new Date(e.occurredAt),
    receivedAt: now,
    elapsedMs: e.elapsedMs ?? null,
    durationMs: e.durationMs ?? null,
    severity: e.severity,
    // Same rule as violation/route.ts: accept the question id, but only if it
    // is one this attempt was actually served.
    questionId: e.questionId && assigned.has(e.questionId) ? e.questionId : null,
    metadata: e.metadata ?? undefined,
  }))

  // One statement, and skipDuplicates makes a retried batch a no-op. Without
  // this a lost response would double-count a candidate's warnings.
  const result = await prisma.proctoringEvent.createMany({ data: rows, skipDuplicates: true })

  const gazeAccepted = rows.filter(r => GAZE_TYPES.has(r.type)).length
  if (result.count > 0 && gazeAccepted > 0) {
    // Approximate when a batch was partially duplicate. The exact tally is
    // always recoverable by counting rows; this is a convenience for listings.
    await prisma.proctoringSession.update({
      where: { id: sessionId },
      data: { gazeWarningCount: { increment: Math.min(gazeAccepted, result.count) } },
    })
  }

  return { accepted: result.count, duplicates: rows.length - result.count }
}
```

- [x] **Step 3: Write the route** — `src/app/api/student/proctoring/events/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse, HttpError } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { eventBatchSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor } from '@/lib/proctoring/session'
import { ingestEvents } from '@/lib/proctoring/events'
import { rateLimit } from '@/lib/proctoring/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()

    // Normal operation flushes every 5-10 seconds: ~12/min. 30 allows for
    // retries and a burst without letting a client stream single events.
    if (!rateLimit(`events:${student.studentId}`, 30, 60_000)) {
      throw new HttpError(429, 'Too many event batches. Please wait a moment.')
    }

    const body = await parseBody(req, eventBatchSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    // A finalized session is not an error - the client may still be flushing.
    // Accept the call, store nothing, and let it stop.
    if (!session) return NextResponse.json({ accepted: 0, duplicates: 0, session: null })

    const result = await ingestEvents(session.id, body.events, attempt.questionIds)
    return NextResponse.json({ ...result, session: session.id })
  } catch (err) {
    return errorResponse(err, 'Proctoring events error', 'Could not record proctoring events.')
  }
}
```

- [x] **Step 4: Write `tests/proctoring-events-api.test.ts`**

Cover:

```
ingestEvents
  - stores a batch and reports the accepted count
  - a replayed batch with the same clientEventIds accepts 0 and reports duplicates
  - a partially-overlapping batch stores only the new events
  - gazeWarningCount does not double-count across a replay
  - questionId is kept when it is in the assigned set
  - questionId is nulled when it is not, rather than rejecting the event
  - receivedAt is set server-side even when occurredAt is implausible
```

The replay case is the one that matters most — write it explicitly:

```ts
it('does not inflate the gaze count when a batch is replayed', async () => {
  const batch = [
    { clientEventId: 'evt-aaaaaaaa', type: 'GAZE_LEFT', direction: 'LEFT',
      occurredAt: new Date().toISOString(), severity: 'WARN' as const },
  ]
  const first = await ingestEvents(sessionId, batch as any, [])
  const second = await ingestEvents(sessionId, batch as any, [])

  expect(first.accepted).toBe(1)
  expect(second.accepted).toBe(0)
  expect(second.duplicates).toBe(1)

  const rows = await prisma.proctoringEvent.count({ where: { proctoringSessionId: sessionId } })
  expect(rows).toBe(1)

  const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: sessionId } })
  expect(s.gazeWarningCount).toBe(1) // not 2
})
```

- [x] **Step 5: Run the tests**

```bash
npx vitest run tests/proctoring-events-api.test.ts
```

- [x] **Step 6: Typecheck and full suite**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

- [x] **Step 7: Commit**

```bash
git add -A && git commit -m "proctoring part 6: batched event ingest with server-side dedup"
```

Do not push.

- [x] **Step 8: Update `PROGRESS.md`.**

---

## Done when

- A replayed batch stores nothing new and does not inflate `gazeWarningCount`.
- An unassigned `questionId` is nulled, not rejected — the event still lands.
- The batch size is capped and the endpoint is rate limited.
- Typecheck clean, full suite green.

**The backend is now complete.** Parts 7–9 build the client against these
endpoints; nothing below this line changes the API surface.
