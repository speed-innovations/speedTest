# Part 3 — Quota and reservation

**Delivers:** the storage budget gate. Pure estimation math, the ledger query,
reserve/release, and the stale-reservation sweep. This is what refuses a new
proctored attempt when the budget is short.

**Files**
- Create: `src/lib/proctoring/quota.ts`
- Create: `tests/proctoring-quota-math.test.ts` (pure, no DB)
- Create: `tests/proctoring-quota-db.test.ts` (integration, real local Postgres)

**Interfaces — Consumes**
Part 1: `getProctoringConfig()`, `StartEligibility` from `@/lib/proctoring/types`.
Part 1 schema: `prisma.proctoringSession`.

**Interfaces — Produces**

```ts
export function estimateAttemptBytes(durationMinutes: number, cfg?: ProctoringConfig): number
export function effectiveDurationMinutes(testDurationMinutes: number, cfg?: ProctoringConfig): number
export async function currentUsageBytes(): Promise<UsageLedger>
export async function canStartProctoredAssessment(testDurationMinutes: number): Promise<StartEligibility>
export async function releaseReservation(sessionId: string): Promise<void>
export async function sweepStaleReservations(now?: Date): Promise<number>

export interface UsageLedger {
  reservedBytes: number     // active sessions' outstanding reservations
  storedBytes: number       // uploaded, not yet expired
  totalBytes: number        // reserved + stored — what the budget is measured against
  activeSessions: number
}
```

---

## The capacity model, stated once

A reservation is released when the attempt finishes. **The media it produced is
not** — it is held for the full 72-hour retention. So the budget is consumed by

```
outstanding reservations (active sessions)  +  stored bytes not yet expired
```

which is why the ceiling is ~75 attempts *per rolling 3-day window*, not 75 at a
time. `currentUsageBytes()` must sum both, or the guard will happily admit
attempts whose storage is already spoken for.

---

## Steps

- [x] **Step 1: Settle the `SUM` question first — it is the one real unknown**

Byte columns are `Int` (see Part 1). The **sum** across sessions can exceed 2^31
(the budget is 7e9). Postgres `SUM(integer)` returns `bigint`, and how Prisma's
pg driver adapter surfaces that is not something to take on faith.

Write this test first and run it before writing any quota code:

`tests/proctoring-quota-db.test.ts` (first case only for now):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'

const TAG = `quota-test-${Date.now()}`
const ids: string[] = []
let collegeId = ''
let testId = ''
let scheduleId = ''
const userIds: string[] = []

/**
 * Integration test against a real database. Byte counters are Int columns; the
 * sum across rows can exceed 2^31, and Postgres returns bigint from SUM(int).
 * Rather than assume how the Prisma driver adapter surfaces that, this asserts
 * it - a wrong type here would silently corrupt every budget decision.
 */
beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college` } })
  collegeId = college.id
  const test = await prisma.test.create({
    data: { title: `${TAG}-test`, durationMinutes: 60, assessmentConfig: [{ area: 'APTITUDE', count: 1 }] },
  })
  testId = test.id
  const schedule = await prisma.testSchedule.create({
    data: { testId, collegeId, scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
  })
  scheduleId = schedule.id

  // Four sessions at 2 GB each: 8e9 total, comfortably past 2^31 (2.147e9).
  for (let i = 0; i < 4; i++) {
    const user = await prisma.user.create({
      data: { email: `${TAG}-${i}@example.test`, name: TAG, password: 'x', role: 'STUDENT' },
    })
    userIds.push(user.id)
    const profile = await prisma.studentProfile.create({
      data: { userId: user.id, collegeId, fullName: TAG, email: `${TAG}-${i}@example.test` },
    })
    const attempt = await prisma.testAttempt.create({
      data: { scheduleId, studentId: profile.id, userId: user.id, questionIds: [] },
    })
    const s = await prisma.proctoringSession.create({
      data: {
        testAttemptId: attempt.id,
        status: 'ACTIVE',
        retentionExpiresAt: new Date(Date.now() + 72 * 3_600_000),
        storageReservedBytes: 2_000_000_000,
      },
    })
    ids.push(s.id)
  }
})

afterAll(async () => {
  await prisma.proctoringSession.deleteMany({ where: { id: { in: ids } } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

describe('byte sums past 2^31', () => {
  it('returns a plain JS number, not a bigint or a string', async () => {
    const agg = await prisma.proctoringSession.aggregate({
      where: { id: { in: ids } },
      _sum: { storageReservedBytes: true },
    })
    const sum = agg._sum.storageReservedBytes
    expect(typeof sum).toBe('number')
    expect(sum).toBe(8_000_000_000)
    expect(Number.isSafeInteger(sum as number)).toBe(true)
  })
})
```

```bash
npx vitest run tests/proctoring-quota-db.test.ts
```

**If this fails** — the sum comes back as a string or bigint — do not work around
it in the caller. Change `currentUsageBytes()` to use a raw query with an
explicit cast and record the finding in `PROGRESS.md`:

```ts
const [row] = await prisma.$queryRaw<Array<{ reserved: number }>>`
  SELECT COALESCE(SUM("storageReservedBytes"), 0)::double precision AS reserved
  FROM "ProctoringSession" WHERE "status" IN ('PENDING','ACTIVE','DEGRADED')`
```

- [x] **Step 2: Write the pure math test** — `tests/proctoring-quota-math.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { estimateAttemptBytes, effectiveDurationMinutes } from '@/lib/proctoring/quota'
import { getProctoringConfig, resetProctoringConfigForTests } from '@/lib/proctoring/config'

/**
 * The estimate decides who is allowed to start. Too low and the budget is
 * overshot mid-cohort; too high and capacity is wasted against an already tight
 * ceiling. These numbers are checked against the PRD's worked example.
 */
describe('estimateAttemptBytes', () => {
  it('matches the worked arithmetic for a 60-minute attempt', () => {
    resetProctoringConfigForTests()
    // media:  3600s * (160000 + 32000) bits/s / 8 = 86,400,000 bytes
    // shots:  1 initial + 60 at one per minute = 61 * 100,000 = 6,100,000 bytes
    // total:  (86,400,000 + 6,100,000) * 1.2 = 111,000,000
    expect(estimateAttemptBytes(60)).toBe(111_000_000)
  })

  it('scales roughly with duration, allowing for the fixed initial screenshot', () => {
    // Not exactly half: the extra screenshot taken immediately after start is a
    // fixed cost that does not halve with the duration.
    const half = estimateAttemptBytes(30)
    const full = estimateAttemptBytes(60)
    expect(half).toBeGreaterThan(full / 2)
    expect(half).toBeLessThan(full / 2 + 200_000)
  })

  it('counts one screenshot per interval plus the initial one', () => {
    // A 1-minute attempt: the immediate screenshot plus one at the 60s mark.
    const cfg = getProctoringConfig()
    const video = Math.round((60 * (cfg.videoBitsPerSecond + cfg.audioBitsPerSecond)) / 8)
    const shots = 2 * cfg.estimatedScreenshotBytes
    expect(estimateAttemptBytes(1)).toBe(Math.round((video + shots) * cfg.safetyMultiplier))
  })

  it('never returns zero or a negative for a degenerate duration', () => {
    expect(estimateAttemptBytes(0)).toBeGreaterThan(0)
    expect(estimateAttemptBytes(-5)).toBeGreaterThan(0)
  })
})

describe('effectiveDurationMinutes', () => {
  it('uses the test duration when it is within the hard maximum', () => {
    expect(effectiveDurationMinutes(60)).toBe(60)
  })

  it('clamps to the configured hard maximum', () => {
    // A misconfigured 10-hour test must not reserve 10 hours of storage.
    expect(effectiveDurationMinutes(600)).toBe(getProctoringConfig().maxDurationMinutes)
  })

  it('floors a nonsensical duration at 1 minute', () => {
    expect(effectiveDurationMinutes(0)).toBe(1)
    expect(effectiveDurationMinutes(-1)).toBe(1)
  })
})
```

- [x] **Step 3: Write `src/lib/proctoring/quota.ts`**

```ts
import type { ProctoringSessionStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getProctoringConfig, getR2Config } from './config'
import type { StartEligibility } from './types'

/**
 * Storage budget enforcement.
 *
 * The budget is measured against reservations *plus* already-stored bytes,
 * because media is held for the full retention period - it does not free up when
 * an attempt is submitted. Summing only reservations would admit attempts whose
 * storage is already spoken for by the last three days of completed ones.
 */

/**
 * Statuses that still hold an outstanding reservation.
 *
 * Typed as the generated Prisma enum, not `as const` plus a cast to string[]:
 * Prisma's `in` filter takes ProctoringSessionStatus[], and a string[] does not
 * satisfy it. The cast would not have compiled.
 */
const RESERVING: ProctoringSessionStatus[] = ['PENDING', 'ACTIVE', 'DEGRADED']

/** Clamp the test's duration to the configured hard maximum. */
export function effectiveDurationMinutes(testDurationMinutes: number, cfg = getProctoringConfig()): number {
  if (!Number.isFinite(testDurationMinutes) || testDurationMinutes < 1) return 1
  return Math.min(Math.floor(testDurationMinutes), cfg.maxDurationMinutes)
}

/**
 * Worst-case bytes for one attempt, with headroom.
 *
 * Deliberately pessimistic: MediaRecorder treats bitrate as a hint, and a busy
 * scene can overshoot. Under-reserving is the expensive mistake - it is
 * discovered when the bucket is already over budget.
 */
export function estimateAttemptBytes(durationMinutes: number, cfg = getProctoringConfig()): number {
  const minutes = Math.max(1, Math.floor(Number.isFinite(durationMinutes) ? durationMinutes : 1))
  const seconds = minutes * 60

  const mediaBytes = (seconds * (cfg.videoBitsPerSecond + cfg.audioBitsPerSecond)) / 8

  // One immediately after start, then one per interval.
  const shots = 1 + Math.ceil((seconds * 1000) / cfg.screenshotIntervalMs)
  const shotBytes = shots * cfg.estimatedScreenshotBytes

  return Math.round((mediaBytes + shotBytes) * cfg.safetyMultiplier)
}

export interface UsageLedger {
  reservedBytes: number
  storedBytes: number
  totalBytes: number
  activeSessions: number
}

/**
 * Current consumption.
 *
 * Read from our own tables, never by listing the bucket: a LIST per request
 * would burn the Class A operation budget and be slower besides.
 */
export async function currentUsageBytes(): Promise<UsageLedger> {
  const now = new Date()

  const [reservedAgg, storedAgg, activeSessions] = await Promise.all([
    prisma.proctoringSession.aggregate({
      where: { status: { in: RESERVING } },
      _sum: { storageReservedBytes: true },
    }),
    // Uploaded and not yet expired. EXPIRED/DELETED assets no longer count even
    // if R2 has not physically removed them - the lifecycle rule will.
    prisma.proctoringAsset.aggregate({
      where: { status: 'UPLOADED', expiresAt: { gt: now } },
      _sum: { byteSize: true },
    }),
    prisma.proctoringSession.count({ where: { status: { in: RESERVING } } }),
  ])

  const reservedBytes = Number(reservedAgg._sum.storageReservedBytes ?? 0)
  const storedBytes = Number(storedAgg._sum.byteSize ?? 0)

  return {
    reservedBytes,
    storedBytes,
    totalBytes: reservedBytes + storedBytes,
    activeSessions,
  }
}

/**
 * The gate. Structured, never a bare boolean - the caller has to tell a
 * candidate *why*, and the admin page shows the remaining budget.
 */
export async function canStartProctoredAssessment(testDurationMinutes: number): Promise<StartEligibility> {
  const cfg = getProctoringConfig()
  const minutes = effectiveDurationMinutes(testDurationMinutes, cfg)
  const estimatedBytes = estimateAttemptBytes(minutes, cfg)

  const deny = (reason: StartEligibility['reason'], remainingBudget = 0): StartEligibility =>
    ({ allowed: false, reason, estimatedBytes, remainingBudget })

  if (!cfg.enabled) return deny('PROCTORING_DISABLED')
  if (!cfg.operational) return deny('PROCTORING_NOT_OPERATIONAL')

  if (cfg.storageProvider === 'r2') {
    // Fail here rather than at the first upload, when the candidate is already
    // recording and the evidence has nowhere to go.
    try {
      getR2Config()
    } catch {
      return deny('PROCTORING_STORAGE_NOT_CONFIGURED')
    }
  }

  const usage = await currentUsageBytes()
  const remainingBudget = Math.max(0, cfg.storageSafetyBytes - usage.totalBytes)

  if (usage.totalBytes + estimatedBytes > cfg.storageSafetyBytes) {
    return deny('PROCTORING_STORAGE_LIMIT_REACHED', remainingBudget)
  }

  return { allowed: true, reason: 'OK', estimatedBytes, remainingBudget }
}

/**
 * Settle a finished session: keep the bytes actually uploaded, drop the rest of
 * the reservation. The stored bytes keep counting against the budget until they
 * expire - only the unused headroom is given back.
 */
export async function releaseReservation(sessionId: string): Promise<void> {
  const assets = await prisma.proctoringAsset.aggregate({
    where: { proctoringSessionId: sessionId, status: 'UPLOADED' },
    _sum: { byteSize: true },
  })
  const used = Number(assets._sum.byteSize ?? 0)
  await prisma.proctoringSession.update({
    where: { id: sessionId },
    data: { storageReservedBytes: 0, storageUsedBytes: used },
  })
}

/**
 * Reclaim reservations from sessions whose browser vanished.
 *
 * An abandoned tab would otherwise hold ~111 MB of a 7 GB budget forever. The
 * session is marked INTERRUPTED rather than deleted: the evidence it did upload
 * stays reviewable until it expires.
 *
 * Bounded and safe to run repeatedly - the pg pool here is max: 3, so this must
 * never fan out.
 */
export async function sweepStaleReservations(now = new Date()): Promise<number> {
  const cfg = getProctoringConfig()
  const cutoff = new Date(now.getTime() - cfg.staleSessionMs)

  const stale = await prisma.proctoringSession.findMany({
    where: {
      status: { in: RESERVING },
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { lastHeartbeatAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
    take: 200,
  })

  for (const s of stale) {
    await releaseReservation(s.id)
    await prisma.proctoringSession.update({
      where: { id: s.id },
      data: { status: 'INTERRUPTED', endedAt: now },
    })
  }
  return stale.length
}
```

- [x] **Step 4: Run the math test — expect pass**

```bash
npx vitest run tests/proctoring-quota-math.test.ts
```

The 60-minute expectation is `(86_400_000 + 61 * 100_000) * 1.2 = 111_000_000`.
The 61st screenshot is deliberate: one is taken immediately after recording
starts, then one per interval.

If this fails, work out which side is wrong before editing either. Changing the
expected number to match whatever the code produced is how a wrong budget ships.

- [x] **Step 5: Extend the DB test with the ledger and sweep cases**

Append to `tests/proctoring-quota-db.test.ts`:

```ts
import { currentUsageBytes, canStartProctoredAssessment, releaseReservation, sweepStaleReservations } from '@/lib/proctoring/quota'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'

describe('currentUsageBytes', () => {
  it('counts reservations from sessions that still hold them', async () => {
    const usage = await currentUsageBytes()
    expect(usage.reservedBytes).toBeGreaterThanOrEqual(8_000_000_000)
    expect(usage.totalBytes).toBe(usage.reservedBytes + usage.storedBytes)
  })
})

describe('canStartProctoredAssessment', () => {
  it('refuses when the budget cannot cover another attempt', async () => {
    process.env.PROCTORING_ENABLED = 'true'
    process.env.PROCTORING_STORAGE_PROVIDER = 'mock'
    resetProctoringConfigForTests()
    // The fixtures alone reserve 8 GB against a 7 GB budget.
    const r = await canStartProctoredAssessment(60)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('PROCTORING_STORAGE_LIMIT_REACHED')
    expect(r.estimatedBytes).toBeGreaterThan(0)
    expect(r.remainingBudget).toBe(0)
  })

  it('refuses when proctoring is disabled, without touching the database', async () => {
    process.env.PROCTORING_ENABLED = 'false'
    resetProctoringConfigForTests()
    const r = await canStartProctoredAssessment(60)
    expect(r.reason).toBe('PROCTORING_DISABLED')
  })
})

describe('releaseReservation', () => {
  it('zeroes the reservation and records what was actually used', async () => {
    await releaseReservation(ids[0])
    const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: ids[0] } })
    expect(s.storageReservedBytes).toBe(0)
    expect(s.storageUsedBytes).toBe(0) // no assets uploaded in this fixture
  })
})

describe('sweepStaleReservations', () => {
  it('interrupts sessions whose heartbeat stopped and frees their reservation', async () => {
    process.env.PROCTORING_STALE_SESSION_MS = '60000'
    resetProctoringConfigForTests()
    await prisma.proctoringSession.update({
      where: { id: ids[1] },
      data: { lastHeartbeatAt: new Date(Date.now() - 600_000) },
    })
    const n = await sweepStaleReservations()
    expect(n).toBeGreaterThanOrEqual(1)
    const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: ids[1] } })
    expect(s.status).toBe('INTERRUPTED')
    expect(s.storageReservedBytes).toBe(0)
    expect(s.endedAt).not.toBeNull()
  })

  it('is safe to run twice', async () => {
    await sweepStaleReservations()
    const second = await sweepStaleReservations()
    expect(second).toBe(0)
  })
})
```

- [x] **Step 6: Run the DB tests**

```bash
npx vitest run tests/proctoring-quota-db.test.ts
```

These write real rows. Confirm `DATABASE_URL` points at **local** Postgres first.

- [x] **Step 7: Typecheck and full suite**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

- [x] **Step 8: Commit**

```bash
git add -A && git commit -m "proctoring part 3: storage quota, reservation, and stale sweep"
```

Do not push.

- [x] **Step 9: Update `PROGRESS.md`** — and record the Step 1 `SUM` result
      explicitly, whichever way it went. Part 10's usage page depends on it.

---

## Done when

- The `SUM` behaviour is verified, not assumed, and recorded in the ledger.
- `canStartProctoredAssessment` returns a structured reason, never a bare boolean.
- The sweep is bounded (`take: 200`) and idempotent.
- Typecheck clean, full suite green, committed locally.
