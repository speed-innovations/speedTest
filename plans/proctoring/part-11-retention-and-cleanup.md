# Part 11 — Retention and cleanup

**Delivers:** the expiry sweep, the authenticated cleanup endpoint, the scheduled
GitHub workflow (written, not pushed), and the submit-route finalization safety
net.

**Files**
- Create: `src/lib/proctoring/retention.ts`
- Create: `src/app/api/cron/proctoring-cleanup/route.ts`
- Create: `.github/workflows/proctoring-cleanup.yml` (**not pushed** until Part 15)
- Modify: `src/app/api/student/test/[scheduleId]/submit/route.ts`
- Modify: `src/app/api/student/walkin-test/[testId]/submit/route.ts`
- Create: `tests/proctoring-retention.test.ts`

**Interfaces — Consumes:** Part 2 `getStorage()`, Part 3 `sweepStaleReservations`,
Part 4 `finalizeSession`.

**Interfaces — Produces**

```ts
export async function runRetentionCleanup(opts?): Promise<CleanupReport>
export interface CleanupReport {
  assetsExpired: number; objectsDeleted: number; deleteFailures: number
  sessionsExpired: number; staleReservationsReleased: number; batchExhausted: boolean
}
```

---

## Two independent deletion mechanisms, on purpose

**Application expiry** refuses access the moment `expiresAt` passes. **R2's
lifecycle rule** deletes the bytes, on Cloudflare's own schedule, which is
"approximately" three days and not to the minute.

Neither alone is sufficient. Lifecycle alone would leave media reachable past the
promised window whenever Cloudflare ran late. Application expiry alone would
leave bytes on the budget forever if the job stopped. The honest claim is:
**access stops at 72 hours; the bytes are removed shortly after.** Do not
document it as exact deletion at 72 hours.

## Assume the job runs late, or not at all

GitHub scheduled workflows are routinely 10–30 minutes late and are
auto-disabled after 60 days of repository inactivity. Cleanup is therefore
catch-up capable: bounded per run, safe to run repeatedly, and correct after a
multi-day gap. It processes oldest-first so a backlog drains in the order that
frees budget soonest.

The pg pool is `max: 3`. Deletions run sequentially, never fanned out.

---

## Steps

- [x] **Step 1: Write `src/lib/proctoring/retention.ts`**

```ts
import { prisma } from '@/lib/db'
import { getStorage } from './storage'
import { sweepStaleReservations } from './quota'

/**
 * Retention enforcement.
 *
 * Two mechanisms cover this deliberately: the application refuses access at
 * expiresAt, and R2's lifecycle rule removes the bytes somewhat later. This job
 * closes the gap between them and keeps the storage ledger honest.
 *
 * Bounded and idempotent: a run that is late, interrupted, or repeated must
 * converge on the same state. The pg pool is max: 3, so deletes are sequential.
 */

const DEFAULT_BATCH = 200

export interface CleanupReport {
  assetsExpired: number
  objectsDeleted: number
  deleteFailures: number
  sessionsExpired: number
  staleReservationsReleased: number
  /** True when the batch filled - the caller should run again soon. */
  batchExhausted: boolean
}

export async function runRetentionCleanup(
  opts: { now?: Date; batchSize?: number } = {}
): Promise<CleanupReport> {
  const now = opts.now ?? new Date()
  const batchSize = opts.batchSize ?? DEFAULT_BATCH
  const storage = getStorage()

  const report: CleanupReport = {
    assetsExpired: 0, objectsDeleted: 0, deleteFailures: 0,
    sessionsExpired: 0, staleReservationsReleased: 0, batchExhausted: false,
  }

  // Oldest first: a backlog should drain in the order that frees budget soonest.
  const due = await prisma.proctoringAsset.findMany({
    where: { expiresAt: { lte: now }, status: { in: ['UPLOADED', 'PENDING', 'FAILED', 'EXPIRED'] } },
    orderBy: { expiresAt: 'asc' },
    take: batchSize,
    select: { id: true, objectKey: true, status: true },
  })
  report.batchExhausted = due.length === batchSize

  for (const asset of due) {
    try {
      // Idempotent at the storage layer: deleting an absent object is not an
      // error, so a re-run after a partial failure is safe.
      await storage.deleteObject(asset.objectKey)
      await prisma.proctoringAsset.update({
        where: { id: asset.id },
        data: { status: 'DELETED', byteSize: 0 },
      })
      report.objectsDeleted++
    } catch (err) {
      // Mark EXPIRED but not DELETED, so the next run retries the object. Access
      // is already refused either way - the bytes are what is outstanding.
      await prisma.proctoringAsset.updateMany({
        where: { id: asset.id, status: { not: 'DELETED' } },
        data: { status: 'EXPIRED' },
      })
      report.deleteFailures++
      console.error('R2_ASSET_DELETE_FAILED', { assetId: asset.id })
    }
    report.assetsExpired++
  }

  // Sessions whose retention window has closed and have nothing left to delete.
  const expiredSessions = await prisma.proctoringSession.updateMany({
    where: {
      retentionExpiresAt: { lte: now },
      status: { in: ['COMPLETED', 'INTERRUPTED'] },
    },
    data: { status: 'EXPIRED', storageReservedBytes: 0 },
  })
  report.sessionsExpired = expiredSessions.count

  report.staleReservationsReleased = await sweepStaleReservations(now)

  return report
}
```

- [x] **Step 2: Write the cleanup endpoint** — `src/app/api/cron/proctoring-cleanup/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { runRetentionCleanup } from '@/lib/proctoring/retention'

/**
 * Called by the scheduled GitHub workflow.
 *
 * Authenticated by a shared secret rather than a session: there is no user here.
 * The comparison is length-safe and constant-time-ish; more importantly the
 * endpoint does nothing destructive beyond deleting already-expired objects, so
 * the blast radius of a leaked secret is a forced early cleanup, not data loss.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('PROCTORING_CLEANUP_MISCONFIGURED: CRON_SECRET is not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (provided.length !== secret.length || provided !== secret) {
    // No detail: an unauthenticated caller learns nothing about why.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runRetentionCleanup()
    console.log('PROCTORING_CLEANUP_COMPLETED', report)
    return NextResponse.json(report)
  } catch (err) {
    console.error('PROCTORING_CLEANUP_FAILED:', err)
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
```

- [x] **Step 3: Write the workflow** — `.github/workflows/proctoring-cleanup.yml`

Write the file. **Do not push it.** A scheduled workflow only becomes active once
it is on the default branch, which is Part 15.

```yaml
name: Proctoring retention cleanup

# Media is expired by the application the moment expiresAt passes; this job
# removes the bytes and keeps the storage ledger honest. GitHub's scheduler is
# routinely 10-30 minutes late and disables schedules after 60 days of repo
# inactivity, so the endpoint is catch-up capable and safe to run repeatedly.
on:
  schedule:
    - cron: '17 * * * *'   # hourly, off the hour to avoid the scheduler's peak
  workflow_dispatch:        # manual runs, for draining a backlog

concurrency:
  group: proctoring-cleanup
  cancel-in-progress: false

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Call the cleanup endpoint
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
          APP_URL: ${{ vars.APP_URL || 'https://speedtest-45s1.onrender.com' }}
        run: |
          set -euo pipefail
          if [ -z "${CRON_SECRET:-}" ]; then
            echo "::error::CRON_SECRET is not set"
            exit 1
          fi

          # Render's free plan spins down after inactivity and cold-starts in
          # ~50s, so allow a generous connect timeout rather than failing the
          # run on a sleeping service.
          response=$(curl -sS -w '\n%{http_code}' -X POST \
            --connect-timeout 90 --max-time 300 \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            "${APP_URL}/api/cron/proctoring-cleanup")

          body=$(echo "$response" | head -n -1)
          code=$(echo "$response" | tail -n 1)
          echo "$body"

          if [ "$code" != "200" ]; then
            echo "::error::Cleanup returned HTTP $code"
            exit 1
          fi

          # A full batch means there is a backlog. Surface it rather than
          # letting it quietly consume the storage budget.
          if echo "$body" | grep -q '"batchExhausted":true'; then
            echo "::warning::Batch was exhausted - a backlog remains. Consider a manual run."
          fi
```

- [x] **Step 4: Add the finalization safety net to both submit routes**

After the `$transaction` closes (`submit/route.ts:96`), **outside** it:

```ts
    // Safety net for a client that died between recording and submitting. The
    // browser normally finalizes first; this only catches the case where it
    // could not. Deliberately outside the transaction - that one already
    // carries the whole cohort's submit load - and wrapped, because losing a
    // candidate's submit over a proctoring bookkeeping failure is unacceptable.
    try {
      const session = await prisma.proctoringSession.findFirst({
        where: { testAttemptId: attempt.id, status: { in: ['PENDING', 'ACTIVE', 'DEGRADED'] } },
        select: { id: true },
      })
      if (session) await finalizeSession(session.id, 'COMPLETED')
    } catch (err) {
      console.error('Proctoring finalize-on-submit failed:', err)
    }
```

Mirror into the walk-in submit route with `walkInAttemptId`. **Both files.**

- [x] **Step 5: Write `tests/proctoring-retention.test.ts`**

```
- an asset past expiresAt is deleted from storage and marked DELETED
- an asset not yet expired is untouched
- running twice is a no-op the second time              <- the idempotency case
- a storage delete failure marks EXPIRED, not DELETED, so the next run retries
- a completed session past its retention window becomes EXPIRED
- the batch is bounded and reports batchExhausted when full
- cleanup after a multi-day gap drains oldest-first
- expired assets stop counting towards currentUsageBytes
```

The idempotency case, explicitly:

```ts
it('is safe to run twice', async () => {
  const first = await runRetentionCleanup({ now: future })
  expect(first.objectsDeleted).toBeGreaterThan(0)

  const second = await runRetentionCleanup({ now: future })
  expect(second.objectsDeleted).toBe(0)
  expect(second.deleteFailures).toBe(0)
})
```

And the budget-release case, which is what actually matters operationally:

```ts
it('stops counting expired assets against the storage budget', async () => {
  const before = await currentUsageBytes()
  await runRetentionCleanup({ now: future })
  const after = await currentUsageBytes()
  expect(after.storedBytes).toBeLessThan(before.storedBytes)
})
```

- [x] **Step 6: Run the tests, typecheck, full suite**

```bash
npx vitest run tests/proctoring-retention.test.ts
```

```bash
npx tsc --noEmit -p tsconfig.json && npm test
```

- [x] **Step 7: Exercise the endpoint locally**

With the dev server running and `CRON_SECRET` set in `.env`:

```bash
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/proctoring-cleanup
```

Then confirm it refuses a bad secret:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer wrong" http://localhost:3001/api/cron/proctoring-cleanup
```

Must print `401`.

- [x] **Step 8: Commit**

```bash
git add -A && git commit -m "proctoring part 11: retention cleanup, scheduled workflow, and submit finalization"
```

Do not push. The workflow file is committed but inert until it reaches `main`.

- [x] **Step 9: Update `PROGRESS.md`** — note that the workflow exists but is not
      yet active, so Part 15 does not forget to verify its first run.

---

## Found while building this part

- **The safety net goes BEFORE `if (!result.applied)`, not merely "after the
  transaction".** Both submit routes have *two* return paths: the early return
  for an already-submitted attempt, and the normal one. Placing the net after
  the early return would skip finalization on exactly the re-submit case where
  the client most likely died. It sits immediately after the transaction closes,
  ahead of both.

- **`DELETABLE` is typed `ProctoringAssetStatus[]`, not `as const`.** Prisma's
  `in` filter takes the generated enum array; `as const` needs a cast to
  satisfy it, and the cast is what hides a genuine mismatch later. This is the
  same correction Part 3 made to `RESERVING` in quota.ts.

- **MockStorage's seed helper is `putForTest`, not `put`.**

- **The workflow uses `sed '$d'` rather than `head -n -1`** to strip the status
  line. `head -n -1` is a GNU coreutils extension; ubuntu-latest has it, but
  the sed form is portable and costs nothing.

- **Five route-handler tests were added beyond the part file's list.** The part
  file only asked for a manual curl, which cannot run in CI and does not cover
  the unset-secret path. The handler is now tested directly for 200 on a
  correct secret, 401 on a wrong one, 401 on a missing header, acceptance of a
  bare token without the `Bearer` prefix, and **503 rather than a fall-through
  when `CRON_SECRET` is unset** - that last one is the case where a
  misconfigured deployment could otherwise have run cleanup unauthenticated.

- **The budget test asserts this session's own contribution**, not a global
  before/after subtraction. Other suites write into the same tables and vitest
  may run them concurrently - a global delta is the race that flaked Part 10's
  usage test about half of all runs.

- **Fixtures carry relative expiry** (`expiresInHours: -1`) instead of the part
  file's shared far-future `now`. Each asset is seeded already-expired or not,
  which reads better than threading `{ now: future }` through every call.

## Done when

- Cleanup is bounded, idempotent, and correct after a multi-day gap.
- A failed delete leaves the asset retryable rather than falsely DELETED.
- Expired assets stop counting against the storage budget.
- Both submit routes carry the safety net, outside the transaction and wrapped.
- The cleanup endpoint refuses a wrong secret with 401 and no detail.
