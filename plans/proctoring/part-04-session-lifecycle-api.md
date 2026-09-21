# Part 4 — Session lifecycle API

**Delivers:** `requireAdmin`, the zod body-parsing helper, the attempt-resolution
helper that hides the dual attempt tables, the session start/heartbeat/finalize/
recovery routes, and **the `/start` gate** that makes proctoring non-bypassable.

**Files**
- Modify: `src/lib/attempt-auth.ts` (add `requireAdmin`)
- Create: `src/lib/proctoring/schemas.ts`
- Create: `src/lib/proctoring/http.ts` (`parseBody`)
- Create: `src/lib/proctoring/session.ts` (service layer)
- Create: `src/app/api/student/proctoring/session/route.ts` (POST start, GET status)
- Create: `src/app/api/student/proctoring/heartbeat/route.ts`
- Create: `src/app/api/student/proctoring/finalize/route.ts`
- Modify: `src/app/api/student/test/[scheduleId]/start/route.ts` (gate)
- Modify: `src/app/api/student/walkin-test/[testId]/start/route.ts` (gate)
- Modify: `src/app/api/student/test/[scheduleId]/route.ts` (expose proctoring state)
- Modify: `src/app/api/student/walkin-test/[testId]/route.ts` (same)
- Create: `tests/proctoring-session-api.test.ts`

**Interfaces — Consumes**
Part 1 config/types, Part 3 `canStartProctoredAssessment`, `releaseReservation`.
Existing: `requireStudent`, `HttpError`, `errorResponse` from `@/lib/attempt-auth`.

**Interfaces — Produces**

```ts
// attempt-auth.ts
export async function requireAdmin(): Promise<{ userId: string; email: string }>

// proctoring/http.ts
export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T>

// proctoring/session.ts
export interface ResolvedAttempt {
  kind: AttemptKind
  attemptId: string
  studentId: string
  proctoringEnabled: boolean
  durationMinutes: number
  startedAt: Date | null
  isSubmitted: boolean
  questionIds: string[]
}
export async function resolveOwnedAttempt(
  attemptId: unknown, kind: AttemptKind, parentId: string, studentId: string
): Promise<ResolvedAttempt>
export async function startSession(a: ResolvedAttempt): Promise<SessionView>
export async function recordHeartbeat(sessionId: string, patch: HeartbeatPatch): Promise<void>
export async function finalizeSession(sessionId: string, status?: 'COMPLETED' | 'INTERRUPTED'): Promise<void>
export async function activeSessionFor(a: ResolvedAttempt): Promise<SessionView | null>
```

---

## Steps

- [x] **Step 1: Add `requireAdmin` to `src/lib/attempt-auth.ts`**

There are ~50 copies of this check today, each returning 401 where 403 is meant.
Add the helper; do not retrofit the existing 50 (Part 12 decides how far to go).

```ts
export interface AdminContext {
  userId: string
  email: string
}

/**
 * Resolve the signed-in APP_ADMIN.
 *
 * 403 when authenticated but not an admin, 401 only when not signed in - the
 * copy-pasted inline checks conflate the two and always say 401.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) throw new HttpError(401, 'Unauthorized')
  if ((session.user as any).role !== 'APP_ADMIN') throw new HttpError(403, 'Forbidden')
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, isActive: true },
  })
  if (!user || !user.isActive) throw new HttpError(401, 'Unauthorized')
  return { userId: user.id, email: user.email }
}
```

- [x] **Step 2: Write `src/lib/proctoring/http.ts`**

```ts
import type { ZodSchema } from 'zod'
import { HttpError } from '@/lib/attempt-auth'

/**
 * Parse and validate a JSON body, or throw an HttpError the existing
 * errorResponse funnel already knows how to render.
 *
 * The zod message is included because these are client-integration errors, not
 * internal failures - a developer hitting the endpoint needs to know which field
 * was wrong. Nothing here touches the database or reveals server state.
 */
export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  const raw = await req.json().catch(() => null)
  if (raw === null) throw new HttpError(400, 'Request body must be valid JSON')
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(i => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ')
    throw new HttpError(400, `Invalid request: ${detail}`)
  }
  return parsed.data
}
```

- [x] **Step 3: Write `src/lib/proctoring/schemas.ts`**

```ts
import { z } from 'zod'

/** cuid-shaped ids. Rejects path separators and anything that could steer a key. */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a valid id')

export const attemptKindSchema = z.enum(['scheduled', 'walkin'])

export const sessionStartSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  /** scheduleId for scheduled, testId for walk-in. */
  parentId: idSchema,
})

export const heartbeatSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  parentId: idSchema,
  recording: z.boolean(),
  screenSharing: z.boolean(),
  cameraLive: z.boolean(),
  micLive: z.boolean(),
  lastSegmentSequence: z.number().int().min(0).max(999_999).optional(),
  lastScreenshotSequence: z.number().int().min(0).max(999_999).optional(),
  pendingUploads: z.number().int().min(0).max(10_000).optional(),
  clientVersion: z.string().max(32).optional(),
})

export const finalizeSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  parentId: idSchema,
})
```

- [x] **Step 4: Write `src/lib/proctoring/session.ts`**

The key design point: `resolveOwnedAttempt` is the **only** place the dual
attempt tables are handled. Every route above it works with `ResolvedAttempt`.

```ts
import { prisma } from '@/lib/db'
import { HttpError, requireScheduledAttempt, requireWalkInAttempt, assignedQuestionIds } from '@/lib/attempt-auth'
import { getProctoringConfig } from './config'
import { canStartProctoredAssessment, estimateAttemptBytes, effectiveDurationMinutes, releaseReservation } from './quota'
import type { AttemptKind } from './types'

/**
 * Proctoring session lifecycle.
 *
 * resolveOwnedAttempt is the single place that knows there are two attempt
 * tables. Everything above it works with ResolvedAttempt, so a route never has
 * to branch on kind - which is what stops the walk-in flow quietly losing
 * features the scheduled flow gets.
 */

export interface ResolvedAttempt {
  kind: AttemptKind
  attemptId: string
  studentId: string
  proctoringEnabled: boolean
  durationMinutes: number
  startedAt: Date | null
  isSubmitted: boolean
  questionIds: string[]
}

export interface SessionView {
  id: string
  status: string
  startedAt: Date | null
  retentionExpiresAt: Date
  version: string
}

/**
 * Load an attempt of either kind, proving ownership.
 *
 * Reuses the existing require*Attempt helpers rather than re-querying: they
 * already return 404 (never 403) for a non-owner, so an attacker cannot use this
 * endpoint to confirm that an attempt id exists.
 */
export async function resolveOwnedAttempt(
  attemptId: unknown,
  kind: AttemptKind,
  parentId: string,
  studentId: string
): Promise<ResolvedAttempt> {
  if (kind === 'scheduled') {
    const a = await requireScheduledAttempt(attemptId, parentId, studentId)
    return {
      kind,
      attemptId: a.id,
      studentId: a.studentId,
      proctoringEnabled: a.schedule.test.proctoringEnabled,
      durationMinutes: a.schedule.test.durationMinutes,
      startedAt: a.startedAt,
      isSubmitted: a.isSubmitted,
      questionIds: assignedQuestionIds(a.questionIds),
    }
  }
  const a = await requireWalkInAttempt(attemptId, parentId, studentId)
  return {
    kind,
    attemptId: a.id,
    studentId: a.studentId,
    proctoringEnabled: a.test.proctoringEnabled,
    durationMinutes: a.test.durationMinutes,
    startedAt: a.startedAt,
    isSubmitted: a.isSubmitted,
    questionIds: assignedQuestionIds(a.questionIds),
  }
}

const linkFor = (a: ResolvedAttempt) =>
  a.kind === 'scheduled' ? { testAttemptId: a.attemptId } : { walkInAttemptId: a.attemptId }

const whereFor = (a: ResolvedAttempt) =>
  a.kind === 'scheduled' ? { testAttemptId: a.attemptId } : { walkInAttemptId: a.attemptId }

export async function activeSessionFor(a: ResolvedAttempt): Promise<SessionView | null> {
  const s = await prisma.proctoringSession.findFirst({
    where: { ...whereFor(a), status: { in: ['PENDING', 'ACTIVE', 'DEGRADED'] } },
    select: { id: true, status: true, startedAt: true, retentionExpiresAt: true, version: true },
  })
  return s
}

/**
 * Create or resume the session for an attempt.
 *
 * Idempotent: a refresh, a double-clicked Start, or a recovery after a crash all
 * land here and must reuse the same session. Creating a second one would split
 * the evidence across two records and reserve the budget twice.
 */
export async function startSession(a: ResolvedAttempt): Promise<SessionView> {
  const cfg = getProctoringConfig()

  if (!a.proctoringEnabled) throw new HttpError(400, 'This assessment is not proctored')
  if (a.isSubmitted) throw new HttpError(409, 'Test already submitted')

  const existing = await activeSessionFor(a)
  if (existing) return existing

  // The quota gate runs before anything is created, and crucially before the
  // test clock starts - a candidate refused here has lost no time.
  const eligibility = await canStartProctoredAssessment(a.durationMinutes)
  if (!eligibility.allowed) {
    // 503, not 403: this is an operational limit, not an authorization failure.
    throw new HttpError(503, eligibility.reason)
  }

  const minutes = effectiveDurationMinutes(a.durationMinutes, cfg)
  const now = new Date()

  try {
    return await prisma.proctoringSession.create({
      data: {
        ...linkFor(a),
        status: 'ACTIVE',
        version: cfg.version,
        startedAt: now,
        lastHeartbeatAt: now,
        retentionExpiresAt: new Date(now.getTime() + cfg.retentionHours * 3_600_000),
        storageReservedBytes: estimateAttemptBytes(minutes, cfg),
      },
      select: { id: true, status: true, startedAt: true, retentionExpiresAt: true, version: true },
    })
  } catch (err) {
    // Two tabs racing. The unique index on the attempt FK settles it; the loser
    // reads the winner rather than failing the candidate.
    if ((err as { code?: string }).code !== 'P2002') throw err
    const winner = await activeSessionFor(a)
    if (winner) return winner
    // No live session, yet the FK is taken: this attempt's session was already
    // closed. The unique index is per attempt, not per attempt-and-status, so a
    // finished attempt can never be re-proctored. Say so as a 409 rather than
    // letting a raw Prisma error surface as a generic 500.
    throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
  }
}

export interface HeartbeatPatch {
  recording: boolean
  screenSharing: boolean
  degraded: boolean
}

/** Idempotent by construction - it only stamps the latest state. */
export async function recordHeartbeat(sessionId: string, patch: HeartbeatPatch): Promise<void> {
  await prisma.proctoringSession.updateMany({
    where: { id: sessionId, status: { in: ['ACTIVE', 'DEGRADED'] } },
    data: {
      lastHeartbeatAt: new Date(),
      recordingStarted: patch.recording || undefined,
      screenShareStarted: patch.screenSharing || undefined,
      status: patch.degraded ? 'DEGRADED' : 'ACTIVE',
    },
  })
}

/**
 * Close a session and give back the unused reservation.
 *
 * Idempotent: the guard on status means a second finalize is a no-op rather than
 * a second release. The client calls this on submit; the stale sweep and the
 * submit-route safety net call it for clients that died.
 */
export async function finalizeSession(
  sessionId: string,
  status: 'COMPLETED' | 'INTERRUPTED' = 'COMPLETED'
): Promise<void> {
  const updated = await prisma.proctoringSession.updateMany({
    where: { id: sessionId, status: { in: ['PENDING', 'ACTIVE', 'DEGRADED'] } },
    data: { status, endedAt: new Date() },
  })
  if (updated.count === 1) await releaseReservation(sessionId)
}
```

- [x] **Step 5: Write the session route** — `src/app/api/student/proctoring/session/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse, HttpError } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { sessionStartSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, startSession, activeSessionFor } from '@/lib/proctoring/session'
import { getProctoringConfig } from '@/lib/proctoring/config'
import type { AttemptKind } from '@/lib/proctoring/types'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    const body = await parseBody(req, sessionStartSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await startSession(attempt)
    const cfg = getProctoringConfig()

    return NextResponse.json({
      sessionId: session.id,
      status: session.status,
      version: session.version,
      retentionExpiresAt: session.retentionExpiresAt,
      // Client capture parameters come from the server so a deploy can retune
      // them without shipping new client code.
      config: {
        screenshotIntervalMs: cfg.screenshotIntervalMs,
        videoSegmentMs: cfg.videoSegmentMs,
        videoBitsPerSecond: cfg.videoBitsPerSecond,
        audioBitsPerSecond: cfg.audioBitsPerSecond,
        gazeWarningMs: cfg.gazeWarningMs,
        gazeWarningCooldownMs: cfg.gazeWarningCooldownMs,
        faceMissingWarningMs: cfg.faceMissingWarningMs,
        multipleFacesWarningMs: cfg.multipleFacesWarningMs,
        maxScreenshotBytes: cfg.maxScreenshotBytes,
        heartbeatIntervalMs: cfg.heartbeatIntervalMs,
        screenRequired: cfg.screenRequired,
      },
    })
  } catch (err) {
    return errorResponse(err, 'Proctoring session start error', 'Could not start proctoring. Please try again.')
  }
}

/** Recovery: does this attempt already have a live session? */
export async function GET(req: NextRequest) {
  try {
    const student = await requireStudent()
    const { searchParams } = new URL(req.url)
    const attemptId = searchParams.get('attemptId')
    const kind = searchParams.get('kind') as AttemptKind | null
    const parentId = searchParams.get('parentId')
    if (!attemptId || !parentId || (kind !== 'scheduled' && kind !== 'walkin')) {
      throw new HttpError(400, 'attemptId, kind and parentId are required')
    }
    const attempt = await resolveOwnedAttempt(attemptId, kind, parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    return NextResponse.json({
      proctoringEnabled: attempt.proctoringEnabled,
      session: session ? { sessionId: session.id, status: session.status, startedAt: session.startedAt } : null,
    })
  } catch (err) {
    return errorResponse(err, 'Proctoring session read error', 'Could not read proctoring state.')
  }
}
```

- [x] **Step 6: Write the heartbeat route** — `src/app/api/student/proctoring/heartbeat/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { heartbeatSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor, recordHeartbeat } from '@/lib/proctoring/session'

/**
 * Liveness only. No media passes through here - it exists so the backend can
 * tell a finished session from an abandoned one.
 */
export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    const body = await parseBody(req, heartbeatSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    // A heartbeat for a finalized session is not an error - the client may not
    // have noticed yet. Tell it, and let it stop.
    if (!session) return NextResponse.json({ ok: true, session: null })

    const degraded = (body.pendingUploads ?? 0) > 5 || !body.recording
    await recordHeartbeat(session.id, {
      recording: body.recording,
      screenSharing: body.screenSharing,
      degraded,
    })
    return NextResponse.json({ ok: true, session: { sessionId: session.id, degraded } })
  } catch (err) {
    return errorResponse(err, 'Proctoring heartbeat error', 'Could not record heartbeat.')
  }
}
```

- [x] **Step 7: Write the finalize route** — `src/app/api/student/proctoring/finalize/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { finalizeSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor, finalizeSession } from '@/lib/proctoring/session'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    const body = await parseBody(req, finalizeSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    // Idempotent: already finalized is success, not a conflict. The client
    // retries this during submit and must not be told it failed.
    if (!session) return NextResponse.json({ ok: true, alreadyFinalized: true })
    await finalizeSession(session.id, 'COMPLETED')
    return NextResponse.json({ ok: true, alreadyFinalized: false })
  } catch (err) {
    return errorResponse(err, 'Proctoring finalize error', 'Could not finalize proctoring.')
  }
}
```

- [x] **Step 8: Add the gate to both `/start` routes**

This is the step that makes proctoring non-bypassable. In
`src/app/api/student/test/[scheduleId]/start/route.ts`, **before** the
`if (!attempt.startedAt)` block that sets the clock:

```ts
    // A modified client could skip the proctoring calls entirely and come
    // straight here. Refuse to start the clock unless a live session exists, so
    // the server-side record is trustworthy even when the browser is not.
    if (schedule.test.proctoringEnabled) {
      const live = await prisma.proctoringSession.findFirst({
        where: { testAttemptId: attempt.id, status: { in: ['ACTIVE', 'DEGRADED'] } },
        select: { id: true },
      })
      if (!live) {
        return NextResponse.json(
          { error: 'Proctoring must be started before this assessment.', code: 'PROCTORING_REQUIRED' },
          { status: 409 }
        )
      }
    }
```

Mirror it exactly in `src/app/api/student/walkin-test/[testId]/start/route.ts`,
substituting `test.proctoringEnabled` and `walkInAttemptId`.

**Both files. A change to one that misses the other is incomplete.**

- [x] **Step 9: Expose `proctoringEnabled` on the two GET routes**

The GET already returns the whole `schedule` (including `test`), so the flag
reaches the client for free — confirm it does, and add an explicit top-level
field so the client is not reading it out of a nested object:

```ts
      proctoringEnabled: schedule.test.proctoringEnabled,
```

Add to **both** the `started: false` response and the `started: true` response in
`src/app/api/student/test/[scheduleId]/route.ts`, and the equivalents in the
walk-in route.

- [x] **Step 10: Write `tests/proctoring-session-api.test.ts`**

Test the service layer directly, the way `tests/attempt-ownership.test.ts` does —
this repo tests routes by exercising their lib helpers, not over HTTP.

Cover, at minimum:

```
resolveOwnedAttempt
  - returns the attempt to its owner, for both kinds
  - refuses another student with 404, for both kinds
  - refuses an attempt driven through the wrong parent id
  - surfaces proctoringEnabled from the test, for both kinds

startSession
  - creates an ACTIVE session and reserves bytes
  - is idempotent: a second call returns the same session id
  - refuses when the test is not proctored (400)
  - refuses when the attempt is already submitted (409)
  - refuses with the quota reason when the budget is exhausted (503)

finalizeSession
  - marks COMPLETED, sets endedAt, zeroes the reservation
  - is idempotent: a second call changes nothing
  - a restart after finalize is refused with 409 PROCTORING_SESSION_CLOSED,
    not a raw Prisma P2002 rendered as a 500

recordHeartbeat
  - advances lastHeartbeatAt
  - sets DEGRADED when the client reports a backlog
  - does not resurrect a COMPLETED session
```

Follow the existing fixture conventions: `TAG = \`...-${Date.now()}\``, teardown
in FK-safe order in `afterAll`, ending with `prisma.$disconnect()`.

- [x] **Step 11: Run it**

```bash
npx vitest run tests/proctoring-session-api.test.ts
```

- [x] **Step 12: Typecheck and full suite**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

The existing `tests/attempt-ownership.test.ts` must still pass — the `/start`
routes changed, so a regression there is the signal that the gate broke
non-proctored flows.

- [x] **Step 13: Confirm non-proctored attempts are untouched**

```bash
grep -n "proctoringEnabled" src/app/api/student/test/\[scheduleId\]/start/route.ts src/app/api/student/walkin-test/\[testId\]/start/route.ts
```

Every proctoring branch must sit behind that flag. A test with
`proctoringEnabled: false` must take exactly the path it took before this part.

- [x] **Step 14: Commit**

```bash
git add -A && git commit -m "proctoring part 4: session lifecycle API and the start gate"
```

Do not push.

- [x] **Step 15: Update `PROGRESS.md`.**

---

## Done when

- `resolveOwnedAttempt` is the only code that branches on attempt kind.
- Both `/start` routes refuse to start the clock without a live session.
- `startSession` and `finalizeSession` are idempotent under retry.
- The quota refusal arrives as 503 with a machine-readable reason, not a 500.
- Typecheck clean, full suite green including the pre-existing ownership tests.
