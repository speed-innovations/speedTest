# Live Monitoring Hardening (metadata only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing record-and-upload proctoring into live, in-browser monitoring: MediaPipe detection, signal fusion, a temporal state machine, repeated-behaviour tracking, integrity/tamper detection, visible warnings, and server-side metadata events. No media is recorded, stored or uploaded.

**Architecture:** Keep the server-authoritative session, the `/start` gate, the heartbeat and the events API. Delete the media path (R2 storage, quota, presigned uploads, webcam recorder, screen snapshots, upload queue, admin player and gallery). Rebuild detection as pure, node-testable modules (`gaze-classify` extraction and fusion → `baseline` → `gaze-state` temporal engine → `behaviour-tracker` → `detection-pipeline`) behind a thin MediaPipe shell (`gaze-monitor`). Add an `IntegrityMonitor` (tracks and page events) and a bounded `EventQueue`. The server binds every event and heartbeat to the caller's own live session, records server-side `HEARTBEAT_MISSED`, and derives an admin-only `PROCTORING_REVIEW_SIGNAL`.

**Tech Stack:** Next.js 15 App Router, TypeScript (target `es5`), Prisma 5 + Postgres, zod 4, `@mediapipe/tasks-vision` 1.0.1, vitest 2 (node by default, jsdom per file), @testing-library/react.

**Spec:** `plans/proctoring/live-monitoring-spec.md` (requirement ids N1–N7, P1–P28). Prior design: `plans/proctoring/README.md`; ledger: `plans/proctoring/PROGRESS.md`.

## Decisions taken in this plan (owner: confirm or veto before execution)

1. **The media pipeline is deleted, not feature-flagged.** Dormant upload code keeps `@aws-sdk` in the dependency tree and leaves routes that could hand out URLs. Git history is the restore path: the storage work is commits `908fa30`, `ed5c3dd`, `1e7e20d`, `0114b9b`, `70f5d01`.
2. **New migration, not an edited one.** `20260921095859_add_proctoring` is applied to local Postgres. It has never reached Supabase, but editing it would force a local `migrate reset`. A second migration drops `ProctoringAsset` and rebuilds the event enum instead.
3. **Aggregated episode events, not STARTED/ENDED pairs**, for detection conditions. One `FACE_MISSING` row carries `startedAt`, `endedAt` and `durationMs`, and its `endedAt` *is* the ticket's `FACE_RETURNED`. The same holds for `MULTIPLE_FACES_CLEARED` and `GAZE_RETURNED`. Browser and track events that can stay open indefinitely use pairs (`TAB_HIDDEN`/`TAB_VISIBLE`, `CAMERA_INTERRUPTED`/`CAMERA_RESTORED`, …).
4. **Downward attention takes priority over horizontal.** LEFT + DOWN is reported as `LOOKING_DOWN` with `metadata.horizontal = 'LEFT'`, so the downward behaviour tracker sees it.
5. **Detection tuning is client-only** (`client/detection-config.ts`). The `PROCTORING_GAZE_*` / `*_WARNING_MS` env vars and their fields in the session response are removed, so thresholds never appear in an API response (P13). They still ship in the JS bundle, which is unavoidable for client-side detection and is documented as a limitation.
6. **An INTERRUPTED session can be resumed** if the attempt is unsubmitted and inside its deadline. That fixes the dead end Part 9 recorded. COMPLETED and EXPIRED stay closed.
7. **The setup screen adds a data note** after the verbatim consent copy: "Monitoring events, such as camera or screen-sharing interruptions, are logged for review. No video, audio or screenshots are stored." Delete `DATA_NOTE` if you want the verbatim copy only.
8. **Screen `displaySurface` is logged, not enforced.** Sharing one tab instead of the whole screen is recorded in `SCREEN_SHARE_STARTED` metadata. Enforcing `monitor` is left for you to decide.

## Global Constraints

- N1/N2: no `MediaRecorder`, no `canvas.toBlob`/`toDataURL`/`getImageData`, no upload endpoint, no storage SDK or credential anywhere in proctoring code. Task 15 adds a test that enforces this.
- N3: no UI string may claim recording, saving or uploading. Candidate copy contains no digits, durations, degrees or thresholds (P13).
- Both attempt kinds, always: any change to `src/app/student/test/[scheduleId]/page.tsx` is mirrored verbatim in `src/app/student/walkin-test/[testId]/page.tsx`.
- `proctoringEnabled=false` must behave exactly as before: no media prompt, no proctoring fetch, `/start` unchanged.
- Never modify `src/lib/grading.ts`, `src/lib/question-picker.ts` or the submit scoring transaction.
- Convention B only in routes: `requireStudent`/`requireAdmin` → `parseBody` → `errorResponse`. Never return `err.message`. Ownership failures are 404, never 403.
- tsconfig targets `es5`: no `for...of` over a Map or Set, no spreading one (arrays are fine), no top-level `await` in tests. Use static imports with hoisted `vi.mock`.
- Prisma `undefined` means "leave the column alone". Use `null` to clear.
- Local only: commit on `feat/proctoring`, never push, never touch Supabase or Render.
- **Stop the dev server first** before `npm install`/`uninstall`, `prisma generate`, `prisma migrate dev` or `npm run build` (the Windows EPERM on the query engine DLL, and `next build` overwriting the shared `.next`). The executor asks the owner to stop it and never kills it.
- **The executor never starts the dev server or a browser.** Automated checks are `npx tsc --noEmit -p tsconfig.json` and `npx vitest run`. Browser verification is the owner's, via the Task 15 script.
- `npm run lint` is dead (no eslint installed or configured). Report it as unavailable; do not install eslint.
- **Between Task 1 and Task 11 the running client and server disagree** (payload shapes, removed routes). Tests stay green throughout, but nobody should run the candidate flow until Task 11 lands.

## File map

| Path | Fate | Responsibility |
|---|---|---|
| `src/lib/proctoring/storage/*`, `upload.ts`, `quota.ts` | delete (T1) | media storage |
| `src/app/api/student/proctoring/{upload-url,asset-complete}/route.ts` | delete (T1) | presigned upload |
| `src/app/api/admin/proctoring/{assets,usage}/…`, `src/app/admin/proctoring/page.tsx` | delete (T1) | media download, usage page |
| `src/components/proctoring/admin/{RecordingPlayer,ScreenshotGallery}.tsx` | delete (T1) | media review |
| `src/lib/proctoring/client/{webcam-recorder,screen-capture,upload-queue}.ts` | delete (T11) | client capture/upload |
| `src/lib/proctoring/event-types.ts` | create (T2) | shared event taxonomy + severity |
| `prisma/migrations/<ts>_proctoring_metadata_only/migration.sql` | create (T2) | drop assets, rebuild event enum |
| `src/lib/proctoring/client/detection-config.ts` | create (T3) | every threshold and timing |
| `src/lib/proctoring/client/gaze-classify.ts` | extend (T3), prune (T6) | frame signals + fusion |
| `src/lib/proctoring/client/baseline.ts` | create (T4) | median personal baseline |
| `src/lib/proctoring/client/gaze-state.ts` | extend (T4), prune (T6) | temporal engine |
| `src/lib/proctoring/client/warning-copy.ts` | create (T5) | candidate copy + warning gate |
| `src/lib/proctoring/client/behaviour-tracker.ts` | create (T5) | repeated-behaviour stats |
| `src/lib/proctoring/client/detection-pipeline.ts` | create (T5) | composes the pure stages |
| `src/lib/proctoring/client/gaze-monitor.ts` | rewrite (T6) | MediaPipe shell, frame loop |
| `src/lib/proctoring/client/integrity-monitor.ts` | create (T7) | track + page events, device health |
| `src/lib/proctoring/client/event-queue.ts` | create (T8) | bounded, rate-capped batching |
| `src/lib/proctoring/{session,events,schemas}.ts` + routes | modify (T1, T2, T9) | server authority |
| `src/lib/proctoring/client/diagnostics.ts` | create (T11) | dev-only snapshot |
| `src/lib/proctoring/client/use-proctoring.ts` | rewrite (T11) | React integration |
| `src/components/proctoring/*` | modify/create (T11–T13) | candidate UI |
| `src/lib/proctoring/review-signal.ts` | create (T14) | admin review signal |
| `tests/proctoring-no-media.test.ts` | create (T15) | enforces N1/N2 |

---

### Task 1: Remove the server-side media pipeline

**Files:**
- Delete: `src/lib/proctoring/storage/index.ts`, `storage/keys.ts`, `storage/mock.ts`, `storage/r2.ts`, `storage/types.ts`, `src/lib/proctoring/upload.ts`, `src/lib/proctoring/quota.ts`
- Delete: `src/app/api/student/proctoring/upload-url/route.ts`, `src/app/api/student/proctoring/asset-complete/route.ts`, `src/app/api/admin/proctoring/assets/[id]/download-url/route.ts`, `src/app/api/admin/proctoring/usage/route.ts`, `src/app/admin/proctoring/page.tsx`
- Delete: `src/components/proctoring/admin/RecordingPlayer.tsx`, `src/components/proctoring/admin/ScreenshotGallery.tsx`
- Delete tests: `tests/proctoring-storage-keys.test.ts`, `tests/proctoring-storage-mock.test.ts`, `tests/proctoring-quota-db.test.ts`, `tests/proctoring-quota-math.test.ts`, `tests/proctoring-upload-api.test.ts`
- Modify: `src/lib/proctoring/config.ts`, `src/lib/proctoring/types.ts`, `src/lib/proctoring/session.ts`, `src/lib/proctoring/retention.ts`, `src/lib/proctoring/admin.ts`, `src/lib/proctoring/schemas.ts`, `src/app/api/student/proctoring/heartbeat/route.ts`, `src/app/api/student/proctoring/session/route.ts`, `src/components/proctoring/admin/ProctoringPanel.tsx`, `src/components/admin/AdminSidebar.tsx`, `src/app/api/cron/proctoring-cleanup/route.ts`, `.github/workflows/proctoring-cleanup.yml`, `.env.example`, `package.json`, `package-lock.json`
- Test: `tests/proctoring-config.test.ts` (rewrite), `tests/proctoring-retention.test.ts` (rewrite), `tests/proctoring-admin-api.test.ts` (rewrite), `tests/proctoring-session-api.test.ts` (edit)

**Interfaces:**
- Produces: `getProctoringConfig(): ProctoringConfig` with fields `enabled, operational, retentionHours, gazeWarningMs, gazeWarningCooldownMs, faceMissingWarningMs, multipleFacesWarningMs, screenRequired, heartbeatIntervalMs, staleSessionMs, version` (the gaze fields go in Task 6).
- Produces (session.ts): `LIVE_STATUSES: ProctoringSessionStatus[]`, `assertProctoringAvailable(cfg?)`, `startSession(a): Promise<SessionView>`, `recordHeartbeat(sessionId, { screenSharing: boolean; degraded: boolean }): Promise<void>`, `finalizeSession(sessionId, status?)`, `sweepStaleSessions(now?): Promise<number>`.
- Produces (retention.ts): `runRetentionCleanup(opts?: { now?: Date }): Promise<{ sessionsExpired: number; staleSessionsInterrupted: number }>`.
- Produces (admin.ts): `getAdminEvidence(attemptId, type): Promise<{ session: AdminSessionView | null; events: AdminEventView[] }>`.

- [ ] **Step 1: Ask the owner to stop the dev server, then remove the storage SDK**

Run: `npm uninstall @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
Expected: both removed from `package.json` `dependencies`, and `postinstall` (`prisma generate`) succeeds.

- [ ] **Step 2: Delete the media files and their tests**

```bash
git rm -r src/lib/proctoring/storage src/lib/proctoring/upload.ts src/lib/proctoring/quota.ts \
  src/app/api/student/proctoring/upload-url src/app/api/student/proctoring/asset-complete \
  src/app/api/admin/proctoring/assets src/app/api/admin/proctoring/usage src/app/admin/proctoring \
  src/components/proctoring/admin/RecordingPlayer.tsx src/components/proctoring/admin/ScreenshotGallery.tsx \
  tests/proctoring-storage-keys.test.ts tests/proctoring-storage-mock.test.ts \
  tests/proctoring-quota-db.test.ts tests/proctoring-quota-math.test.ts tests/proctoring-upload-api.test.ts
```

- [ ] **Step 3: Rewrite the config test (it fails until Step 4)**

`tests/proctoring-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getProctoringConfig, resetProctoringConfigForTests } from '@/lib/proctoring/config'

/**
 * Proctoring config. Metadata-only since the live-monitoring phase: there is
 * no storage provider and no credential, so none may be required.
 */

const KEYS = [
  'PROCTORING_ENABLED', 'PROCTORING_OPERATIONAL', 'PROCTORING_RETENTION_HOURS',
  'PROCTORING_GAZE_WARNING_MS', 'PROCTORING_GAZE_WARNING_COOLDOWN_MS',
  'PROCTORING_FACE_MISSING_WARNING_MS', 'PROCTORING_MULTIPLE_FACES_WARNING_MS',
  'PROCTORING_SCREEN_REQUIRED', 'PROCTORING_HEARTBEAT_INTERVAL_MS', 'PROCTORING_STALE_SESSION_MS',
  'PROCTORING_STORAGE_PROVIDER', 'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
]
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  KEYS.forEach(k => { saved[k] = process.env[k]; delete process.env[k] })
  resetProctoringConfigForTests()
})

afterEach(() => {
  KEYS.forEach(k => {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  })
  resetProctoringConfigForTests()
})

describe('getProctoringConfig', () => {
  it('defaults to disabled with the documented heartbeat and stale windows', () => {
    const c = getProctoringConfig()
    expect(c.enabled).toBe(false)
    expect(c.operational).toBe(true)
    expect(c.screenRequired).toBe(true)
    expect(c.retentionHours).toBe(72)
    expect(c.heartbeatIntervalMs).toBe(20_000)
    expect(c.staleSessionMs).toBe(180_000)
  })

  it('coerces numeric strings', () => {
    process.env.PROCTORING_HEARTBEAT_INTERVAL_MS = '15000'
    expect(getProctoringConfig().heartbeatIntervalMs).toBe(15_000)
  })

  it('treats "true" and "1" as true and everything else as false', () => {
    process.env.PROCTORING_ENABLED = '1'
    expect(getProctoringConfig().enabled).toBe(true)
    resetProctoringConfigForTests()
    process.env.PROCTORING_ENABLED = 'yes'
    expect(getProctoringConfig().enabled).toBe(false)
  })

  it('throws on an out-of-range value instead of using it', () => {
    process.env.PROCTORING_HEARTBEAT_INTERVAL_MS = '10'
    expect(() => getProctoringConfig()).toThrow(/PROCTORING_HEARTBEAT_INTERVAL_MS/)
  })

  it('throws on a non-numeric value instead of coercing to NaN', () => {
    process.env.PROCTORING_STALE_SESSION_MS = 'soon'
    expect(() => getProctoringConfig()).toThrow()
  })

  it('treats an empty string as unset', () => {
    process.env.PROCTORING_RETENTION_HOURS = ''
    expect(getProctoringConfig().retentionHours).toBe(72)
  })

  it('needs no storage provider or credentials, and ignores leftovers', () => {
    process.env.PROCTORING_ENABLED = 'true'
    process.env.PROCTORING_STORAGE_PROVIDER = 'r2' // stale value from an old .env
    const c = getProctoringConfig()
    expect(c.enabled).toBe(true)
    expect(Object.keys(c)).not.toContain('storageProvider')
    expect(Object.keys(c).join(',')).not.toMatch(/storage|bytes|r2/i)
  })
})
```

- [ ] **Step 4: Replace `src/lib/proctoring/config.ts`**

```ts
import { z } from 'zod'

/**
 * Proctoring configuration, read once and validated.
 *
 * Metadata-only: proctoring stores no media, so there is no storage provider,
 * no byte budget and no credential here - and a deployment with none of those
 * set runs proctoring normally. Every value has a default.
 */

export const PROCTORING_VERSION = '1'

/**
 * Coerce "true"/"1" to true; anything else uses the default.
 *
 * An empty string counts as unset: .env.example ships `VAR=""` placeholders and
 * dotenv loads those as '' rather than leaving the key absent.
 */
const bool = (dflt: boolean) =>
  z.string().optional().transform(v => (v === undefined || v === '' ? dflt : v === 'true' || v === '1'))

const int = (dflt: number, min: number, max: number) =>
  z.string().optional().transform(v => (v === undefined || v === '' ? dflt : Number(v)))
    .pipe(z.number().int().min(min).max(max))

const schema = z.object({
  PROCTORING_ENABLED: bool(false),
  PROCTORING_OPERATIONAL: bool(true),
  PROCTORING_RETENTION_HOURS: int(72, 1, 720),

  PROCTORING_GAZE_WARNING_MS: int(1_500, 200, 30_000),
  PROCTORING_GAZE_WARNING_COOLDOWN_MS: int(10_000, 1_000, 120_000),
  PROCTORING_FACE_MISSING_WARNING_MS: int(3_000, 500, 60_000),
  PROCTORING_MULTIPLE_FACES_WARNING_MS: int(3_000, 500, 60_000),

  PROCTORING_SCREEN_REQUIRED: bool(true),
  PROCTORING_HEARTBEAT_INTERVAL_MS: int(20_000, 5_000, 120_000),
  // A session with no heartbeat for this long is treated as abandoned.
  PROCTORING_STALE_SESSION_MS: int(180_000, 60_000, 3_600_000),
})

export interface ProctoringConfig {
  enabled: boolean
  operational: boolean
  retentionHours: number
  gazeWarningMs: number
  gazeWarningCooldownMs: number
  faceMissingWarningMs: number
  multipleFacesWarningMs: number
  screenRequired: boolean
  heartbeatIntervalMs: number
  staleSessionMs: number
  version: string
}

let cached: ProctoringConfig | null = null

export function getProctoringConfig(): ProctoringConfig {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const detail = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid proctoring configuration: ${detail}`)
  }
  const e = parsed.data
  cached = {
    enabled: e.PROCTORING_ENABLED,
    operational: e.PROCTORING_OPERATIONAL,
    retentionHours: e.PROCTORING_RETENTION_HOURS,
    gazeWarningMs: e.PROCTORING_GAZE_WARNING_MS,
    gazeWarningCooldownMs: e.PROCTORING_GAZE_WARNING_COOLDOWN_MS,
    faceMissingWarningMs: e.PROCTORING_FACE_MISSING_WARNING_MS,
    multipleFacesWarningMs: e.PROCTORING_MULTIPLE_FACES_WARNING_MS,
    screenRequired: e.PROCTORING_SCREEN_REQUIRED,
    heartbeatIntervalMs: e.PROCTORING_HEARTBEAT_INTERVAL_MS,
    staleSessionMs: e.PROCTORING_STALE_SESSION_MS,
    version: PROCTORING_VERSION,
  }
  return cached
}

/** Test-only: drop the memoised config so a test can vary process.env. */
export function resetProctoringConfigForTests(): void {
  cached = null
}
```

- [ ] **Step 5: Drop `StartEligibility` and `UploadState` from `src/lib/proctoring/types.ts`**

Delete the `export type UploadState = …` line and the whole `export interface StartEligibility { … }` block. Leave `AttemptKind`, `GazeDirection` and `ProctoringClientState` unchanged. The client still uses the old state names until Task 11.

- [ ] **Step 6: Replace `src/lib/proctoring/session.ts`**

```ts
import type { ProctoringSessionStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  HttpError,
  requireScheduledAttempt,
  requireWalkInAttempt,
  assignedQuestionIds,
} from '@/lib/attempt-auth'
import { getProctoringConfig } from './config'
import type { AttemptKind } from './types'

/**
 * Proctoring session lifecycle.
 *
 * resolveOwnedAttempt is the single place that knows there are two attempt
 * tables. Everything above it works with ResolvedAttempt, so a route never
 * branches on kind.
 */

export interface ResolvedAttempt {
  kind: AttemptKind
  attemptId: string
  studentId: string
  proctoringEnabled: boolean
  durationMinutes: number
  startedAt: Date | null
  expiresAt: Date | null
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

/** A session in one of these states is still running. */
export const LIVE_STATUSES: ProctoringSessionStatus[] = ['PENDING', 'ACTIVE', 'DEGRADED']

const SESSION_VIEW_SELECT = {
  id: true, status: true, startedAt: true, retentionExpiresAt: true, version: true,
} as const

/**
 * Load an attempt of either kind, proving ownership. The require*Attempt
 * helpers return 404 (never 403) for a non-owner, so this endpoint cannot be
 * used to confirm that an attempt id exists.
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
      expiresAt: a.expiresAt,
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
    expiresAt: a.expiresAt,
    isSubmitted: a.isSubmitted,
    questionIds: assignedQuestionIds(a.questionIds),
  }
}

export const linkFor = (a: ResolvedAttempt) =>
  a.kind === 'scheduled' ? { testAttemptId: a.attemptId } : { walkInAttemptId: a.attemptId }

export async function activeSessionFor(a: ResolvedAttempt): Promise<SessionView | null> {
  return prisma.proctoringSession.findFirst({
    where: { ...linkFor(a), status: { in: LIVE_STATUSES } },
    select: SESSION_VIEW_SELECT,
  })
}

/**
 * Whether proctored sessions may start at all. A deployment switch, not a
 * capacity check - nothing is stored that could run out.
 */
export function assertProctoringAvailable(cfg = getProctoringConfig()): void {
  if (!cfg.enabled) throw new HttpError(503, 'PROCTORING_DISABLED')
  if (!cfg.operational) throw new HttpError(503, 'PROCTORING_NOT_OPERATIONAL')
}

/**
 * Create or resume the session for an attempt. Idempotent: a refresh, a
 * double-clicked Start, or a recovery all land here and reuse one session.
 */
export async function startSession(a: ResolvedAttempt): Promise<SessionView> {
  const cfg = getProctoringConfig()

  if (!a.proctoringEnabled) throw new HttpError(400, 'This assessment is not proctored')
  if (a.isSubmitted) throw new HttpError(409, 'Test already submitted')

  const existing = await activeSessionFor(a)
  if (existing) return existing

  assertProctoringAvailable(cfg)

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
      },
      select: SESSION_VIEW_SELECT,
    })
  } catch (err) {
    // Two tabs racing: the unique index on the attempt FK picks a winner.
    if ((err as { code?: string }).code !== 'P2002') throw err
    const winner = await activeSessionFor(a)
    if (winner) return winner
    throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
  }
}

/** Idempotent by construction - it only stamps the latest state. */
export async function recordHeartbeat(
  sessionId: string,
  patch: { screenSharing: boolean; degraded: boolean }
): Promise<void> {
  await prisma.proctoringSession.updateMany({
    // Guarded on status, so a late heartbeat cannot resurrect a closed session.
    where: { id: sessionId, status: { in: ['ACTIVE', 'DEGRADED'] } },
    data: {
      lastHeartbeatAt: new Date(),
      // A latch: "did screen sharing ever start?". `undefined` deliberately
      // leaves the column alone once it is true.
      screenShareStarted: patch.screenSharing || undefined,
      status: patch.degraded ? 'DEGRADED' : 'ACTIVE',
    },
  })
}

/** Close a session. Idempotent: the status guard makes a second call a no-op. */
export async function finalizeSession(
  sessionId: string,
  status: 'COMPLETED' | 'INTERRUPTED' = 'COMPLETED'
): Promise<void> {
  await prisma.proctoringSession.updateMany({
    where: { id: sessionId, status: { in: LIVE_STATUSES } },
    data: { status, endedAt: new Date() },
  })
}

/**
 * Close sessions whose browser vanished. Marked INTERRUPTED, not deleted, so
 * their events stay reviewable. Bounded - the pg pool is small.
 */
export async function sweepStaleSessions(now = new Date()): Promise<number> {
  const cfg = getProctoringConfig()
  const cutoff = new Date(now.getTime() - cfg.staleSessionMs)
  const stale = await prisma.proctoringSession.findMany({
    where: {
      status: { in: LIVE_STATUSES },
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { lastHeartbeatAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
    take: 200,
  })
  let interrupted = 0
  for (const s of stale) {
    const updated = await prisma.proctoringSession.updateMany({
      where: { id: s.id, status: { in: LIVE_STATUSES } },
      data: { status: 'INTERRUPTED', endedAt: now },
    })
    interrupted += updated.count
  }
  return interrupted
}
```

- [ ] **Step 7: Replace `src/lib/proctoring/retention.ts`**

```ts
import { prisma } from '@/lib/db'
import { sweepStaleSessions } from './session'

/**
 * Scheduled housekeeping for proctoring sessions.
 *
 * Metadata only: there are no media objects to delete. What remains is closing
 * sessions whose browser vanished, and marking sessions past their retention
 * window EXPIRED so they can never be resumed. Event rows are kept for review.
 *
 * Bounded and idempotent: GitHub's scheduler runs late and occasionally not at
 * all, so a multi-day gap is an expected input.
 */

export interface CleanupReport {
  sessionsExpired: number
  staleSessionsInterrupted: number
}

export async function runRetentionCleanup(opts: { now?: Date } = {}): Promise<CleanupReport> {
  const now = opts.now ?? new Date()
  const expired = await prisma.proctoringSession.updateMany({
    where: { retentionExpiresAt: { lte: now }, status: { in: ['COMPLETED', 'INTERRUPTED'] } },
    data: { status: 'EXPIRED' },
  })
  const staleSessionsInterrupted = await sweepStaleSessions(now)
  return { sessionsExpired: expired.count, staleSessionsInterrupted }
}
```

In `src/app/api/cron/proctoring-cleanup/route.ts`, change only the doc comment's second paragraph to: "The blast radius of a leaked secret is an early close of already-stale sessions - no data is deleted through this endpoint." In `.github/workflows/proctoring-cleanup.yml`, change the first comment paragraph to: "Closes proctoring sessions whose browser stopped sending heartbeats and expires sessions past retention. Catch-up capable and safe to run repeatedly."

- [ ] **Step 8: Rewrite `tests/proctoring-retention.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { runRetentionCleanup } from '@/lib/proctoring/retention'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'
import { POST as cleanupRoute } from '@/app/api/cron/proctoring-cleanup/route'

/** Session housekeeping against a real database. No storage is involved. */

const TAG = `retention-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
let profileId = ''
let userId = ''
const attemptIds: string[] = []

async function sessionFor(data: {
  status: 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED'
  lastHeartbeatAt?: Date | null
  retentionExpiresAt: Date
}) {
  const attempt = await prisma.testAttempt.create({
    data: { scheduleId, studentId: profileId, userId, questionIds: [] },
  })
  attemptIds.push(attempt.id)
  return prisma.proctoringSession.create({
    data: {
      testAttemptId: attempt.id,
      status: data.status,
      startedAt: new Date(),
      lastHeartbeatAt: data.lastHeartbeatAt === undefined ? new Date() : data.lastHeartbeatAt,
      retentionExpiresAt: data.retentionExpiresAt,
    },
  })
}

beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college` } })
  collegeId = college.id
  const test = await prisma.test.create({
    data: { title: TAG, durationMinutes: 60, proctoringEnabled: true, assessmentConfig: [] },
  })
  testId = test.id
  const schedule = await prisma.testSchedule.create({
    data: { testId, collegeId, scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
  })
  scheduleId = schedule.id
})

beforeEach(async () => {
  // One student per case: TestAttempt is unique on (scheduleId, studentId).
  const email = `${TAG}-${Math.random().toString(36).slice(2)}@example.test`
  const user = await prisma.user.create({ data: { email, name: TAG, password: 'x', role: 'STUDENT' } })
  userId = user.id
  const profile = await prisma.studentProfile.create({ data: { userId, collegeId, fullName: TAG, email } })
  profileId = profile.id
  resetProctoringConfigForTests()
})

afterAll(async () => {
  await prisma.proctoringSession.deleteMany({ where: { testAttemptId: { in: attemptIds } } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  const profiles = await prisma.studentProfile.findMany({ where: { collegeId }, select: { userId: true } })
  await prisma.studentProfile.deleteMany({ where: { collegeId } })
  await prisma.user.deleteMany({ where: { id: { in: profiles.map(p => p.userId) } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

const future = () => new Date(Date.now() + 72 * 3_600_000)
const past = () => new Date(Date.now() - 1000)

describe('runRetentionCleanup', () => {
  it('expires a completed session past its retention window', async () => {
    const s = await sessionFor({ status: 'COMPLETED', retentionExpiresAt: past() })
    await runRetentionCleanup()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('EXPIRED')
  })

  it('leaves a completed session inside its window alone', async () => {
    const s = await sessionFor({ status: 'COMPLETED', retentionExpiresAt: future() })
    await runRetentionCleanup()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('COMPLETED')
  })

  it('interrupts a live session whose heartbeat went stale', async () => {
    const s = await sessionFor({
      status: 'ACTIVE',
      lastHeartbeatAt: new Date(Date.now() - 10 * 60_000),
      retentionExpiresAt: future(),
    })
    const report = await runRetentionCleanup()
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('INTERRUPTED')
    expect(row.endedAt).not.toBeNull()
    expect(report.staleSessionsInterrupted).toBeGreaterThanOrEqual(1)
  })

  it('leaves a live session with a fresh heartbeat alone', async () => {
    const s = await sessionFor({ status: 'ACTIVE', retentionExpiresAt: future() })
    await runRetentionCleanup()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('ACTIVE')
  })

  it('is safe to run twice', async () => {
    const s = await sessionFor({ status: 'COMPLETED', retentionExpiresAt: past() })
    await runRetentionCleanup()
    await runRetentionCleanup()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('EXPIRED')
  })
})

describe('POST /api/cron/proctoring-cleanup', () => {
  const REAL_SECRET = 'test-cron-secret-0123456789'
  let savedSecret: string | undefined

  function call(authorization?: string): Promise<Response> {
    return cleanupRoute(new Request('http://localhost/api/cron/proctoring-cleanup', {
      method: 'POST',
      headers: authorization ? { authorization } : {},
    }) as never)
  }

  beforeEach(() => {
    savedSecret = process.env.CRON_SECRET
    process.env.CRON_SECRET = REAL_SECRET
  })

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = savedSecret
  })

  it('runs the cleanup for a correct secret and reports metadata-only counts', async () => {
    const res = await call(`Bearer ${REAL_SECRET}`)
    expect(res.status).toBe(200)
    const report = await res.json()
    expect(Object.keys(report).sort()).toEqual(['sessionsExpired', 'staleSessionsInterrupted'])
  })

  it('refuses a wrong secret with 401 and no detail', async () => {
    const res = await call('Bearer wrong')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('refuses a missing header with 401', async () => {
    expect((await call()).status).toBe(401)
  })

  it('accepts a bare token but not a different one', async () => {
    expect((await call(REAL_SECRET)).status).toBe(200)
    expect((await call(`Bearer ${REAL_SECRET}x`)).status).toBe(401)
  })

  it('reports 503 rather than running unauthenticated when the secret is unset', async () => {
    delete process.env.CRON_SECRET
    expect((await call('Bearer anything')).status).toBe(503)
  })
})
```

`beforeEach` gives each case a fresh student, because `TestAttempt` is unique on `(scheduleId, studentId)`.

- [ ] **Step 9: Replace `src/lib/proctoring/admin.ts`**

```ts
import { prisma } from '@/lib/db'
import type { AttemptKind } from './types'

/**
 * Read model for the admin review UI. Metadata only: a session summary and its
 * observation events. `select`, never `omit`, so a column added later is absent
 * until someone decides it belongs here.
 */

export interface AdminEventView {
  id: string
  type: string
  direction: string | null
  occurredAt: Date
  elapsedMs: number | null
  durationMs: number | null
  severity: string
  questionId: string | null
}

export interface AdminSessionView {
  id: string
  status: string
  version: string
  startedAt: Date | null
  endedAt: Date | null
  lastHeartbeatAt: Date | null
  retentionExpiresAt: Date
  screenShareStarted: boolean
  gazeWarningCount: number
}

export interface AdminEvidence {
  /** Null when the attempt was never proctored. Not an error. */
  session: AdminSessionView | null
  events: AdminEventView[]
}

const EVENT_SELECT = {
  id: true, type: true, direction: true, occurredAt: true, elapsedMs: true,
  durationMs: true, severity: true, questionId: true,
} as const

const SESSION_SELECT = {
  id: true, status: true, version: true, startedAt: true, endedAt: true,
  lastHeartbeatAt: true, retentionExpiresAt: true, screenShareStarted: true,
  gazeWarningCount: true,
} as const

export async function getAdminEvidence(attemptId: string, type: AttemptKind): Promise<AdminEvidence> {
  const where = type === 'scheduled' ? { testAttemptId: attemptId } : { walkInAttemptId: attemptId }
  const session = await prisma.proctoringSession.findFirst({ where, select: SESSION_SELECT })
  if (!session) return { session: null, events: [] }
  const events = await prisma.proctoringEvent.findMany({
    where: { proctoringSessionId: session.id },
    select: EVENT_SELECT,
    orderBy: { occurredAt: 'asc' },
  })
  return { session, events }
}
```

Update the doc comment in `src/app/api/admin/proctoring/[attemptId]/route.ts` to: "Proctoring observations for one attempt, addressed as ?type=scheduled|walkin like /api/admin/results/detail. Metadata only." The code is unchanged.

- [ ] **Step 10: Rewrite `tests/proctoring-admin-api.test.ts` without assets or usage**

Keep lines 1–23 (header comment plus `vi.mock('next-auth', …)`) but change the first comment sentence to "Admin evidence, against a real database." Then replace everything from the imports to the end with:

```ts
import { prisma } from '@/lib/db'
import { getAdminEvidence } from '@/lib/proctoring/admin'
import { requireAdmin, HttpError } from '@/lib/attempt-auth'

const TAG = `admin-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
let scheduledAttemptId = ''
let walkInAttemptId = ''
let unproctoredAttemptId = ''
let scheduledSessionId = ''
let walkInSessionId = ''
let adminEmail = ''
let studentEmail = ''
const userIds: string[] = []
const retentionExpiresAt = new Date(Date.now() + 72 * 3_600_000)

async function makeUser(role: 'APP_ADMIN' | 'STUDENT', suffix: string) {
  const email = `${TAG}-${suffix}@example.test`
  const user = await prisma.user.create({ data: { email, name: `${TAG}-${suffix}`, password: 'x', role } })
  userIds.push(user.id)
  return { id: user.id, email }
}

beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college` } })
  collegeId = college.id
  const test = await prisma.test.create({
    data: { title: `${TAG}-test`, durationMinutes: 60, proctoringEnabled: true, assessmentConfig: [{ area: 'APTITUDE', count: 1 }] },
  })
  testId = test.id
  const schedule = await prisma.testSchedule.create({
    data: { testId, collegeId, scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
  })
  scheduleId = schedule.id

  adminEmail = (await makeUser('APP_ADMIN', 'admin')).email
  const student = await makeUser('STUDENT', 'student')
  studentEmail = student.email
  const profile = await prisma.studentProfile.create({
    data: { userId: student.id, collegeId, fullName: TAG, email: student.email },
  })
  scheduledAttemptId = (await prisma.testAttempt.create({
    data: { scheduleId, studentId: profile.id, userId: student.id, questionIds: ['qA', 'qB'] },
  })).id
  walkInAttemptId = (await prisma.walkInAttempt.create({
    data: { testId, studentId: profile.id, userId: student.id, questionIds: ['qA'] },
  })).id

  const other = await makeUser('STUDENT', 'other')
  const otherProfile = await prisma.studentProfile.create({
    data: { userId: other.id, collegeId, fullName: `${TAG}-other`, email: other.email },
  })
  unproctoredAttemptId = (await prisma.testAttempt.create({
    data: { scheduleId, studentId: otherProfile.id, userId: other.id, questionIds: ['qA'] },
  })).id

  scheduledSessionId = (await prisma.proctoringSession.create({
    data: {
      testAttemptId: scheduledAttemptId, status: 'COMPLETED',
      startedAt: new Date(Date.now() - 3_600_000), endedAt: new Date(),
      retentionExpiresAt, screenShareStarted: true, gazeWarningCount: 2,
    },
  })).id
  walkInSessionId = (await prisma.proctoringSession.create({
    data: { walkInAttemptId, status: 'COMPLETED', startedAt: new Date(Date.now() - 1_800_000), retentionExpiresAt },
  })).id

  await prisma.proctoringEvent.createMany({
    data: [
      {
        proctoringSessionId: scheduledSessionId, clientEventId: `${TAG}-e1`, type: 'GAZE_LEFT',
        direction: 'LEFT', occurredAt: new Date(Date.now() - 1000), elapsedMs: 255_000,
        durationMs: 2100, severity: 'WARN',
      },
      {
        proctoringSessionId: scheduledSessionId, clientEventId: `${TAG}-e2`, type: 'SCREEN_SHARE_STOPPED',
        occurredAt: new Date(Date.now() - 500), elapsedMs: 1_112_000, severity: 'WARN',
      },
    ],
  })
})

afterAll(async () => {
  const sessionIds = [scheduledSessionId, walkInSessionId]
  await prisma.proctoringEvent.deleteMany({ where: { proctoringSessionId: { in: sessionIds } } })
  await prisma.proctoringSession.deleteMany({ where: { id: { in: sessionIds } } })
  await prisma.walkInAttempt.deleteMany({ where: { testId } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

beforeEach(() => {
  getServerSession.mockReset()
})

describe('getAdminEvidence', () => {
  it('returns the session and events for a scheduled attempt', async () => {
    const evidence = await getAdminEvidence(scheduledAttemptId, 'scheduled')
    expect(evidence.session?.id).toBe(scheduledSessionId)
    expect(evidence.session?.gazeWarningCount).toBe(2)
    expect(evidence.events.length).toBe(2)
  })

  it('returns the session for a walk-in attempt', async () => {
    expect((await getAdminEvidence(walkInAttemptId, 'walkin')).session?.id).toBe(walkInSessionId)
  })

  it('does not cross the two attempt kinds', async () => {
    expect((await getAdminEvidence(scheduledAttemptId, 'walkin')).session).toBeNull()
    expect((await getAdminEvidence(walkInAttemptId, 'scheduled')).session).toBeNull()
  })

  it('returns a null session for a never-proctored attempt rather than throwing', async () => {
    expect(await getAdminEvidence(unproctoredAttemptId, 'scheduled')).toEqual({ session: null, events: [] })
  })

  it('carries no media reference of any kind', async () => {
    const body = JSON.stringify(await getAdminEvidence(scheduledAttemptId, 'scheduled'))
    expect(body).not.toMatch(/objectKey|assets|uploadUrl|X-Amz|http|storage|recording/i)
  })

  it('orders events by time', async () => {
    const evidence = await getAdminEvidence(scheduledAttemptId, 'scheduled')
    const times = evidence.events.map(e => new Date(e.occurredAt).getTime())
    expect(times[0]).toBeLessThanOrEqual(times[1])
  })
})

describe('requireAdmin on the proctoring endpoints', () => {
  it('rejects an unauthenticated caller with 401', async () => {
    getServerSession.mockResolvedValue(null)
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an authenticated student with 403, not 401', async () => {
    getServerSession.mockResolvedValue({ user: { email: studentEmail, role: 'STUDENT' } })
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 })
  })

  it('accepts an APP_ADMIN', async () => {
    getServerSession.mockResolvedValue({ user: { email: adminEmail, role: 'APP_ADMIN' } })
    expect((await requireAdmin()).email).toBe(adminEmail)
  })

  it('rejects a deactivated admin with 401', async () => {
    const gone = await makeUser('APP_ADMIN', 'deactivated')
    await prisma.user.update({ where: { id: gone.id }, data: { isActive: false } })
    getServerSession.mockResolvedValue({ user: { email: gone.email, role: 'APP_ADMIN' } })
    await expect(requireAdmin()).rejects.toBeInstanceOf(HttpError)
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 })
  })
})
```

Also change the vitest import on line 1 to `import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'`. It is unchanged, but confirm it.

- [ ] **Step 11: Trim schemas, the heartbeat route and the session route**

In `src/lib/proctoring/schemas.ts`: delete `assetTypeSchema`, `WEBCAM_CONTENT_TYPES`, `SCREENSHOT_CONTENT_TYPES`, `uploadUrlSchema` and `assetCompleteSchema`; remove `'UPLOAD_FAILURE', 'UPLOAD_RECOVERED'` from `eventTypeSchema`; and replace `heartbeatSchema` with:

```ts
export const heartbeatSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  parentId: idSchema,
  screenSharing: z.boolean(),
  cameraLive: z.boolean(),
  micLive: z.boolean(),
  clientVersion: z.string().max(32).optional(),
})
```

In `src/app/api/student/proctoring/heartbeat/route.ts`, replace the two statements from `const degraded = …` to the closing `})` of `recordHeartbeat(...)` with:

```ts
    // Any required device down is a degraded session. There is no recording
    // or upload backlog to report any more - only live device health.
    const degraded = !body.cameraLive || !body.micLive || !body.screenSharing
    await recordHeartbeat(session.id, { screenSharing: body.screenSharing, degraded })
```

In `src/app/api/student/proctoring/session/route.ts`, replace the `config: { … }` object with:

```ts
      config: {
        gazeWarningMs: cfg.gazeWarningMs,
        gazeWarningCooldownMs: cfg.gazeWarningCooldownMs,
        faceMissingWarningMs: cfg.faceMissingWarningMs,
        multipleFacesWarningMs: cfg.multipleFacesWarningMs,
        heartbeatIntervalMs: cfg.heartbeatIntervalMs,
        screenRequired: cfg.screenRequired,
      },
```

- [ ] **Step 12: Timeline-only admin panel and sidebar**

Replace `src/components/proctoring/admin/ProctoringPanel.tsx` with:

```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import EventTimeline, { type TimelineEvent } from './EventTimeline'

/**
 * The proctoring section of the results detail modal. Collapsed by default and
 * fetching nothing until opened, so score review is unchanged for reviewers who
 * never expand it. Metadata only: there is no recording to play.
 */

interface Evidence {
  session: {
    id: string
    status: string
    version: string
    startedAt: string | null
    endedAt: string | null
    lastHeartbeatAt: string | null
    screenShareStarted: boolean
    gazeWarningCount: number
  } | null
  events: TimelineEvent[]
}

export default function ProctoringPanel({
  attemptId,
  type,
}: {
  attemptId: string
  type: 'scheduled' | 'walkin'
  questionOrder?: string[]
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<Evidence | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/proctoring/${attemptId}?type=${type}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Could not load proctoring observations.')
        return
      }
      setEvidence(data as Evidence)
    } catch {
      setError('Could not load proctoring observations.')
    } finally {
      setLoading(false)
    }
  }, [attemptId, type])

  useEffect(() => {
    if (open && !evidence && !loading && !error) void load()
  }, [open, evidence, loading, error, load])

  return (
    <div className="border-b border-gray-100">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-6 py-3 flex items-center gap-2 text-sm text-gray-700 hover:bg-gray-50"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <ShieldCheck size={15} className="text-brand-purple" />
        <span className="font-medium">Proctoring observations</span>
        <span className="text-xs text-gray-400 ml-auto">{open ? 'Hide' : 'Review monitoring events'}</span>
      </button>

      {open && (
        <div className="px-6 pb-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          )}
          {error && !loading && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
          )}
          {!loading && !error && evidence && !evidence.session && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
              <ShieldOff size={22} className="text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 font-medium">This attempt was not proctored</p>
            </div>
          )}
          {!loading && !error && evidence?.session && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
                <span>Session <span className="text-gray-700">{evidence.session.status.toLowerCase()}</span></span>
                <span>Detection version <span className="text-gray-700">{evidence.session.version}</span></span>
                <span>Screen sharing <span className="text-gray-700">{evidence.session.screenShareStarted ? 'started' : 'never started'}</span></span>
              </div>
              <EventTimeline events={evidence.events} />
              <p className="text-xs text-gray-400 leading-relaxed">
                Observations describe what the browser detected, not what it means. No video, audio
                or screenshots were stored. Gaze analysis is an estimate and cannot distinguish
                thinking from looking away.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

In `src/components/admin/AdminSidebar.tsx`, delete the line `{ href: '/admin/proctoring', label: 'Proctoring Usage', icon: ShieldCheck },`. Then run `grep -n ShieldCheck src/components/admin/AdminSidebar.tsx`. If nothing else uses it, remove `ShieldCheck` from the lucide import on line 10.

- [ ] **Step 13: `.env.example` proctoring block**

Replace everything from `# Proctoring (optional feature, off by default)` down to the line before `# Shared secret for the retention cleanup endpoint` with:

```bash
# Proctoring (optional feature, off by default)
#
# Proctoring is opt-in per test via Test.proctoringEnabled. With
# PROCTORING_ENABLED unset, no test can be proctored regardless of that column,
# so this is the global kill switch.
#
# Live monitoring only: no video, audio or screenshots are recorded or stored,
# so no storage provider or credential is needed. Only metadata events are
# logged. Detection thresholds live in code
# (src/lib/proctoring/client/detection-config.ts), not here.
PROCTORING_ENABLED="false"

# Set false to stop new proctored attempts without a deploy.
PROCTORING_OPERATIONAL="true"

# After this many hours a closed session is marked EXPIRED and can no longer be
# resumed. Its events are kept for review.
PROCTORING_RETENTION_HOURS="72"

PROCTORING_SCREEN_REQUIRED="true"
PROCTORING_HEARTBEAT_INTERVAL_MS="20000"
PROCTORING_STALE_SESSION_MS="180000"

```

The gaze env vars are left out deliberately. The code still reads them until Task 6, and their defaults apply.

- [ ] **Step 14: Edit `tests/proctoring-session-api.test.ts`**

1. Delete the constants `BIG_BUDGET` and `TINY_BUDGET` and the last paragraph of the header comment ("The storage budget is overridden…").
2. In `beforeEach`, delete the `PROCTORING_STORAGE_PROVIDER` and `PROCTORING_STORAGE_SAFETY_BYTES` lines.
3. Rename `'creates an ACTIVE session and reserves bytes'` to `'creates an ACTIVE session'` and delete its `expect(row.storageReservedBytes).toBe(111_000_000)` line.
4. Delete the whole `it('refuses with 503 and the quota reason when the budget is exhausted', …)`.
5. In `describe('recordHeartbeat')`: replace every `{ recording: true, screenSharing: true, degraded: X }` with `{ screenSharing: true, degraded: X }`, delete `expect(row.recordingStarted).toBe(true)`, rename `'sets DEGRADED when the client reports a backlog, and recovers'` to `'sets DEGRADED when a device is down, and recovers'`, and change the comment mentioning `sweepStaleReservations` to `sweepStaleSessions`.
6. In `'marks COMPLETED, stamps endedAt, and zeroes the reservation'`, rename it to `'marks COMPLETED and stamps endedAt'` and delete the two `storage*Bytes` expectations.

- [ ] **Step 15: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. If a file still imports `./quota`, `./storage` or `./upload`, it is a leftover. Fix it in place and do not restore the module.

Run: `npx vitest run`
Expected: all files pass. Deleted suites are simply absent.

Run: `grep -rn "aws-sdk\|getStorage\|quota\|storageReservedBytes\|recordingStarted" src tests`
Expected: no output.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 1: remove media storage, uploads and quota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: Event taxonomy and the metadata-only migration

**Files:**
- Create: `src/lib/proctoring/event-types.ts`, `prisma/migrations/<timestamp>_proctoring_metadata_only/migration.sql`
- Modify: `prisma/schema.prisma`, `src/lib/proctoring/schemas.ts`, `src/lib/proctoring/events.ts`, `src/lib/proctoring/admin.ts`, `src/components/proctoring/admin/EventTimeline.tsx`
- Test: `tests/proctoring-event-types.test.ts` (new), `tests/proctoring-events-api.test.ts` (edit), `tests/proctoring-admin-api.test.ts` (edit)

**Interfaces:**
- Produces: `CLIENT_EVENT_TYPES`, `SERVER_EVENT_TYPES`, `ALL_EVENT_TYPES`, `ClientEventType`, `ServerEventType`, `ProctoringEventTypeName`, `LOOKING_TYPES`, `severityFor(type): 'INFO' | 'WARN'`.
- Produces (wire): an event is `{ clientEventId, type: ClientEventType, startedAt: ISO, endedAt?: ISO, durationMs?, confidence?: 0..1, direction?, elapsedMs?, questionId?, metadata? }`. Severity is derived by the server, never taken from the client.
- DB: `ProctoringEvent.startedAt` (renamed from `occurredAt`), `endedAt`, `confidence`; `ProctoringSession.lastHealth Json?`, `missedHeartbeatCount Int`. `ProctoringAsset` is gone.

- [ ] **Step 1: Write the taxonomy test**

`tests/proctoring-event-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { $Enums } from '@prisma/client'
import {
  ALL_EVENT_TYPES, CLIENT_EVENT_TYPES, SERVER_EVENT_TYPES, severityFor,
} from '@/lib/proctoring/event-types'

describe('proctoring event taxonomy', () => {
  it('matches the database enum exactly, so a new type cannot be half-added', () => {
    const db = Object.values($Enums.ProctoringEventType).slice().sort()
    expect(ALL_EVENT_TYPES.slice().sort()).toEqual(db)
  })

  it('keeps server-only types out of what a client may send', () => {
    SERVER_EVENT_TYPES.forEach(t => {
      expect((CLIENT_EVENT_TYPES as ReadonlyArray<string>).indexOf(t)).toBe(-1)
    })
  })

  it('never names a phone or a verdict', () => {
    expect(ALL_EVENT_TYPES.join(' ')).not.toMatch(/PHONE|CHEAT|CONFIRMED|UPLOAD|RECORD|SCREENSHOT/)
  })

  it('treats returns and focus changes as INFO and interruptions as WARN', () => {
    expect(severityFor('WINDOW_BLUR')).toBe('INFO')
    expect(severityFor('TAB_VISIBLE')).toBe('INFO')
    expect(severityFor('SCREEN_SHARE_INTERRUPTED')).toBe('WARN')
    expect(severityFor('MULTIPLE_FACES')).toBe('WARN')
    expect(severityFor('HEARTBEAT_MISSED')).toBe('WARN')
  })
})
```

Run: `npx vitest run tests/proctoring-event-types.test.ts`
Expected: FAIL, "Cannot find module '@/lib/proctoring/event-types'".

- [ ] **Step 2: Create `src/lib/proctoring/event-types.ts`**

```ts
/**
 * The proctoring event taxonomy, shared by browser and server. No server-only
 * imports, so client code can use it.
 *
 * Every name describes an observation, never a verdict: there is no
 * PHONE_DETECTED (a browser cannot know a phone exists) and nothing like
 * CHEATING. Must match the Prisma enum ProctoringEventType exactly -
 * tests/proctoring-event-types.test.ts enforces it.
 */

export const CLIENT_EVENT_TYPES = [
  'FACE_MISSING',
  'MULTIPLE_FACES',
  'LOOKING_LEFT',
  'LOOKING_RIGHT',
  'LOOKING_UP',
  'LOOKING_DOWN',
  'SUSTAINED_DOWNWARD_ATTENTION',
  'REPEATED_DOWNWARD_ATTENTION',
  'CAMERA_INTERRUPTED',
  'CAMERA_RESTORED',
  'MICROPHONE_INTERRUPTED',
  'MICROPHONE_RESTORED',
  'SCREEN_SHARE_STARTED',
  'SCREEN_SHARE_INTERRUPTED',
  'SCREEN_SHARE_RESUMED',
  'TAB_HIDDEN',
  'TAB_VISIBLE',
  'FULLSCREEN_EXITED',
  'FULLSCREEN_ENTERED',
  'WINDOW_BLUR',
  'WINDOW_FOCUS',
  'PAGE_HIDDEN',
  'GAZE_MONITOR_UNAVAILABLE',
  'PROCTORING_STARTED',
  'PROCTORING_ENDED',
] as const

/**
 * Written only by the server. A client cannot send these: a forged
 * HEARTBEAT_MISSED would be noise, and a suppressed one would hide a gap.
 */
export const SERVER_EVENT_TYPES = ['HEARTBEAT_MISSED', 'PROCTORING_RESUMED'] as const

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number]
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number]
export type ProctoringEventTypeName = ClientEventType | ServerEventType

export const ALL_EVENT_TYPES: ReadonlyArray<ProctoringEventTypeName> =
  (CLIENT_EVENT_TYPES as ReadonlyArray<ProctoringEventTypeName>).concat(SERVER_EVENT_TYPES)

export const LOOKING_TYPES: ReadonlyArray<ProctoringEventTypeName> = [
  'LOOKING_LEFT', 'LOOKING_RIGHT', 'LOOKING_UP', 'LOOKING_DOWN',
]

/**
 * Returns and focus changes are INFO. WINDOW_BLUR is INFO too: a blur is an
 * observation that only means something next to other signals.
 */
const INFO_TYPES: ReadonlyArray<ProctoringEventTypeName> = [
  'TAB_VISIBLE', 'WINDOW_BLUR', 'WINDOW_FOCUS', 'FULLSCREEN_ENTERED', 'FULLSCREEN_EXITED',
  'CAMERA_RESTORED', 'MICROPHONE_RESTORED', 'SCREEN_SHARE_STARTED', 'SCREEN_SHARE_RESUMED',
  'PROCTORING_STARTED', 'PROCTORING_ENDED', 'PROCTORING_RESUMED',
]

export function severityFor(type: ProctoringEventTypeName): 'INFO' | 'WARN' {
  return INFO_TYPES.indexOf(type) === -1 ? 'WARN' : 'INFO'
}
```

- [ ] **Step 3: Edit `prisma/schema.prisma`**

1. Delete `enum ProctoringAssetType`, `enum ProctoringAssetStatus` and `model ProctoringAsset`, including its doc comment.
2. Replace the body of `enum ProctoringEventType` with these 27 values, one per line, in this order: `FACE_MISSING MULTIPLE_FACES LOOKING_LEFT LOOKING_RIGHT LOOKING_UP LOOKING_DOWN SUSTAINED_DOWNWARD_ATTENTION REPEATED_DOWNWARD_ATTENTION CAMERA_INTERRUPTED CAMERA_RESTORED MICROPHONE_INTERRUPTED MICROPHONE_RESTORED SCREEN_SHARE_STARTED SCREEN_SHARE_INTERRUPTED SCREEN_SHARE_RESUMED TAB_HIDDEN TAB_VISIBLE FULLSCREEN_EXITED FULLSCREEN_ENTERED WINDOW_BLUR WINDOW_FOCUS PAGE_HIDDEN GAZE_MONITOR_UNAVAILABLE PROCTORING_STARTED PROCTORING_ENDED HEARTBEAT_MISSED PROCTORING_RESUMED`.
3. In `model ProctoringSession`: delete `recordingStarted`, `storageReservedBytes`, `storageUsedBytes`, `uploadFailureCount` (with the Int/BigInt comment above them) and `assets ProctoringAsset[]`. Change the `retentionExpiresAt` comment to `/// After this instant a closed session is EXPIRED and cannot be resumed.` Add after `gazeWarningCount`:

```prisma
  /// Heartbeat gaps the server detected. Server-side, so a client cannot hide them.
  missedHeartbeatCount Int   @default(0)
  /// Device and monitor health from the latest heartbeat. Small, bounded JSON.
  lastHealth           Json?
```

4. In `model ProctoringEvent`: change the doc comment to "A proctoring observation. Metadata only - never frames, images, audio or landmarks. Evidence for a reviewer, never a verdict or a scoring input." Replace the `occurredAt` field and its comment with:

```prisma
  /// Client clock, when the observation began. Orders events within a batch.
  startedAt  DateTime
  /// When it ended, for episodes that have a duration.
  endedAt    DateTime?
```

Add `confidence Float?` after `durationMs`, and change `@@index([proctoringSessionId, occurredAt])` to `@@index([proctoringSessionId, startedAt])`.

- [ ] **Step 4: Generate a migration shell, then replace its SQL by hand**

Ask the owner to stop the dev server first.

Run: `npx prisma migrate dev --create-only --name proctoring_metadata_only`
Expected: a new folder `prisma/migrations/<timestamp>_proctoring_metadata_only/`.

Do **not** keep the generated SQL. It drops `occurredAt` and adds `startedAt`, which loses data. Replace `migration.sql` entirely with:

```sql
-- Metadata-only proctoring: no media is stored any more.

-- 1. Media storage is gone.
DROP TABLE "ProctoringAsset";
DROP TYPE "ProctoringAssetStatus";
DROP TYPE "ProctoringAssetType";

-- 2. Session: media counters out, health in.
ALTER TABLE "ProctoringSession"
  DROP COLUMN "recordingStarted",
  DROP COLUMN "storageReservedBytes",
  DROP COLUMN "storageUsedBytes",
  DROP COLUMN "uploadFailureCount",
  ADD COLUMN "missedHeartbeatCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastHealth" JSONB;

-- 3. Event taxonomy. Upload events described media that no longer exists.
DELETE FROM "ProctoringEvent" WHERE "type" IN ('UPLOAD_FAILURE', 'UPLOAD_RECOVERED');

CREATE TYPE "ProctoringEventType_new" AS ENUM (
  'FACE_MISSING', 'MULTIPLE_FACES',
  'LOOKING_LEFT', 'LOOKING_RIGHT', 'LOOKING_UP', 'LOOKING_DOWN',
  'SUSTAINED_DOWNWARD_ATTENTION', 'REPEATED_DOWNWARD_ATTENTION',
  'CAMERA_INTERRUPTED', 'CAMERA_RESTORED',
  'MICROPHONE_INTERRUPTED', 'MICROPHONE_RESTORED',
  'SCREEN_SHARE_STARTED', 'SCREEN_SHARE_INTERRUPTED', 'SCREEN_SHARE_RESUMED',
  'TAB_HIDDEN', 'TAB_VISIBLE', 'FULLSCREEN_EXITED', 'FULLSCREEN_ENTERED',
  'WINDOW_BLUR', 'WINDOW_FOCUS', 'PAGE_HIDDEN', 'GAZE_MONITOR_UNAVAILABLE',
  'PROCTORING_STARTED', 'PROCTORING_ENDED',
  'HEARTBEAT_MISSED', 'PROCTORING_RESUMED'
);

ALTER TABLE "ProctoringEvent"
  ALTER COLUMN "type" TYPE "ProctoringEventType_new"
  USING (
    CASE "type"::text
      WHEN 'GAZE_LEFT' THEN 'LOOKING_LEFT'
      WHEN 'GAZE_RIGHT' THEN 'LOOKING_RIGHT'
      WHEN 'GAZE_UP' THEN 'LOOKING_UP'
      WHEN 'GAZE_DOWN' THEN 'LOOKING_DOWN'
      WHEN 'FACE_NOT_DETECTED' THEN 'FACE_MISSING'
      WHEN 'MULTIPLE_FACES_DETECTED' THEN 'MULTIPLE_FACES'
      WHEN 'SCREEN_SHARE_STOPPED' THEN 'SCREEN_SHARE_INTERRUPTED'
      WHEN 'CAMERA_STOPPED' THEN 'CAMERA_INTERRUPTED'
      WHEN 'MICROPHONE_STOPPED' THEN 'MICROPHONE_INTERRUPTED'
      WHEN 'WINDOW_BLURRED' THEN 'WINDOW_BLUR'
      ELSE "type"::text
    END
  )::"ProctoringEventType_new";

DROP TYPE "ProctoringEventType";
ALTER TYPE "ProctoringEventType_new" RENAME TO "ProctoringEventType";

-- 4. Event shape: a start, an optional end, a confidence.
ALTER TABLE "ProctoringEvent" RENAME COLUMN "occurredAt" TO "startedAt";
ALTER TABLE "ProctoringEvent"
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "confidence" DOUBLE PRECISION;
ALTER INDEX "ProctoringEvent_proctoringSessionId_occurredAt_idx"
  RENAME TO "ProctoringEvent_proctoringSessionId_startedAt_idx";
```

- [ ] **Step 5: Apply locally and prove there is no drift**

Run: `npx prisma migrate dev`
Expected: "…_proctoring_metadata_only" applied, then the client is regenerated.

Run: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`
Expected: exit 0, "No difference detected". A non-zero exit means the hand-written SQL and the schema disagree. Fix the SQL in place; do not stack a second migration.

This applies to local Postgres only. Supabase is never touched in this plan.

- [ ] **Step 6: Event schema in `src/lib/proctoring/schemas.ts`**

Add `import { CLIENT_EVENT_TYPES } from './event-types'` at the top. Replace `eventTypeSchema`, `eventSchema`, `eventBatchSchema` and `IncomingEvent` with:

```ts
export const eventTypeSchema = z.enum(CLIENT_EVENT_TYPES)

const MAX_METADATA_KEYS = 12

/**
 * Small and bounded. Values are primitives capped at 200 characters, which is
 * what makes an image or audio payload structurally impossible here - one
 * base64 frame is tens of kilobytes.
 */
const metadataSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
    z.union([z.string().max(200), z.number(), z.boolean()])
  )
  .refine(m => Object.keys(m).length <= MAX_METADATA_KEYS, { message: 'too many metadata keys' })

const eventSchema = z
  .object({
    /**
     * Client-generated and stable across retries: the dedup key. The `srv-`
     * prefix is reserved for server-written rows, so a client cannot claim a
     * server event's id in advance and suppress it.
     */
    clientEventId: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/)
      .refine(id => id.indexOf('srv-') !== 0, { message: 'reserved id prefix' }),
    type: eventTypeSchema,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    durationMs: z.number().int().min(0).max(14_400_000).optional(),
    confidence: z.number().min(0).max(1).optional(),
    direction: z.enum(['LEFT', 'RIGHT', 'UP', 'DOWN']).optional(),
    elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
    questionId: idSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .refine(e => !e.endedAt || Date.parse(e.endedAt) >= Date.parse(e.startedAt), {
    message: 'endedAt must not precede startedAt',
  })

export const eventBatchSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  parentId: idSchema,
  events: z.array(eventSchema).min(1).max(50),
})

export type IncomingEvent = z.infer<typeof eventSchema>
```

- [ ] **Step 7: Replace `src/lib/proctoring/events.ts`**

```ts
import { prisma } from '@/lib/db'
import type { IncomingEvent } from './schemas'
import { LOOKING_TYPES, severityFor } from './event-types'

/**
 * Proctoring event ingest. Metadata only: what the browser concluded, when,
 * for how long, and how confident. Never frames, never landmarks. Evidence for
 * a reviewer, never a scoring input.
 */

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
    startedAt: new Date(e.startedAt),
    endedAt: e.endedAt ? new Date(e.endedAt) : null,
    // The server's receipt time is authoritative over the client clock.
    receivedAt: now,
    elapsedMs: e.elapsedMs ?? null,
    durationMs: e.durationMs ?? null,
    confidence: e.confidence ?? null,
    // Derived, never client-supplied: a client must not be able to file its
    // own interruptions as INFO.
    severity: severityFor(e.type),
    // Same rule as violation/route.ts: kept only if this attempt was served it.
    questionId: e.questionId && assigned.has(e.questionId) ? e.questionId : null,
    metadata: e.metadata ?? undefined,
  }))

  // skipDuplicates makes a retried batch a no-op.
  const result = await prisma.proctoringEvent.createMany({ data: rows, skipDuplicates: true })

  const lookingAccepted = rows.filter(r => LOOKING_TYPES.indexOf(r.type) !== -1).length
  if (result.count > 0 && lookingAccepted > 0) {
    await prisma.proctoringSession.update({
      where: { id: sessionId },
      data: { gazeWarningCount: { increment: Math.min(lookingAccepted, result.count) } },
    })
  }

  return { accepted: result.count, duplicates: rows.length - result.count }
}
```

- [ ] **Step 8: Admin read model and timeline**

`src/lib/proctoring/admin.ts`:
- In `AdminEventView`, replace `occurredAt: Date` with `startedAt: Date`, `endedAt: Date | null`, `confidence: number | null`, `metadata: unknown`.
- In `EVENT_SELECT`, replace `occurredAt: true` with `startedAt: true, endedAt: true, confidence: true, metadata: true`.
- Change `orderBy: { occurredAt: 'asc' }` to `orderBy: { startedAt: 'asc' }`.
- Add `missedHeartbeatCount: number` and `lastHealth: unknown` to `AdminSessionView`, and `missedHeartbeatCount: true, lastHealth: true` to `SESSION_SELECT`.

`src/components/proctoring/admin/EventTimeline.tsx`: replace the `TimelineEvent` interface and the `DESCRIPTION` map with:

```ts
export interface TimelineEvent {
  id: string
  type: string
  direction: string | null
  startedAt: string | Date
  endedAt?: string | Date | null
  elapsedMs: number | null
  durationMs: number | null
  confidence?: number | null
  severity: string
  metadata?: unknown
}

/** Plain descriptions of the observation. No judgement, no severity language. */
const DESCRIPTION: Record<string, string> = {
  FACE_MISSING: 'Face not visible',
  MULTIPLE_FACES: 'More than one face visible',
  LOOKING_LEFT: 'Looking left',
  LOOKING_RIGHT: 'Looking right',
  LOOKING_UP: 'Looking up',
  LOOKING_DOWN: 'Looking down',
  SUSTAINED_DOWNWARD_ATTENTION: 'Sustained downward attention',
  REPEATED_DOWNWARD_ATTENTION: 'Repeated downward attention',
  CAMERA_INTERRUPTED: 'Camera interrupted',
  CAMERA_RESTORED: 'Camera restored',
  MICROPHONE_INTERRUPTED: 'Microphone interrupted',
  MICROPHONE_RESTORED: 'Microphone restored',
  SCREEN_SHARE_STARTED: 'Screen sharing started',
  SCREEN_SHARE_INTERRUPTED: 'Screen sharing interrupted',
  SCREEN_SHARE_RESUMED: 'Screen sharing resumed',
  TAB_HIDDEN: 'Assessment tab hidden',
  TAB_VISIBLE: 'Assessment tab visible again',
  FULLSCREEN_EXITED: 'Left full screen',
  FULLSCREEN_ENTERED: 'Entered full screen',
  WINDOW_BLUR: 'Window lost focus',
  WINDOW_FOCUS: 'Window regained focus',
  PAGE_HIDDEN: 'Page closed or navigated away',
  GAZE_MONITOR_UNAVAILABLE: 'Gaze analysis could not run',
  PROCTORING_STARTED: 'Proctoring started',
  PROCTORING_ENDED: 'Proctoring ended',
  HEARTBEAT_MISSED: 'Proctoring connection gap',
  PROCTORING_RESUMED: 'Proctoring resumed',
}

function describeEvent(e: TimelineEvent): string {
  const base = DESCRIPTION[e.type] ?? e.type.toLowerCase().replace(/_/g, ' ')
  const meta = (e.metadata ?? null) as { horizontal?: unknown } | null
  if (e.type === 'LOOKING_DOWN' && meta && (meta.horizontal === 'LEFT' || meta.horizontal === 'RIGHT')) {
    return `${base} and ${String(meta.horizontal).toLowerCase()}`
  }
  return base
}
```

In the same file: in the sort comparator, replace both `occurredAt` with `startedAt`. Replace `{DESCRIPTION[e.type] ?? e.type.toLowerCase().replace(/_/g, ' ')}` with `{describeEvent(e)}`. Update the doc comment example to "Looking left for 2.1s".

- [ ] **Step 9: Move the DB tests to the new names**

`tests/proctoring-events-api.test.ts`:
- In `gaze()`: use `type: 'LOOKING_LEFT'`, change `occurredAt:` to `startedAt:`, and delete `severity: 'WARN',`.
- In the `TAB_HIDDEN` case: change `occurredAt:` to `startedAt:` and delete `severity: 'INFO',`.
- Rename the "implausible clock" case to `'stamps receivedAt server-side even when startedAt is implausible'`. Inside it, change `occurredAt:` to `startedAt:` and `row.occurredAt` to `row.startedAt`.
- Add `import { eventBatchSchema } from '@/lib/proctoring/schemas'` to the imports.
- Append inside `describe('ingestEvents')`:

```ts
  it('stores endedAt, duration and confidence for an episode', async () => {
    const start = new Date(Date.now() - 3000)
    await ingestEvents(sessionId, [{
      clientEventId: 'evt-episode-00001',
      type: 'FACE_MISSING',
      startedAt: start.toISOString(),
      endedAt: new Date(start.getTime() + 2600).toISOString(),
      durationMs: 2600,
      confidence: 0.9,
    }], ASSIGNED)
    const row = await prisma.proctoringEvent.findFirstOrThrow({
      where: { proctoringSessionId: sessionId, clientEventId: 'evt-episode-00001' },
    })
    expect(row.endedAt!.getTime() - row.startedAt.getTime()).toBe(2600)
    expect(row.durationMs).toBe(2600)
    expect(row.confidence).toBeCloseTo(0.9)
  })

  it('derives severity server-side from the type', async () => {
    await ingestEvents(sessionId, [
      { clientEventId: 'evt-sev-blur-001', type: 'WINDOW_BLUR', startedAt: new Date().toISOString() },
      { clientEventId: 'evt-sev-scrn-001', type: 'SCREEN_SHARE_INTERRUPTED', startedAt: new Date().toISOString() },
    ], ASSIGNED)
    const rows = await prisma.proctoringEvent.findMany({
      where: { proctoringSessionId: sessionId, clientEventId: { in: ['evt-sev-blur-001', 'evt-sev-scrn-001'] } },
      orderBy: { clientEventId: 'asc' },
    })
    expect(rows.map(r => r.severity)).toEqual(['INFO', 'WARN'])
  })
```

- Append at the end of the file:

```ts
describe('eventBatchSchema', () => {
  const base = { attemptId: 'a1', kind: 'scheduled', parentId: 'p1' }
  const ok = { clientEventId: 'evt-schema-00001', type: 'LOOKING_DOWN', startedAt: new Date().toISOString() }

  it('accepts a well-formed metadata event', () => {
    expect(eventBatchSchema.safeParse({ ...base, events: [ok] }).success).toBe(true)
  })

  it('rejects a server-only type from a client', () => {
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, type: 'HEARTBEAT_MISSED' }] }).success).toBe(false)
  })

  it('rejects retired media and gaze names', () => {
    const retired = ['UPLOAD_FAILURE', 'GAZE_LEFT', 'PHONE_DETECTED']
    retired.forEach(type => {
      expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, type }] }).success).toBe(false)
    })
  })

  it('rejects anything shaped like media in metadata', () => {
    const frame = 'data:image/jpeg;base64,' + 'A'.repeat(4000)
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, metadata: { frame } }] }).success).toBe(false)
  })

  it('rejects the reserved srv- id prefix', () => {
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, clientEventId: 'srv-hb-x-123' }] }).success).toBe(false)
  })

  it('rejects an end before the start and an out-of-range confidence', () => {
    const start = new Date()
    const before = new Date(start.getTime() - 1000).toISOString()
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, startedAt: start.toISOString(), endedAt: before }] }).success).toBe(false)
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, confidence: 1.5 }] }).success).toBe(false)
  })

  it('caps metadata keys', () => {
    const metadata: Record<string, number> = {}
    for (let i = 0; i < 13; i++) metadata[`k${i}`] = i
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, metadata }] }).success).toBe(false)
  })
})
```

`tests/proctoring-admin-api.test.ts`: in the two event fixtures, `'GAZE_LEFT'` becomes `'LOOKING_LEFT'` and `'SCREEN_SHARE_STOPPED'` becomes `'SCREEN_SHARE_INTERRUPTED'`. Change both `occurredAt:` to `startedAt:` and delete both `severity:` properties. In `'orders events by time'`, change `e.occurredAt` to `e.startedAt`.

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. The client hook still queues old names as plain strings; that compiles, and the runtime mismatch is expected until Task 11.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 2: metadata event taxonomy and migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Detection config, frame signals and signal fusion

Additive. The old `classifyGaze`/`extractSignals` stay until Task 6 swaps the monitor over, so every task in between stays green.

**Files:**
- Create: `src/lib/proctoring/client/detection-config.ts`
- Modify: `src/lib/proctoring/client/gaze-classify.ts` (append), `src/lib/proctoring/types.ts`
- Test: `tests/proctoring-signal-fusion.test.ts`

**Interfaces:**
- Produces: `DetectionConfig`, `DETECTION_CONFIG`.
- Produces: `FrameSignals { faceCount; yaw; pitch; roll; irisX; irisY; faceWidth: number | null; quality: number }`. Every angle and offset is `number | null`, and missing is never 0.
- Produces: `Baseline { yaw: number; pitch: number; irisX: number | null; irisY: number | null }`.
- Produces: `Agreement = 'HEAD_AND_EYES' | 'HEAD_ONLY' | 'EYES_ONLY' | 'NONE'`.
- Produces: `FusedObservation { direction: GazeDirection; horizontal: 'LEFT' | 'RIGHT' | null; vertical: 'UP' | 'DOWN' | null; confidence: number; agreement: Agreement; deviation: { yaw; pitch; irisX; irisY: number | null } }`.
- Produces: `extractFrameSignals(result: FaceLandmarkerLike, signs?: DetectionConfig['signs']): FrameSignals`.
- Produces: `fuseSignals(s: FrameSignals, b: Baseline, cfg?: DetectionConfig, prev?: FusedObservation | null): FusedObservation`.
- `GazeDirection` gains `'FACE_MISSING'`. `'FACE_NOT_DETECTED'` is removed in Task 6.

- [ ] **Step 1: Write the failing test**

`tests/proctoring-signal-fusion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  extractFrameSignals, fuseSignals,
  type Baseline, type FrameSignals, type FusedObservation,
} from '@/lib/proctoring/client/gaze-classify'
import { DETECTION_CONFIG } from '@/lib/proctoring/client/detection-config'

/**
 * Pure signal extraction and fusion. Synthetic inputs prove the logic; only a
 * real face can prove the sign convention (Task 15's manual script).
 */

// ---- extraction fixtures ---------------------------------------------------

/** Column-major 4x4. Element (row r, col c) lives at data[c * 4 + r]. */
function matrix(axis: 'yaw' | 'pitch' | 'roll', deg: number): { data: number[] } {
  const t = (deg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const d = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  if (axis === 'yaw') { d[0] = c; d[8] = s; d[2] = -s; d[10] = c }
  if (axis === 'pitch') { d[5] = c; d[9] = -s; d[6] = s; d[10] = c }
  if (axis === 'roll') { d[0] = c; d[4] = -s; d[1] = s; d[5] = c }
  return { data: d }
}

/** 478 points. Eyes 0.06 wide; iris displaced by (dx, dy) eye-widths. */
function landmarks(dx: number, dy: number, count = 478): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i++) pts.push({ x: 0.5, y: 0.5 })
  const set = (i: number, x: number, y: number) => { if (i < count) pts[i] = { x, y } }
  set(33, 0.40, 0.40); set(133, 0.46, 0.40)
  set(362, 0.54, 0.40); set(263, 0.60, 0.40)
  set(468, 0.43 + dx * 0.06, 0.40 + dy * 0.06)
  set(473, 0.57 + dx * 0.06, 0.40 + dy * 0.06)
  return pts
}

describe('extractFrameSignals', () => {
  it('0 faces: face count 0 and every reading null, never zero', () => {
    const s = extractFrameSignals({ faceLandmarks: [], facialTransformationMatrixes: [] })
    expect(s.faceCount).toBe(0)
    expect([s.yaw, s.pitch, s.roll, s.irisX, s.irisY, s.faceWidth]).toEqual([null, null, null, null, null, null])
  })

  it('2 faces: counts both and reads no direction', () => {
    const s = extractFrameSignals({ faceLandmarks: [landmarks(0, 0), landmarks(0, 0)] })
    expect(s.faceCount).toBe(2)
    expect(s.yaw).toBeNull()
  })

  it('1 face: recovers yaw, pitch and roll from the matrix', () => {
    const f = [landmarks(0, 0)]
    expect(extractFrameSignals({ faceLandmarks: f, facialTransformationMatrixes: [matrix('yaw', 20)] }).yaw).toBeCloseTo(20)
    expect(extractFrameSignals({ faceLandmarks: f, facialTransformationMatrixes: [matrix('pitch', -12)] }).pitch).toBeCloseTo(-12)
    expect(extractFrameSignals({ faceLandmarks: f, facialTransformationMatrixes: [matrix('roll', 30)] }).roll).toBeCloseTo(30)
  })

  it('normalises iris offset by each eye width, on both axes', () => {
    const s = extractFrameSignals({ faceLandmarks: [landmarks(0.25, -0.1)], facialTransformationMatrixes: [matrix('yaw', 0)] })
    expect(s.irisX).toBeCloseTo(0.25)
    expect(s.irisY).toBeCloseTo(-0.1)
    expect(s.faceWidth).toBeCloseTo(0.2)
  })

  it('missing iris landmarks give null, not 0, and lower quality', () => {
    const s = extractFrameSignals({ faceLandmarks: [landmarks(0, 0, 468)], facialTransformationMatrixes: [matrix('yaw', 0)] })
    expect(s.irisX).toBeNull()
    expect(s.irisY).toBeNull()
    expect(s.quality).toBeLessThan(1)
  })

  it('a degenerate matrix gives null pose rather than NaN', () => {
    const bad = { data: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, 0, 0, 0, 1] }
    const s = extractFrameSignals({ faceLandmarks: [landmarks(0, 0)], facialTransformationMatrixes: [bad] })
    expect(s.yaw).toBeNull()
    expect(s.pitch).toBeNull()
  })

  it('applies the configured sign convention', () => {
    const s = extractFrameSignals(
      { faceLandmarks: [landmarks(0.2, 0)], facialTransformationMatrixes: [matrix('yaw', 20)] },
      { yaw: -1, pitch: 1, irisX: -1, irisY: 1 }
    )
    expect(s.yaw).toBeCloseTo(-20)
    expect(s.irisX).toBeCloseTo(-0.2)
  })
})

// ---- fusion ----------------------------------------------------------------

const BASE: Baseline = { yaw: 3, pitch: -2, irisX: 0.01, irisY: 0.02 }

function frame(p: Partial<FrameSignals> = {}): FrameSignals {
  return { faceCount: 1, yaw: 3, pitch: -2, roll: 0, irisX: 0.01, irisY: 0.02, faceWidth: 0.2, quality: 1, ...p }
}

const fuse = (p: Partial<FrameSignals>, prev: FusedObservation | null = null) =>
  fuseSignals(frame(p), BASE, DETECTION_CONFIG, prev)

describe('fuseSignals: presence', () => {
  it('0 faces is FACE_MISSING', () => {
    expect(fuse({ faceCount: 0, yaw: null, pitch: null, irisX: null, irisY: null }).direction).toBe('FACE_MISSING')
  })
  it('2 faces is MULTIPLE_FACES', () => {
    expect(fuse({ faceCount: 2 }).direction).toBe('MULTIPLE_FACES')
  })
  it('1 face at baseline is CENTER', () => {
    const o = fuse({})
    expect(o.direction).toBe('CENTER')
    expect(o.horizontal).toBeNull()
    expect(o.vertical).toBeNull()
  })
})

describe('fuseSignals: personal baseline', () => {
  it('baseline yaw 3, current 5 is normal', () => {
    expect(fuse({ yaw: 5 }).direction).toBe('CENTER')
  })
  it('baseline yaw 3, current 28 with eyes the same way is a strong deviation', () => {
    const o = fuse({ yaw: 28, irisX: 0.21 })
    expect(o.direction).toBe('RIGHT')
    expect(o.agreement).toBe('HEAD_AND_EYES')
    expect(o.confidence).toBeGreaterThanOrEqual(DETECTION_CONFIG.strongConfidence)
  })
})

describe('fuseSignals: directions', () => {
  it('LEFT: head and eyes agree', () => {
    const o = fuse({ yaw: -20, irisX: -0.2 })
    expect(o.direction).toBe('LEFT')
    expect(o.confidence).toBeCloseTo(0.9)
  })
  it('UP', () => {
    expect(fuse({ pitch: 16, irisY: -0.12 }).direction).toBe('UP')
  })
  it('DOWN: head and eyes agree', () => {
    const o = fuse({ pitch: -20, irisY: 0.2 })
    expect(o.direction).toBe('DOWN')
    expect(o.agreement).toBe('HEAD_AND_EYES')
  })
  it('LEFT + DOWN reports DOWN and keeps the horizontal component', () => {
    const o = fuse({ yaw: -20, irisX: -0.2, pitch: -20, irisY: 0.2 })
    expect(o.direction).toBe('DOWN')
    expect(o.horizontal).toBe('LEFT')
    expect(o.vertical).toBe('DOWN')
  })
  it('RIGHT + DOWN reports DOWN with horizontal RIGHT', () => {
    const o = fuse({ yaw: 24, irisX: 0.2, pitch: -20, irisY: 0.2 })
    expect(o.direction).toBe('DOWN')
    expect(o.horizontal).toBe('RIGHT')
  })
  it('UP + LEFT reports LEFT: up is the least useful axis', () => {
    expect(fuse({ yaw: -20, irisX: -0.2, pitch: 18, irisY: -0.15 }).direction).toBe('LEFT')
  })
})

describe('fuseSignals: never a single signal', () => {
  it('head LEFT with eyes centred is only a weak/moderate signal', () => {
    const o = fuse({ yaw: -20 })
    expect(o.direction).toBe('LEFT')
    expect(o.agreement).toBe('HEAD_ONLY')
    expect(o.confidence).toBeLessThan(DETECTION_CONFIG.strongConfidence)
  })
  it('eyes alone are the weakest signal', () => {
    const o = fuse({ irisX: -0.19 })
    expect(o.direction).toBe('LEFT')
    expect(o.agreement).toBe('EYES_ONLY')
    expect(o.confidence).toBeLessThan(0.6)
  })
  it('head turned one way with eyes back on the screen is CENTER', () => {
    expect(fuse({ yaw: 25, irisX: -0.2 }).direction).toBe('CENTER')
  })
  it('a head turned far away is strong even without the eyes', () => {
    const o = fuse({ yaw: 42 })
    expect(o.direction).toBe('RIGHT')
    expect(o.confidence).toBeGreaterThanOrEqual(DETECTION_CONFIG.strongConfidence)
  })
})

describe('fuseSignals: missing and poor data', () => {
  it('missing iris is null in the deviation, never 0', () => {
    const o = fuse({ irisX: null, irisY: null })
    expect(o.direction).toBe('CENTER')
    expect(o.deviation.irisX).toBeNull()
    expect(o.deviation.irisY).toBeNull()
  })
  it('a baseline without iris ignores current iris rather than comparing to 0', () => {
    const o = fuseSignals(frame({ irisX: 0.3 }), { yaw: 3, pitch: -2, irisX: null, irisY: null })
    expect(o.direction).toBe('CENTER')
    expect(o.deviation.irisX).toBeNull()
  })
  it('head pose missing but iris present still classifies, as eyes only', () => {
    expect(fuse({ yaw: null, pitch: null, irisX: -0.2 }).agreement).toBe('EYES_ONLY')
  })
  it('UNKNOWN: nothing measurable', () => {
    expect(fuse({ yaw: null, pitch: null, irisX: null, irisY: null }).direction).toBe('UNCERTAIN')
  })
  it('UNKNOWN: low landmark quality', () => {
    expect(fuse({ quality: 0.3, yaw: -30 }).direction).toBe('UNCERTAIN')
  })
  it('UNKNOWN: face too small to trust', () => {
    expect(fuse({ faceWidth: 0.05, yaw: -30 }).direction).toBe('UNCERTAIN')
  })
  it('a heavily rolled head lowers confidence', () => {
    const upright = fuse({ yaw: -20, irisX: -0.2 }).confidence
    const rolled = fuse({ yaw: -20, irisX: -0.2, roll: 40 }).confidence
    expect(rolled).toBeLessThan(upright)
  })
})

describe('fuseSignals: hysteresis', () => {
  it('holds a direction just inside the threshold, but only once it is active', () => {
    const near = { yaw: -12, irisX: -0.13 } // dev -15 / -0.14: under entry limits, over exit limits
    expect(fuse(near).direction).toBe('CENTER')
    const prev = fuse({ yaw: -20, irisX: -0.2 })
    expect(fuse(near, prev).direction).toBe('LEFT')
  })
})
```

Run: `npx vitest run tests/proctoring-signal-fusion.test.ts`
Expected: FAIL, "Cannot find module '@/lib/proctoring/client/detection-config'".

- [ ] **Step 2: Create `src/lib/proctoring/client/detection-config.ts`**

```ts
/**
 * Every detection threshold and timing, in one place.
 *
 * Client-only, and deliberately never sent over the wire or rendered. A
 * candidate should learn that monitoring is active, not how to stay under it
 * (spec P13). These values still ship in the JS bundle: client-side detection
 * cannot hide its own parameters from someone reading minified code. That
 * limitation is documented in plans/proctoring/README.md.
 *
 * `signs` exists because the head-pose and iris sign convention can only be
 * confirmed against a real face. If the diagnostics panel shows LEFT while
 * the tester looks to their right, flip the sign here and nowhere else.
 */
export interface DetectionConfig {
  targetFps: number
  signs: { yaw: 1 | -1; pitch: 1 | -1; irisX: 1 | -1; irisY: 1 | -1 }
  head: {
    yawDeg: number
    pitchUpDeg: number
    pitchDownDeg: number
    hysteresisDeg: number
    /** Beyond this roll the iris reading is unreliable; confidence is cut. */
    maxRollDeg: number
    /** A head turned this far is strong evidence even without the eyes. */
    strongYawDeg: number
  }
  /** Fractions of eye width. */
  iris: { xRatio: number; yRatio: number; hysteresisRatio: number }
  quality: { minQuality: number; minFaceWidth: number }
  baseline: { windowMs: number; minSamples: number; maxWindowMs: number; minFallbackSamples: number }
  /** How long a condition must persist before it counts. */
  confirmMs: { side: number; up: number; down: number; faceMissing: number; multipleFaces: number }
  /** Weak (low-confidence) gaze runs must persist this many times longer. */
  weakSignalFactor: number
  strongConfidence: number
  /** A lapse shorter than this does not break a run - it is flicker. */
  gapToleranceMs: number
  warningCooldownMs: number
  sustainedDownwardMs: number
  repeatedDownward: { windowMs: number; minOccurrences: number }
  maxTrackedOccurrences: number
}

export const DETECTION_CONFIG: DetectionConfig = {
  targetFps: 6,
  signs: { yaw: 1, pitch: 1, irisX: 1, irisY: 1 },
  head: { yawDeg: 18, pitchUpDeg: 15, pitchDownDeg: 14, hysteresisDeg: 4, maxRollDeg: 25, strongYawDeg: 35 },
  iris: { xRatio: 0.16, yRatio: 0.12, hysteresisRatio: 0.03 },
  quality: { minQuality: 0.5, minFaceWidth: 0.08 },
  baseline: { windowMs: 3000, minSamples: 12, maxWindowMs: 10000, minFallbackSamples: 3 },
  confirmMs: { side: 1750, up: 2000, down: 2500, faceMissing: 2000, multipleFaces: 750 },
  weakSignalFactor: 1.5,
  strongConfidence: 0.75,
  gapToleranceMs: 400,
  warningCooldownMs: 10000,
  sustainedDownwardMs: 6000,
  repeatedDownward: { windowMs: 300000, minOccurrences: 4 },
  maxTrackedOccurrences: 50,
}
```

- [ ] **Step 3: Add `'FACE_MISSING'` to `GazeDirection` in `src/lib/proctoring/types.ts`**

```ts
export type GazeDirection =
  | 'CENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
  | 'FACE_MISSING' | 'FACE_NOT_DETECTED' | 'MULTIPLE_FACES' | 'UNCERTAIN'
```

- [ ] **Step 4: Append the new extraction and fusion to `src/lib/proctoring/client/gaze-classify.ts`**

Add `import { DETECTION_CONFIG, type DetectionConfig } from './detection-config'` under the existing import, and append:

```ts
// ---------------------------------------------------------------------------
// Live-monitoring signals (supersede GazeSignals/classifyGaze in Task 6)
// ---------------------------------------------------------------------------

/**
 * Everything read from one frame. Every reading is null when unavailable,
 * never 0: zero means "exactly centred", which is a different claim.
 */
export interface FrameSignals {
  faceCount: number
  /** Degrees. Sign set by DETECTION_CONFIG.signs. */
  yaw: number | null
  pitch: number | null
  roll: number | null
  /** Iris offset from the eye-corner midpoint, in eye widths. +x image right, +y image down. */
  irisX: number | null
  irisY: number | null
  /** Landmark bounding-box width, 0..1 of the frame. Small means far away. */
  faceWidth: number | null
  /** 0..1: how much of what fusion needs was actually present. */
  quality: number
}

export interface Baseline {
  yaw: number
  pitch: number
  irisX: number | null
  irisY: number | null
}

export type Agreement = 'HEAD_AND_EYES' | 'HEAD_ONLY' | 'EYES_ONLY' | 'NONE'

export interface FusedObservation {
  direction: GazeDirection
  horizontal: 'LEFT' | 'RIGHT' | null
  vertical: 'UP' | 'DOWN' | null
  /** 0..1. Agreement between head and eyes, scaled by quality and roll. */
  confidence: number
  agreement: Agreement
  deviation: { yaw: number | null; pitch: number | null; irisX: number | null; irisY: number | null }
}

const NO_READINGS = {
  yaw: null, pitch: null, roll: null, irisX: null, irisY: null, faceWidth: null,
}

export function extractFrameSignals(
  result: FaceLandmarkerLike,
  signs: DetectionConfig['signs'] = DETECTION_CONFIG.signs
): FrameSignals {
  const faces = result.faceLandmarks ?? []
  if (faces.length === 0) return { faceCount: 0, ...NO_READINGS, quality: 0 }
  // Two people: presence is the observation. A direction for "which face?"
  // would be meaningless.
  if (faces.length > 1) return { faceCount: faces.length, ...NO_READINGS, quality: 1 }

  const points = faces[0]
  const matrices = result.facialTransformationMatrixes ?? []
  const pose = headPose(matrices.length > 0 ? matrices[0] : undefined)
  const iris = irisOffsets(points)

  let quality = points.length >= 468 ? 1 : 0.5
  if (!pose) quality *= 0.5
  if (iris === null) quality *= 0.8

  return {
    faceCount: 1,
    yaw: pose ? pose.yaw * signs.yaw : null,
    pitch: pose ? pose.pitch * signs.pitch : null,
    roll: pose ? pose.roll : null,
    irisX: iris ? iris.x * signs.irisX : null,
    irisY: iris ? iris.y * signs.irisY : null,
    faceWidth: faceWidthOf(points),
    quality,
  }
}

/**
 * Yaw, pitch and roll from the column-major 4x4. Element (row, col) is at
 * data[col * 4 + row]. Null for a degenerate matrix instead of NaN.
 */
function headPose(m: { data: number[] | Float32Array } | undefined): { yaw: number; pitch: number; roll: number } | null {
  if (!m || !m.data || m.data.length < 16) return null
  const d = m.data
  const r02 = Number(d[8])
  const r12 = Number(d[9])
  const r22 = Number(d[10])
  const r10 = Number(d[1])
  const r11 = Number(d[5])
  const yaw = Math.atan2(r02, r22) * RAD_TO_DEG
  const pitch = Math.atan2(-r12, Math.sqrt(r02 * r02 + r22 * r22)) * RAD_TO_DEG
  const roll = Math.atan2(r10, r11) * RAD_TO_DEG
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || !Number.isFinite(roll)) return null
  return { yaw, pitch, roll }
}

/** Mean of both eyes' offsets, each normalised by its own width. */
function irisOffsets(points: Array<{ x: number; y: number }>): { x: number; y: number } | null {
  if (points.length <= RIGHT_IRIS_CENTRE) return null
  const readings: Array<{ x: number; y: number }> = []
  const left = eyeOffsetXY(points, LEFT_IRIS_CENTRE, LEFT_EYE_OUTER, LEFT_EYE_INNER)
  const right = eyeOffsetXY(points, RIGHT_IRIS_CENTRE, RIGHT_EYE_INNER, RIGHT_EYE_OUTER)
  if (left) readings.push(left)
  if (right) readings.push(right)
  if (readings.length === 0) return null
  let x = 0
  let y = 0
  for (let i = 0; i < readings.length; i++) { x += readings[i].x; y += readings[i].y }
  return { x: x / readings.length, y: y / readings.length }
}

function eyeOffsetXY(
  points: Array<{ x: number; y: number }>,
  irisIndex: number,
  cornerA: number,
  cornerB: number
): { x: number; y: number } | null {
  const iris = points[irisIndex]
  const a = points[cornerA]
  const b = points[cornerB]
  if (!iris || !a || !b) return null
  const width = Math.abs(b.x - a.x)
  if (!Number.isFinite(width) || width < 1e-6) return null
  const x = (iris.x - (a.x + b.x) / 2) / width
  const y = (iris.y - (a.y + b.y) / 2) / width
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function faceWidthOf(points: Array<{ x: number; y: number }>): number | null {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < points.length; i++) {
    const x = points[i].x
    if (!Number.isFinite(x)) continue
    if (x < min) min = x
    if (x > max) max = x
  }
  return max > min ? max - min : null
}

type Axis<T> = { dir: T | null; confidence: number; agreement: Agreement }

/**
 * Combine the head and eye readings on one axis. This is where "never a
 * single signal" lives:
 *  - head and eyes agree              -> strong
 *  - head and eyes disagree           -> nothing (head turned, eyes on screen)
 *  - head only, eyes measured centred -> weak/moderate
 *  - head only, eyes unmeasurable     -> moderate
 *  - head turned very far             -> strong on its own
 *  - eyes only                        -> weakest
 */
function combine<T>(head: T | null, eyes: T | null, eyesMeasured: boolean, headStrong: boolean): Axis<T> {
  if (head && eyes) {
    return head === eyes
      ? { dir: head, confidence: 0.9, agreement: 'HEAD_AND_EYES' }
      : { dir: null, confidence: 0, agreement: 'NONE' }
  }
  if (head) {
    if (headStrong) return { dir: head, confidence: 0.85, agreement: 'HEAD_ONLY' }
    return { dir: head, confidence: eyesMeasured ? 0.55 : 0.6, agreement: 'HEAD_ONLY' }
  }
  if (eyes) return { dir: eyes, confidence: 0.5, agreement: 'EYES_ONLY' }
  return { dir: null, confidence: 0, agreement: 'NONE' }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function fuseSignals(
  s: FrameSignals,
  b: Baseline,
  cfg: DetectionConfig = DETECTION_CONFIG,
  prev: FusedObservation | null = null
): FusedObservation {
  const none = { yaw: null, pitch: null, irisX: null, irisY: null }
  const make = (direction: GazeDirection, confidence: number): FusedObservation =>
    ({ direction, horizontal: null, vertical: null, confidence, agreement: 'NONE', deviation: none })

  if (s.faceCount === 0) return make('FACE_MISSING', 0.9)
  if (s.faceCount > 1) return make('MULTIPLE_FACES', 0.9)
  if (s.quality < cfg.quality.minQuality) return make('UNCERTAIN', 0)
  if (s.faceWidth !== null && s.faceWidth < cfg.quality.minFaceWidth) return make('UNCERTAIN', 0)

  const deviation = {
    yaw: s.yaw !== null ? s.yaw - b.yaw : null,
    pitch: s.pitch !== null ? s.pitch - b.pitch : null,
    irisX: s.irisX !== null && b.irisX !== null ? s.irisX - b.irisX : null,
    irisY: s.irisY !== null && b.irisY !== null ? s.irisY - b.irisY : null,
  }
  if (deviation.yaw === null && deviation.pitch === null && deviation.irisX === null && deviation.irisY === null) {
    return make('UNCERTAIN', 0)
  }

  // Hysteresis only on an axis already deviating, so a face at the boundary
  // does not flicker every frame.
  const hActive = prev !== null && prev.horizontal !== null
  const vActive = prev !== null && prev.vertical !== null
  const yawLimit = cfg.head.yawDeg - (hActive ? cfg.head.hysteresisDeg : 0)
  const irisXLimit = cfg.iris.xRatio - (hActive ? cfg.iris.hysteresisRatio : 0)
  const upLimit = cfg.head.pitchUpDeg - (vActive ? cfg.head.hysteresisDeg : 0)
  const downLimit = cfg.head.pitchDownDeg - (vActive ? cfg.head.hysteresisDeg : 0)
  const irisYLimit = cfg.iris.yRatio - (vActive ? cfg.iris.hysteresisRatio : 0)

  const dy = deviation.yaw
  const dp = deviation.pitch
  const dix = deviation.irisX
  const diy = deviation.irisY

  const headH = dy === null ? null : dy >= yawLimit ? 'RIGHT' : dy <= -yawLimit ? 'LEFT' : null
  const eyeH = dix === null ? null : dix >= irisXLimit ? 'RIGHT' : dix <= -irisXLimit ? 'LEFT' : null
  const headV = dp === null ? null : dp >= upLimit ? 'UP' : dp <= -downLimit ? 'DOWN' : null
  // Image y grows downward, so a positive vertical iris offset is the eyes lowering.
  const eyeV = diy === null ? null : diy >= irisYLimit ? 'DOWN' : diy <= -irisYLimit ? 'UP' : null

  const h = combine<'LEFT' | 'RIGHT'>(headH, eyeH, dix !== null, dy !== null && Math.abs(dy) >= cfg.head.strongYawDeg)
  const v = combine<'UP' | 'DOWN'>(headV, eyeV, diy !== null, false)

  // Downward attention first: it is the pattern this phase exists to catch,
  // and down-left must still count as downward. Horizontal beats up.
  let direction: GazeDirection = 'CENTER'
  let confidence = s.quality
  let agreement: Agreement = 'NONE'
  if (v.dir === 'DOWN') { direction = 'DOWN'; confidence = v.confidence; agreement = v.agreement }
  else if (h.dir) { direction = h.dir; confidence = h.confidence; agreement = h.agreement }
  else if (v.dir === 'UP') { direction = 'UP'; confidence = v.confidence; agreement = v.agreement }

  if (direction !== 'CENTER') {
    if (s.roll !== null && Math.abs(s.roll) > cfg.head.maxRollDeg) confidence *= 0.7
    confidence *= s.quality
  }

  return { direction, horizontal: h.dir, vertical: v.dir, confidence: round2(confidence), agreement, deviation }
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/proctoring-signal-fusion.test.ts`
Expected: PASS, all cases.

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: exit 0; whole suite green. The old `proctoring-gaze-classify.test.ts` still passes because nothing old was touched.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 3: detection config, frame signals and fusion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Personal baseline and the temporal engine

Additive. `GazeStateMachine` stays until Task 6.

**Files:**
- Create: `src/lib/proctoring/client/baseline.ts`
- Modify: `src/lib/proctoring/client/gaze-state.ts` (append)
- Test: `tests/proctoring-baseline.test.ts`, `tests/proctoring-temporal-engine.test.ts`

**Interfaces:**
- Consumes: `FrameSignals`, `Baseline`, `FusedObservation` (Task 3); `DetectionConfig` (Task 3).
- Produces: `class BaselineCollector(cfg: DetectionConfig['baseline'], minQuality: number)` with `add(s: FrameSignals, tMs: number): Baseline | null`, `get sampleCount(): number`, `reset(): void`; and `median(values: number[]): number`.
- Produces: `TemporalState = 'NORMAL' | 'POSSIBLE_DEVIATION' | 'SUSTAINED_DEVIATION' | 'WARNING' | 'COOLDOWN'`.
- Produces: `Condition = 'LOOKING_LEFT' | 'LOOKING_RIGHT' | 'LOOKING_UP' | 'LOOKING_DOWN' | 'FACE_MISSING' | 'MULTIPLE_FACES'`. These are exactly the `ClientEventType` names they become.
- Produces: `Episode { condition; startedAtMs; endedAtMs; durationMs; confidence; horizontal: 'LEFT' | 'RIGHT' | null }`.
- Produces: `TemporalOutput { state; condition: Condition | null; warning: Condition | null; ended: Episode | null }`.
- Produces: `TemporalOptions = Pick<DetectionConfig, 'confirmMs' | 'gapToleranceMs' | 'warningCooldownMs' | 'weakSignalFactor' | 'strongConfidence'>`.
- Produces: `conditionFor(o: FusedObservation): Condition | null`, and `class TemporalEngine(opts)` with `observe(o, tMs): TemporalOutput`, `flush(tMs): Episode | null`, `reset(): void`, `get state(): TemporalState`.

- [ ] **Step 1: Write the failing baseline test**

`tests/proctoring-baseline.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BaselineCollector, median } from '@/lib/proctoring/client/baseline'
import { DETECTION_CONFIG } from '@/lib/proctoring/client/detection-config'
import type { FrameSignals } from '@/lib/proctoring/client/gaze-classify'

const face = (p: Partial<FrameSignals> = {}): FrameSignals =>
  ({ faceCount: 1, yaw: 3, pitch: -2, roll: 0, irisX: 0.01, irisY: 0.02, faceWidth: 0.2, quality: 1, ...p })

function collector() {
  return new BaselineCollector(DETECTION_CONFIG.baseline, DETECTION_CONFIG.quality.minQuality)
}

describe('median', () => {
  it('handles odd and even lengths without mutating the input', () => {
    const v = [5, 1, 3]
    expect(median(v)).toBe(3)
    expect(v).toEqual([5, 1, 3])
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('BaselineCollector', () => {
  it('waits for the full calibration window', () => {
    const c = collector()
    for (let t = 0; t < 3000; t += 100) expect(c.add(face(), t)).toBeNull()
  })

  it('takes the median, so one glance away during calibration does not skew it', () => {
    const c = collector()
    let b = null
    for (let t = 0; t <= 3000 && !b; t += 100) b = c.add(face({ yaw: t === 500 ? 40 : 3 }), t)
    expect(b).not.toBeNull()
    expect(b!.yaw).toBe(3)
    expect(b!.pitch).toBe(-2)
    expect(b!.irisX).toBeCloseTo(0.01)
  })

  it('ignores frames with no face, two faces or poor quality', () => {
    const c = collector()
    for (let t = 0; t <= 3000; t += 100) {
      c.add(face({ faceCount: 2 }), t)
      c.add(face({ faceCount: 0, yaw: null, pitch: null }), t)
      c.add(face({ quality: 0.2 }), t)
    }
    expect(c.sampleCount).toBe(0)
  })

  it('reports iris baseline as null when most calibration frames had none', () => {
    const c = collector()
    let b = null
    let i = 0
    for (let t = 0; t <= 3000 && !b; t += 100, i++) {
      b = c.add(face(i % 3 === 0 ? {} : { irisX: null, irisY: null }), t)
    }
    expect(b!.irisX).toBeNull()
    expect(b!.yaw).toBe(3)
  })

  it('falls back to a few samples at the long timeout', () => {
    const c = collector()
    let b = null
    for (let t = 0; t <= 10_000 && !b; t += 100) {
      b = c.add(t < 500 ? face() : face({ faceCount: 0, yaw: null, pitch: null }), t)
    }
    expect(b).not.toBeNull()
    expect(b!.yaw).toBe(3)
  })

  it('restarts, rather than calibrating on nothing, when the timeout passes empty', () => {
    const c = collector()
    for (let t = 0; t <= 10_000; t += 100) {
      expect(c.add(face({ faceCount: 0, yaw: null, pitch: null }), t)).toBeNull()
    }
    expect(c.sampleCount).toBe(0)
  })
})
```

- [ ] **Step 2: Create `src/lib/proctoring/client/baseline.ts`**

```ts
import type { Baseline, FrameSignals } from './gaze-classify'
import type { DetectionConfig } from './detection-config'

/**
 * The candidate's own neutral pose, from the first few seconds of monitoring.
 *
 * Median, not mean: one glance away during calibration would drag a mean and
 * skew the whole session. Only single-face, good-quality frames count. The
 * baseline lives in memory only and is never uploaded.
 *
 * It assumes the candidate looks at the screen just after starting, which is
 * usually but not always true. The mitigation is not technical: nothing here
 * fails anyone, and a person reads the observations.
 */

/** Hard ceiling, far above one window at the target rate. */
const MAX_SAMPLES = 200

interface Sample { yaw: number; pitch: number; irisX: number | null; irisY: number | null }

export class BaselineCollector {
  private samples: Sample[] = []
  private startedAt: number | null = null

  constructor(
    private readonly cfg: DetectionConfig['baseline'],
    private readonly minQuality: number
  ) {}

  add(s: FrameSignals, tMs: number): Baseline | null {
    if (this.startedAt === null) this.startedAt = tMs

    if (s.faceCount === 1 && s.yaw !== null && s.pitch !== null && s.quality >= this.minQuality) {
      if (this.samples.length < MAX_SAMPLES) {
        this.samples.push({ yaw: s.yaw, pitch: s.pitch, irisX: s.irisX, irisY: s.irisY })
      }
    }

    const elapsed = tMs - this.startedAt
    const ready = elapsed >= this.cfg.windowMs && this.samples.length >= this.cfg.minSamples
    if (!ready) {
      if (elapsed < this.cfg.maxWindowMs) return null
      if (this.samples.length < this.cfg.minFallbackSamples) {
        // Timed out with too little to trust: start over.
        this.samples = []
        this.startedAt = tMs
        return null
      }
    }

    const total = this.samples.length
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < total; i++) {
      const x = this.samples[i].irisX
      const y = this.samples[i].irisY
      if (x !== null) xs.push(x)
      if (y !== null) ys.push(y)
    }
    const baseline: Baseline = {
      yaw: median(this.samples.map(p => p.yaw)),
      pitch: median(this.samples.map(p => p.pitch)),
      irisX: medianOfMost(xs, total),
      irisY: medianOfMost(ys, total),
    }
    this.reset()
    return baseline
  }

  get sampleCount(): number {
    return this.samples.length
  }

  reset(): void {
    this.samples = []
    this.startedAt = null
  }
}

/** An iris baseline only when most calibration frames had an iris reading. */
function medianOfMost(values: number[], total: number): number | null {
  if (values.length === 0 || values.length * 2 < total) return null
  return median(values)
}

export function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
```

Run: `npx vitest run tests/proctoring-baseline.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing temporal test**

`tests/proctoring-temporal-engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TemporalEngine, type TemporalOutput } from '@/lib/proctoring/client/gaze-state'
import { DETECTION_CONFIG } from '@/lib/proctoring/client/detection-config'
import type { FusedObservation } from '@/lib/proctoring/client/gaze-classify'
import type { GazeDirection } from '@/lib/proctoring/types'

/**
 * NORMAL -> POSSIBLE_DEVIATION -> SUSTAINED_DEVIATION -> WARNING -> COOLDOWN -> NORMAL.
 * The clock is passed in, so every case is exact. Frames arrive every 100 ms.
 */

function obs(direction: GazeDirection, confidence = 0.9): FusedObservation {
  const horizontal = direction === 'LEFT' || direction === 'RIGHT' ? direction : null
  const vertical = direction === 'UP' || direction === 'DOWN' ? direction : null
  return {
    direction, horizontal, vertical, confidence,
    agreement: 'HEAD_AND_EYES',
    deviation: { yaw: null, pitch: null, irisX: null, irisY: null },
  }
}

function feed(e: TemporalEngine, d: GazeDirection, from: number, to: number, conf = 0.9): TemporalOutput[] {
  const out: TemporalOutput[] = []
  for (let t = from; t <= to; t += 100) out.push(e.observe(obs(d, conf), t))
  return out
}

const warnings = (outs: TemporalOutput[]) => outs.filter(o => o.warning).map(o => o.warning)
const ended = (outs: TemporalOutput[]) => outs.filter(o => o.ended).map(o => o.ended!)
const engine = () => new TemporalEngine(DETECTION_CONFIG)

describe('TemporalEngine', () => {
  it('brief deviation: 300 ms of LEFT is ignored entirely', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 300).concat(feed(e, 'CENTER', 400, 1000))
    expect(outs[1].state).toBe('POSSIBLE_DEVIATION')
    expect(warnings(outs)).toEqual([])
    expect(ended(outs)).toEqual([])
    expect(e.state).toBe('NORMAL')
  })

  it('sustained deviation: warns once when the side-gaze window is reached', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 2000)
    expect(warnings(outs)).toEqual(['LOOKING_LEFT'])
    expect(outs.findIndex(o => o.warning) * 100).toBe(1800)
    expect(outs[outs.length - 1].state).toBe('WARNING')
  })

  it('recovery: ends the episode with its real duration, then cools down', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    const back = feed(e, 'CENTER', 2100, 2600)
    const eps = ended(back)
    expect(eps.length).toBe(1)
    expect(eps[0]).toMatchObject({ condition: 'LOOKING_LEFT', startedAtMs: 0, endedAtMs: 2000, durationMs: 2000 })
    expect(eps[0].confidence).toBeCloseTo(0.9)
    expect(back[back.length - 1].state).toBe('COOLDOWN')
  })

  it('cooldown: a second episode inside it is recorded but not warned', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    feed(e, 'CENTER', 2100, 2600)
    const second = feed(e, 'LEFT', 3000, 5000)
    expect(warnings(second)).toEqual([])
    expect(second[second.length - 1].state).toBe('SUSTAINED_DEVIATION')
    expect(ended(feed(e, 'CENTER', 5100, 5600)).length).toBe(1)
    // After the cooldown lapses it warns again.
    expect(warnings(feed(e, 'LEFT', 12_000, 14_000))).toEqual(['LOOKING_LEFT'])
  })

  it('repeats the warning during one very long episode, once per cooldown', () => {
    const outs = feed(engine(), 'LEFT', 0, 12_000)
    expect(outs.filter(o => o.warning).length).toBe(2)
  })

  it('tolerates a flicker back to centre without restarting the run', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 1000).concat(feed(e, 'CENTER', 1100, 1300), feed(e, 'LEFT', 1400, 2000))
    expect(warnings(outs)).toEqual(['LOOKING_LEFT'])
  })

  it('treats UNCERTAIN frames as neither deviation nor recovery', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 1000).concat(feed(e, 'UNCERTAIN', 1100, 1500), feed(e, 'LEFT', 1600, 1900))
    expect(warnings(outs)).toEqual(['LOOKING_LEFT'])
  })

  it('switching direction restarts the timer: 1 s LEFT + 1.4 s RIGHT is not a warning', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 1000).concat(feed(e, 'RIGHT', 1100, 2500))
    expect(warnings(outs)).toEqual([])
    expect(ended(outs)).toEqual([]) // the LEFT run never confirmed
  })

  it('a weak (low-confidence) signal must persist longer', () => {
    const e = engine()
    expect(warnings(feed(e, 'LEFT', 0, 2600, 0.55))).toEqual([])
    expect(warnings(feed(e, 'LEFT', 2700, 2700, 0.55))).toEqual(['LOOKING_LEFT'])
  })

  it('downward attention uses its own, longer window', () => {
    const e = engine()
    expect(warnings(feed(e, 'DOWN', 0, 2400))).toEqual([])
    expect(warnings(feed(e, 'DOWN', 2500, 2500))).toEqual(['LOOKING_DOWN'])
  })

  it('face disappears, then returns: FACE_MISSING warning and episode', () => {
    const e = engine()
    const gone = feed(e, 'FACE_MISSING', 0, 2100)
    expect(warnings(gone)).toEqual(['FACE_MISSING'])
    const eps = ended(feed(e, 'CENTER', 2200, 2700))
    expect(eps[0]).toMatchObject({ condition: 'FACE_MISSING', durationMs: 2100 })
  })

  it('a second face is confirmed on a short window', () => {
    const e = engine()
    expect(warnings(feed(e, 'MULTIPLE_FACES', 0, 700))).toEqual([])
    expect(warnings(feed(e, 'MULTIPLE_FACES', 800, 800))).toEqual(['MULTIPLE_FACES'])
  })

  it('keeps cooldowns independent per condition', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    const outs = feed(e, 'FACE_MISSING', 2100, 4200)
    expect(ended(outs)[0].condition).toBe('LOOKING_LEFT')
    expect(warnings(outs)).toEqual(['FACE_MISSING'])
  })

  it('flush closes a confirmed episode in progress, and ignores an unconfirmed one', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    expect(e.flush(2100)).toMatchObject({ condition: 'LOOKING_LEFT', durationMs: 2000 })
    feed(e, 'RIGHT', 3000, 3500)
    expect(e.flush(3600)).toBeNull()
  })

  it('reset clears the run and every cooldown', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    e.reset()
    expect(e.state).toBe('NORMAL')
    expect(warnings(feed(e, 'LEFT', 3000, 5000))).toEqual(['LOOKING_LEFT'])
  })
})
```

Run: `npx vitest run tests/proctoring-temporal-engine.test.ts`
Expected: FAIL, "TemporalEngine is not exported".

- [ ] **Step 4: Append the engine to `src/lib/proctoring/client/gaze-state.ts`**

Add under the existing import:

```ts
import type { FusedObservation } from './gaze-classify'
import type { DetectionConfig } from './detection-config'
```

Append:

```ts
// ---------------------------------------------------------------------------
// Temporal engine (supersedes GazeStateMachine in Task 6)
// ---------------------------------------------------------------------------

export type TemporalState =
  | 'NORMAL' | 'POSSIBLE_DEVIATION' | 'SUSTAINED_DEVIATION' | 'WARNING' | 'COOLDOWN'

/** Named exactly as the metadata event each becomes. */
export type Condition =
  | 'LOOKING_LEFT' | 'LOOKING_RIGHT' | 'LOOKING_UP' | 'LOOKING_DOWN'
  | 'FACE_MISSING' | 'MULTIPLE_FACES'

export interface Episode {
  condition: Condition
  startedAtMs: number
  /** The last frame the condition was actually observed. */
  endedAtMs: number
  durationMs: number
  /** Mean per-frame confidence across the episode. */
  confidence: number
  horizontal: 'LEFT' | 'RIGHT' | null
}

export interface TemporalOutput {
  state: TemporalState
  condition: Condition | null
  /** Set on the frame a warning should be shown. */
  warning: Condition | null
  /** Set on the frame a confirmed episode closes. */
  ended: Episode | null
}

export type TemporalOptions = Pick<
  DetectionConfig, 'confirmMs' | 'gapToleranceMs' | 'warningCooldownMs' | 'weakSignalFactor' | 'strongConfidence'
>

interface Run {
  condition: Condition
  startedAt: number
  lastSeenAt: number
  confSum: number
  frames: number
  confirmed: boolean
  warnedAt: number | null
  horizontal: 'LEFT' | 'RIGHT' | null
}

export function conditionFor(o: FusedObservation): Condition | null {
  switch (o.direction) {
    case 'LEFT': return 'LOOKING_LEFT'
    case 'RIGHT': return 'LOOKING_RIGHT'
    case 'UP': return 'LOOKING_UP'
    case 'DOWN': return 'LOOKING_DOWN'
    case 'FACE_MISSING': return 'FACE_MISSING'
    case 'MULTIPLE_FACES': return 'MULTIPLE_FACES'
    default: return null
  }
}

/**
 * Turns per-frame observations into a few episodes and warnings.
 *
 * One run at a time, since the conditions are mutually exclusive per frame.
 * A run is POSSIBLE until it has lasted its confirmation window, then
 * SUSTAINED; the first sustained frame outside the condition's cooldown shows
 * a WARNING. When the condition ends - after a gap longer than the flicker
 * tolerance - a confirmed run becomes one Episode, which is what gets logged.
 * Unconfirmed runs vanish: a brief glance produces nothing at all.
 */
export class TemporalEngine {
  private run: Run | null = null
  private lastWarnedAt: { [condition: string]: number } = {}
  private lastT = 0

  constructor(private readonly opts: TemporalOptions) {}

  observe(o: FusedObservation, tMs: number): TemporalOutput {
    this.lastT = tMs
    // A dropped or ambiguous frame is evidence of nothing: it neither advances
    // nor resets the run. Treating it as recovery would let a candidate defeat
    // detection by degrading the image.
    if (o.direction === 'UNCERTAIN') return this.output(tMs, null, null)

    const c = conditionFor(o)
    const run = this.run

    if (run && c === run.condition) {
      run.lastSeenAt = tMs
      run.confSum += o.confidence
      run.frames++
      if (o.horizontal) run.horizontal = o.horizontal
    } else if (run && c === null) {
      if (tMs - run.lastSeenAt < this.opts.gapToleranceMs) return this.output(tMs, null, null)
      const done = this.close(run)
      this.run = null
      return this.output(tMs, null, done)
    } else {
      // A different condition, or the first deviation after NORMAL: 1 s of
      // LEFT then 1 s of RIGHT is not 2 s of deviation.
      const done = run ? this.close(run) : null
      this.run = c === null ? null : {
        condition: c, startedAt: tMs, lastSeenAt: tMs, confSum: o.confidence, frames: 1,
        confirmed: false, warnedAt: null, horizontal: o.horizontal,
      }
      return this.output(tMs, null, done)
    }

    let warning: Condition | null = null
    if (!run.confirmed && run.lastSeenAt - run.startedAt >= this.confirmFor(run)) run.confirmed = true
    if (run.confirmed) {
      const last = this.lastWarnedAt[run.condition]
      if (last === undefined || tMs - last >= this.opts.warningCooldownMs) {
        warning = run.condition
        run.warnedAt = tMs
        this.lastWarnedAt[run.condition] = tMs
      }
    }
    return this.output(tMs, warning, null)
  }

  /** Close a confirmed episode in progress - on finalize, so the last one is not lost. */
  flush(tMs: number): Episode | null {
    this.lastT = tMs
    const run = this.run
    this.run = null
    return run ? this.close(run) : null
  }

  reset(): void {
    this.run = null
    this.lastWarnedAt = {}
    this.lastT = 0
  }

  get state(): TemporalState {
    return this.stateAt(this.lastT)
  }

  private confirmFor(run: Run): number {
    const m = this.opts.confirmMs
    switch (run.condition) {
      case 'FACE_MISSING': return m.faceMissing
      case 'MULTIPLE_FACES': return m.multipleFaces
      default: {
        const base = run.condition === 'LOOKING_DOWN' ? m.down : run.condition === 'LOOKING_UP' ? m.up : m.side
        const mean = run.confSum / run.frames
        return mean < this.opts.strongConfidence ? base * this.opts.weakSignalFactor : base
      }
    }
  }

  private close(run: Run): Episode | null {
    if (!run.confirmed) return null
    return {
      condition: run.condition,
      startedAtMs: run.startedAt,
      endedAtMs: run.lastSeenAt,
      durationMs: run.lastSeenAt - run.startedAt,
      confidence: Math.round((run.confSum / run.frames) * 100) / 100,
      horizontal: run.horizontal,
    }
  }

  private stateAt(tMs: number): TemporalState {
    const run = this.run
    if (run) {
      if (!run.confirmed) return 'POSSIBLE_DEVIATION'
      return run.warnedAt !== null ? 'WARNING' : 'SUSTAINED_DEVIATION'
    }
    const keys = Object.keys(this.lastWarnedAt)
    for (let i = 0; i < keys.length; i++) {
      if (tMs - this.lastWarnedAt[keys[i]] < this.opts.warningCooldownMs) return 'COOLDOWN'
    }
    return 'NORMAL'
  }

  private output(tMs: number, warning: Condition | null, ended: Episode | null): TemporalOutput {
    return { state: this.stateAt(tMs), condition: this.run ? this.run.condition : null, warning, ended }
  }
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/proctoring-baseline.test.ts tests/proctoring-temporal-engine.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: exit 0; whole suite green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 4: median baseline and temporal engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Warning copy, behaviour tracker and the detection pipeline

**Files:**
- Create: `src/lib/proctoring/client/warning-copy.ts`, `src/lib/proctoring/client/behaviour-tracker.ts`, `src/lib/proctoring/client/detection-pipeline.ts`
- Test: `tests/proctoring-warning-copy.test.ts`, `tests/proctoring-behaviour-tracker.test.ts`, `tests/proctoring-detection-pipeline.test.ts`

**Interfaces:**
- Consumes: Task 3 (`fuseSignals`, `FrameSignals`, `Baseline`, `FusedObservation`, `DETECTION_CONFIG`) and Task 4 (`BaselineCollector`, `TemporalEngine`, `Episode`, `Condition`, `TemporalOutput`). `ClientEventType` comes from Task 2.
- Produces (warning-copy): `WarningKind = 'LOOK_AT_SCREEN' | 'FACE_MISSING' | 'MULTIPLE_FACES' | 'DOWNWARD_ATTENTION'`, `WARNING_COPY: Record<WarningKind, string>`, `IntegrityNotice`, `INTEGRITY_COPY: Record<IntegrityNotice, string>`, `class WarningGate(minGapMs?, sameKindGapMs?)` with `allow(kind, tMs): boolean` and `reset()`.
- Produces (behaviour): `BehaviourType = 'SUSTAINED_DOWNWARD_ATTENTION' | 'REPEATED_DOWNWARD_ATTENTION'`, `BehaviourSignal { type; startedAtMs; endedAtMs; durationMs; confidence; metadata: Record<string, number> }`, `PatternStats { occurrences; totalDurationMs; maxDurationMs; lastOccurrenceAtMs: number | null; recentCount; perMinute }`, and `class BehaviourTracker(opts)` with `record(ep: Episode): BehaviourSignal[]`, `stats(c: Condition): PatternStats`, `reset()`.
- Produces (pipeline): `PipelinePhase = 'CALIBRATING' | 'MONITORING'`; `DetectionEvent { type: ClientEventType; startedAtMs; endedAtMs; durationMs; confidence; direction?; metadata? }`; `PipelineOutput { phase; signals; observation; baseline: Baseline | null; temporal: TemporalOutput; warnings: WarningKind[]; events: DetectionEvent[] }`; and `class DetectionPipeline(cfg?)` with `process(s, tMs)`, `flush(tMs): DetectionEvent[]`, `reset()`, `get baseline()`.
- All timestamps here are `performance.now()`-style milliseconds. The hook converts them to wall-clock ISO strings.

- [ ] **Step 1: Write the failing copy test**

`tests/proctoring-warning-copy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { INTEGRITY_COPY, WARNING_COPY, WarningGate } from '@/lib/proctoring/client/warning-copy'

/**
 * Candidate-facing copy must say monitoring is active without teaching anyone
 * the thresholds (P13), and must never claim media is recorded or saved (N3).
 */
const ALL = Object.keys(WARNING_COPY).map(k => (WARNING_COPY as Record<string, string>)[k])
  .concat(Object.keys(INTEGRITY_COPY).map(k => (INTEGRITY_COPY as Record<string, string>)[k]))

describe('proctoring warning copy', () => {
  it('uses the ticket wording for the core warnings', () => {
    expect(WARNING_COPY.LOOK_AT_SCREEN).toBe('Please look at the assessment screen.')
    expect(WARNING_COPY.FACE_MISSING).toBe('Please position your face clearly in front of the camera.')
    expect(WARNING_COPY.MULTIPLE_FACES).toMatch(/^More than one face was detected\./)
    expect(INTEGRITY_COPY.SCREEN_SHARE_STOPPED).toBe(
      'Screen sharing has stopped. Please resume screen sharing to continue the proctored assessment.'
    )
    expect(INTEGRITY_COPY.CAMERA_INTERRUPTED).toBe('Your camera connection was interrupted.')
  })

  it('tells the candidate that phones are not permitted', () => {
    expect(WARNING_COPY.DOWNWARD_ATTENTION).toMatch(/mobile phones/i)
  })

  it('reveals no numbers, durations, angles or thresholds', () => {
    ALL.forEach(s => {
      expect(s).not.toMatch(/\d/)
      expect(s).not.toMatch(/second|minute|degree|°|threshold|cooldown|percent/i)
    })
  })

  it('never claims anything is recorded, saved or uploaded', () => {
    ALL.forEach(s => expect(s).not.toMatch(/record|saved|upload|stored/i))
  })
})

describe('WarningGate', () => {
  it('spaces transient warnings apart', () => {
    const g = new WarningGate(4000, 8000)
    expect(g.allow('LOOK_AT_SCREEN', 0)).toBe(true)
    expect(g.allow('FACE_MISSING', 1000)).toBe(false)
    expect(g.allow('FACE_MISSING', 4000)).toBe(true)
    expect(g.allow('LOOK_AT_SCREEN', 5000)).toBe(false) // same kind within 8 s
    expect(g.allow('LOOK_AT_SCREEN', 8000)).toBe(true)
  })

  it('lets a second face through the global gap, but not repeatedly', () => {
    const g = new WarningGate(4000, 8000)
    g.allow('LOOK_AT_SCREEN', 0)
    expect(g.allow('MULTIPLE_FACES', 500)).toBe(true)
    expect(g.allow('MULTIPLE_FACES', 1000)).toBe(false)
  })
})
```

- [ ] **Step 2: Create `src/lib/proctoring/client/warning-copy.ts`**

```ts
/**
 * Everything proctoring says to a candidate while they sit the assessment.
 *
 * Two rules, both pinned by tests/proctoring-warning-copy.test.ts:
 *  - no digit, duration, angle or threshold: say monitoring is active, never
 *    how to stay under it;
 *  - no claim that anything is recorded, saved or uploaded, because nothing is.
 */

/** Transient, non-blocking banners raised by detection. */
export type WarningKind = 'LOOK_AT_SCREEN' | 'FACE_MISSING' | 'MULTIPLE_FACES' | 'DOWNWARD_ATTENTION'

export const WARNING_COPY: Record<WarningKind, string> = {
  LOOK_AT_SCREEN: 'Please look at the assessment screen.',
  FACE_MISSING: 'Please position your face clearly in front of the camera.',
  MULTIPLE_FACES: 'More than one face was detected. Only you should be visible during the assessment.',
  DOWNWARD_ATTENTION:
    'Please keep your attention on the assessment screen. Mobile phones and other devices are not permitted.',
}

/** Persistent notices that stay while an integrity problem lasts. */
export type IntegrityNotice =
  | 'SCREEN_SHARE_STOPPED' | 'SCREEN_SHARE_PAUSED'
  | 'CAMERA_INTERRUPTED' | 'MICROPHONE_INTERRUPTED'
  | 'CONNECTION_LOST' | 'SESSION_INTERRUPTED' | 'SESSION_CLOSED'

export const INTEGRITY_COPY: Record<IntegrityNotice, string> = {
  SCREEN_SHARE_STOPPED:
    'Screen sharing has stopped. Please resume screen sharing to continue the proctored assessment.',
  SCREEN_SHARE_PAUSED: 'Screen sharing appears to be paused. Please make sure your screen is still being shared.',
  CAMERA_INTERRUPTED: 'Your camera connection was interrupted.',
  MICROPHONE_INTERRUPTED: 'Your microphone connection was interrupted.',
  CONNECTION_LOST: 'Proctoring cannot reach the server. Please check your internet connection.',
  SESSION_INTERRUPTED: 'Proctoring was interrupted. Please resume proctoring to continue the assessment.',
  SESSION_CLOSED:
    'Proctoring for this attempt has been closed and cannot be resumed. Please contact your invigilator now and do not close this page.',
}

/**
 * Keeps transient banners readable: one at a time, and the same one not
 * repeated back-to-back. A second face skips the global gap - it is the one
 * warning a candidate must not miss because another was just shown.
 */
export class WarningGate {
  private lastShownAt: { [kind: string]: number } = {}
  private lastAnyAt = -Infinity

  constructor(private readonly minGapMs = 4000, private readonly sameKindGapMs = 8000) {}

  allow(kind: WarningKind, tMs: number): boolean {
    const last = this.lastShownAt[kind]
    if (last !== undefined && tMs - last < this.sameKindGapMs) return false
    if (kind !== 'MULTIPLE_FACES' && tMs - this.lastAnyAt < this.minGapMs) return false
    this.lastShownAt[kind] = tMs
    this.lastAnyAt = tMs
    return true
  }

  reset(): void {
    this.lastShownAt = {}
    this.lastAnyAt = -Infinity
  }
}
```

Run: `npx vitest run tests/proctoring-warning-copy.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing behaviour test**

`tests/proctoring-behaviour-tracker.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BehaviourTracker } from '@/lib/proctoring/client/behaviour-tracker'
import { DETECTION_CONFIG } from '@/lib/proctoring/client/detection-config'
import type { Condition, Episode } from '@/lib/proctoring/client/gaze-state'

function ep(condition: Condition, startedAtMs: number, durationMs: number): Episode {
  return { condition, startedAtMs, endedAtMs: startedAtMs + durationMs, durationMs, confidence: 0.9, horizontal: null }
}
const tracker = () => new BehaviourTracker(DETECTION_CONFIG)
const types = (sigs: Array<{ type: string }>) => sigs.map(s => s.type)

describe('BehaviourTracker: phone-like behaviour, without ever claiming a phone', () => {
  it('a single ordinary downward episode is only counted', () => {
    const t = tracker()
    expect(t.record(ep('LOOKING_DOWN', 0, 2600))).toEqual([])
    expect(t.stats('LOOKING_DOWN').occurrences).toBe(1)
  })

  it('one long downward episode is SUSTAINED_DOWNWARD_ATTENTION', () => {
    const sigs = tracker().record(ep('LOOKING_DOWN', 0, 7000))
    expect(types(sigs)).toEqual(['SUSTAINED_DOWNWARD_ATTENTION'])
    expect(sigs[0].durationMs).toBe(7000)
  })

  it('repeated downward attention in the window becomes one stronger signal', () => {
    const t = tracker()
    const out: string[] = []
    for (let i = 0; i < 4; i++) out.push(...types(t.record(ep('LOOKING_DOWN', i * 30_000, 3000))))
    expect(out).toEqual(['REPEATED_DOWNWARD_ATTENTION'])
  })

  it('reports occurrences, total and max duration, and frequency', () => {
    const t = tracker()
    let last: ReturnType<BehaviourTracker['record']> = []
    const durations = [3000, 4000, 3500, 5000]
    durations.forEach((d, i) => { last = t.record(ep('LOOKING_DOWN', i * 30_000, d)) })
    const repeated = last.find(s => s.type === 'REPEATED_DOWNWARD_ATTENTION')!
    expect(repeated.metadata.occurrences).toBe(4)
    expect(repeated.metadata.totalDurationMs).toBe(15_500)
    expect(repeated.metadata.maxDurationMs).toBe(5000)
    expect(repeated.metadata.perMinute).toBeGreaterThan(0)
    const s = t.stats('LOOKING_DOWN')
    expect(s).toMatchObject({ occurrences: 4, totalDurationMs: 15_500, maxDurationMs: 5000, recentCount: 4 })
    expect(s.lastOccurrenceAtMs).toBe(90_000 + 5000)
  })

  it('does not re-fire on every later episode, only after another full set', () => {
    const t = tracker()
    const counts: number[] = []
    for (let i = 0; i < 8; i++) {
      counts.push(t.record(ep('LOOKING_DOWN', i * 20_000, 3000)).filter(s => s.type === 'REPEATED_DOWNWARD_ATTENTION').length)
    }
    expect(counts).toEqual([0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('episodes spread beyond the window never add up to repeated', () => {
    const t = tracker()
    const out: string[] = []
    for (let i = 0; i < 6; i++) out.push(...types(t.record(ep('LOOKING_DOWN', i * 400_000, 3000))))
    expect(out).toEqual([])
  })

  it('sideways episodes never produce downward signals', () => {
    const t = tracker()
    const out: string[] = []
    for (let i = 0; i < 6; i++) out.push(...types(t.record(ep('LOOKING_LEFT', i * 10_000, 9000))))
    expect(out).toEqual([])
  })

  it('keeps its memory bounded', () => {
    const t = tracker()
    for (let i = 0; i < 500; i++) t.record(ep('LOOKING_DOWN', i * 100, 50))
    expect(t.stats('LOOKING_DOWN').recentCount).toBeLessThanOrEqual(DETECTION_CONFIG.maxTrackedOccurrences)
    expect(t.stats('LOOKING_DOWN').occurrences).toBe(500)
  })

  it('reset forgets everything', () => {
    const t = tracker()
    t.record(ep('LOOKING_DOWN', 0, 3000))
    t.reset()
    expect(t.stats('LOOKING_DOWN').occurrences).toBe(0)
  })
})
```

- [ ] **Step 4: Create `src/lib/proctoring/client/behaviour-tracker.ts`**

```ts
import type { DetectionConfig } from './detection-config'
import type { Condition, Episode } from './gaze-state'

/**
 * Remembers patterns across episodes, in memory only.
 *
 * Four separate downward glances in a few minutes say more than any one of
 * them. That can go with looking at something off-screen, but the browser
 * cannot know what, so the signals are named for the behaviour - never
 * PHONE_DETECTED.
 */

export type BehaviourType = 'SUSTAINED_DOWNWARD_ATTENTION' | 'REPEATED_DOWNWARD_ATTENTION'

export interface BehaviourSignal {
  type: BehaviourType
  startedAtMs: number
  endedAtMs: number
  /** Sustained: the episode's duration. Repeated: summed duration in the window. */
  durationMs: number
  confidence: number
  metadata: Record<string, number>
}

export interface PatternStats {
  occurrences: number
  totalDurationMs: number
  maxDurationMs: number
  lastOccurrenceAtMs: number | null
  /** Occurrences still inside the repetition window. */
  recentCount: number
  perMinute: number
}

type Options = Pick<DetectionConfig, 'sustainedDownwardMs' | 'repeatedDownward' | 'maxTrackedOccurrences'>

interface Recent { start: number; end: number; duration: number }

interface Track {
  occurrences: number
  totalDurationMs: number
  maxDurationMs: number
  lastOccurrenceAtMs: number | null
  recent: Recent[]
  sinceRepeated: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export class BehaviourTracker {
  private tracks: { [condition: string]: Track } = {}

  constructor(private readonly opts: Options) {}

  record(ep: Episode): BehaviourSignal[] {
    const t = this.track(ep.condition)
    t.occurrences++
    t.totalDurationMs += ep.durationMs
    t.maxDurationMs = Math.max(t.maxDurationMs, ep.durationMs)
    t.lastOccurrenceAtMs = ep.endedAtMs
    t.recent.push({ start: ep.startedAtMs, end: ep.endedAtMs, duration: ep.durationMs })
    t.sinceRepeated++
    this.prune(t, ep.endedAtMs)

    if (ep.condition !== 'LOOKING_DOWN') return []

    const out: BehaviourSignal[] = []
    if (ep.durationMs >= this.opts.sustainedDownwardMs) {
      out.push({
        type: 'SUSTAINED_DOWNWARD_ATTENTION',
        startedAtMs: ep.startedAtMs,
        endedAtMs: ep.endedAtMs,
        durationMs: ep.durationMs,
        confidence: ep.confidence,
        metadata: { durationMs: ep.durationMs },
      })
    }

    const need = this.opts.repeatedDownward.minOccurrences
    if (t.recent.length >= need && t.sinceRepeated >= need) {
      // Needs another full set before firing again, so one habit does not
      // become a row per glance.
      t.sinceRepeated = 0
      let total = 0
      let max = 0
      for (let i = 0; i < t.recent.length; i++) {
        total += t.recent[i].duration
        if (t.recent[i].duration > max) max = t.recent[i].duration
      }
      const first = t.recent[0]
      const spanMinutes = Math.max(1, (ep.endedAtMs - first.start) / 60_000)
      out.push({
        type: 'REPEATED_DOWNWARD_ATTENTION',
        startedAtMs: first.start,
        endedAtMs: ep.endedAtMs,
        durationMs: total,
        confidence: round2(Math.min(0.95, 0.6 + 0.05 * t.recent.length)),
        metadata: {
          occurrences: t.recent.length,
          totalDurationMs: total,
          maxDurationMs: max,
          perMinute: round2(t.recent.length / spanMinutes),
        },
      })
    }
    return out
  }

  stats(condition: Condition): PatternStats {
    const t = this.tracks[condition]
    if (!t) {
      return { occurrences: 0, totalDurationMs: 0, maxDurationMs: 0, lastOccurrenceAtMs: null, recentCount: 0, perMinute: 0 }
    }
    const first = t.recent.length > 0 ? t.recent[0].start : null
    const spanMinutes = first !== null && t.lastOccurrenceAtMs !== null
      ? Math.max(1, (t.lastOccurrenceAtMs - first) / 60_000)
      : 1
    return {
      occurrences: t.occurrences,
      totalDurationMs: t.totalDurationMs,
      maxDurationMs: t.maxDurationMs,
      lastOccurrenceAtMs: t.lastOccurrenceAtMs,
      recentCount: t.recent.length,
      perMinute: round2(t.recent.length / spanMinutes),
    }
  }

  reset(): void {
    this.tracks = {}
  }

  private track(condition: Condition): Track {
    let t = this.tracks[condition]
    if (!t) {
      t = { occurrences: 0, totalDurationMs: 0, maxDurationMs: 0, lastOccurrenceAtMs: null, recent: [], sinceRepeated: 0 }
      this.tracks[condition] = t
    }
    return t
  }

  /** Drop what fell out of the window, and cap memory regardless. */
  private prune(t: Track, now: number): void {
    const cutoff = now - this.opts.repeatedDownward.windowMs
    while (t.recent.length > 0 && t.recent[0].end < cutoff) t.recent.shift()
    while (t.recent.length > this.opts.maxTrackedOccurrences) t.recent.shift()
  }
}
```

Run: `npx vitest run tests/proctoring-behaviour-tracker.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing pipeline test**

`tests/proctoring-detection-pipeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DetectionPipeline, type PipelineOutput } from '@/lib/proctoring/client/detection-pipeline'
import type { FrameSignals } from '@/lib/proctoring/client/gaze-classify'

/**
 * End to end through the pure stages at ~6 FPS, with synthetic frames. This is
 * where the spec's face, gaze, temporal and phone-like scenarios are pinned.
 */

const STEP = 167
const centre = (): FrameSignals =>
  ({ faceCount: 1, yaw: 3, pitch: -2, roll: 0, irisX: 0.01, irisY: 0.02, faceWidth: 0.2, quality: 1 })
const noFace = (): FrameSignals =>
  ({ faceCount: 0, yaw: null, pitch: null, roll: null, irisX: null, irisY: null, faceWidth: null, quality: 0 })
const twoFaces = (): FrameSignals => ({ ...noFace(), faceCount: 2, quality: 1 })
const down = (): FrameSignals => ({ ...centre(), pitch: -22, irisY: 0.2 })
const left = (): FrameSignals => ({ ...centre(), yaw: -20, irisX: -0.2 })

class Clock {
  t = 0
  outs: PipelineOutput[] = []
  constructor(readonly p = new DetectionPipeline()) {}
  run(make: () => FrameSignals, ms: number): PipelineOutput[] {
    const start = this.outs.length
    for (let end = this.t + ms; this.t < end; this.t += STEP) this.outs.push(this.p.process(make(), this.t))
    return this.outs.slice(start)
  }
}

const events = (outs: PipelineOutput[]) => outs.reduce<string[]>((a, o) => a.concat(o.events.map(e => e.type)), [])
const warnings = (outs: PipelineOutput[]) => outs.reduce<string[]>((a, o) => a.concat(o.warnings), [])

function calibrated(): Clock {
  const c = new Clock()
  c.run(centre, 3300)
  return c
}

describe('DetectionPipeline', () => {
  it('calibrates first, then monitors', () => {
    const c = new Clock()
    expect(c.run(centre, 500)[0].phase).toBe('CALIBRATING')
    c.run(centre, 3000)
    expect(c.outs[c.outs.length - 1].phase).toBe('MONITORING')
    expect(c.p.baseline).toMatchObject({ yaw: 3, pitch: -2 })
  })

  it('1 face looking at the screen produces nothing', () => {
    const c = calibrated()
    const outs = c.run(centre, 30_000)
    expect(events(outs)).toEqual([])
    expect(warnings(outs)).toEqual([])
  })

  it('face disappears then returns: one FACE_MISSING event with its duration', () => {
    const c = calibrated()
    const gone = c.run(noFace, 3000)
    expect(warnings(gone)).toContain('FACE_MISSING')
    const back = c.run(centre, 1000)
    const e = back.reduce<PipelineOutput['events']>((a, o) => a.concat(o.events), [])
    expect(e.map(x => x.type)).toEqual(['FACE_MISSING'])
    expect(e[0].durationMs).toBeGreaterThan(2500)
    expect(e[0].durationMs).toBeLessThanOrEqual(3000)
  })

  it('detects a missing face even during calibration', () => {
    const c = new Clock()
    expect(warnings(c.run(noFace, 2500))).toContain('FACE_MISSING')
  })

  it('2 faces: MULTIPLE_FACES warning, and an event once cleared', () => {
    const c = calibrated()
    expect(warnings(c.run(twoFaces, 1500))).toContain('MULTIPLE_FACES')
    expect(events(c.run(centre, 1000))).toEqual(['MULTIPLE_FACES'])
  })

  it('sustained LEFT is one LOOKING_LEFT event, not one per frame', () => {
    const c = calibrated()
    const outs = c.run(left, 3000).concat(c.run(centre, 1000))
    expect(events(outs)).toEqual(['LOOKING_LEFT'])
    expect(warnings(outs)).toEqual(['LOOK_AT_SCREEN'])
  })

  it('brief downward glance: nothing at all', () => {
    const c = calibrated()
    const outs = c.run(down, 1000).concat(c.run(centre, 2000))
    expect(events(outs)).toEqual([])
    expect(warnings(outs)).toEqual([])
  })

  it('long downward glance: LOOKING_DOWN plus SUSTAINED_DOWNWARD_ATTENTION', () => {
    const c = calibrated()
    const outs = c.run(down, 7000).concat(c.run(centre, 1000))
    expect(events(outs)).toEqual(['LOOKING_DOWN', 'SUSTAINED_DOWNWARD_ATTENTION'])
    expect(warnings(outs)).toContain('DOWNWARD_ATTENTION')
  })

  it('repeated downward attention escalates on the fourth episode', () => {
    const c = calibrated()
    const all: PipelineOutput[] = []
    for (let i = 0; i < 4; i++) {
      all.push(...c.run(down, 3000))
      all.push(...c.run(centre, 15_000))
    }
    const e = events(all)
    expect(e.filter(t => t === 'LOOKING_DOWN').length).toBe(4)
    expect(e.filter(t => t === 'REPEATED_DOWNWARD_ATTENTION').length).toBe(1)
  })

  it('carries the horizontal part of a down-left look as metadata', () => {
    const c = calibrated()
    c.run(() => ({ ...down(), yaw: -20, irisX: -0.2 }), 3000)
    const out = c.run(centre, 1000).reduce<PipelineOutput['events']>((a, o) => a.concat(o.events), [])
    expect(out[0]).toMatchObject({ type: 'LOOKING_DOWN', direction: 'DOWN', metadata: { horizontal: 'LEFT' } })
  })

  it('flush returns an episode still in progress', () => {
    const c = calibrated()
    c.run(noFace, 3000)
    expect(c.p.flush(c.t).map(e => e.type)).toEqual(['FACE_MISSING'])
  })

  it('reset clears calibration and behaviour state', () => {
    const c = calibrated()
    c.p.reset()
    expect(c.p.baseline).toBeNull()
  })
})
```

- [ ] **Step 6: Create `src/lib/proctoring/client/detection-pipeline.ts`**

```ts
import type { ClientEventType } from '../event-types'
import { DETECTION_CONFIG, type DetectionConfig } from './detection-config'
import { fuseSignals, type Baseline, type FrameSignals, type FusedObservation } from './gaze-classify'
import { BaselineCollector } from './baseline'
import { TemporalEngine, type Condition, type Episode, type TemporalOutput } from './gaze-state'
import { BehaviourTracker } from './behaviour-tracker'
import type { WarningKind } from './warning-copy'

/**
 * The pure detection chain, one frame at a time:
 *
 *   FrameSignals -> baseline -> fusion -> temporal engine -> behaviour tracker
 *                -> { warnings for the candidate, metadata events for the server }
 *
 * No MediaPipe, no DOM, no clock of its own - gaze-monitor.ts feeds it - so
 * every scenario in the spec is testable in the node runner.
 */

export type PipelinePhase = 'CALIBRATING' | 'MONITORING'

export interface DetectionEvent {
  type: ClientEventType
  startedAtMs: number
  endedAtMs: number
  durationMs: number
  confidence: number
  direction?: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
  metadata?: Record<string, string | number | boolean>
}

export interface PipelineOutput {
  phase: PipelinePhase
  signals: FrameSignals
  observation: FusedObservation
  baseline: Baseline | null
  temporal: TemporalOutput
  warnings: WarningKind[]
  events: DetectionEvent[]
}

/** Presence checks never read the baseline, so any value serves before calibration. */
const PRESENCE_ONLY: Baseline = { yaw: 0, pitch: 0, irisX: null, irisY: null }

const DIRECTION: { [c: string]: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' } = {
  LOOKING_LEFT: 'LEFT', LOOKING_RIGHT: 'RIGHT', LOOKING_UP: 'UP', LOOKING_DOWN: 'DOWN',
}

function warningFor(c: Condition): WarningKind {
  if (c === 'FACE_MISSING') return 'FACE_MISSING'
  if (c === 'MULTIPLE_FACES') return 'MULTIPLE_FACES'
  return 'LOOK_AT_SCREEN'
}

function centred(quality: number): FusedObservation {
  return {
    direction: 'CENTER', horizontal: null, vertical: null, confidence: quality, agreement: 'NONE',
    deviation: { yaw: null, pitch: null, irisX: null, irisY: null },
  }
}

export class DetectionPipeline {
  private readonly collector: BaselineCollector
  private readonly temporal: TemporalEngine
  private readonly behaviour: BehaviourTracker
  private current: Baseline | null = null
  private prev: FusedObservation | null = null

  constructor(private readonly cfg: DetectionConfig = DETECTION_CONFIG) {
    this.collector = new BaselineCollector(cfg.baseline, cfg.quality.minQuality)
    this.temporal = new TemporalEngine(cfg)
    this.behaviour = new BehaviourTracker(cfg)
  }

  process(s: FrameSignals, tMs: number): PipelineOutput {
    let observation: FusedObservation
    if (s.faceCount !== 1) {
      // Presence is judged even while calibrating.
      observation = fuseSignals(s, this.current ?? PRESENCE_ONLY, this.cfg, this.prev)
    } else if (!this.current) {
      const b = this.collector.add(s, tMs)
      if (b) this.current = b
      // Nothing to measure deviation against yet. A single face reads as
      // centred, which also closes a FACE_MISSING run when the face returns.
      observation = centred(s.quality)
    } else {
      observation = fuseSignals(s, this.current, this.cfg, this.prev)
    }
    this.prev = observation

    const temporal = this.temporal.observe(observation, tMs)
    const warnings: WarningKind[] = []
    const events: DetectionEvent[] = []
    if (temporal.warning) warnings.push(warningFor(temporal.warning))
    if (temporal.ended) this.handleEnded(temporal.ended, events, warnings)

    return {
      phase: this.current ? 'MONITORING' : 'CALIBRATING',
      signals: s,
      observation,
      baseline: this.current,
      temporal,
      warnings,
      events,
    }
  }

  /** Close whatever is in progress - on finalize, so the last episode is kept. */
  flush(tMs: number): DetectionEvent[] {
    const events: DetectionEvent[] = []
    const ep = this.temporal.flush(tMs)
    if (ep) this.handleEnded(ep, events, [])
    return events
  }

  reset(): void {
    this.collector.reset()
    this.temporal.reset()
    this.behaviour.reset()
    this.current = null
    this.prev = null
  }

  get baseline(): Baseline | null {
    return this.current
  }

  private handleEnded(ep: Episode, events: DetectionEvent[], warnings: WarningKind[]): void {
    const direction = DIRECTION[ep.condition]
    events.push({
      type: ep.condition,
      startedAtMs: ep.startedAtMs,
      endedAtMs: ep.endedAtMs,
      durationMs: ep.durationMs,
      confidence: ep.confidence,
      direction,
      metadata: ep.condition === 'LOOKING_DOWN' && ep.horizontal ? { horizontal: ep.horizontal } : undefined,
    })
    const signals = this.behaviour.record(ep)
    for (let i = 0; i < signals.length; i++) {
      const b = signals[i]
      events.push({
        type: b.type, startedAtMs: b.startedAtMs, endedAtMs: b.endedAtMs,
        durationMs: b.durationMs, confidence: b.confidence, metadata: b.metadata,
      })
      if (warnings.indexOf('DOWNWARD_ATTENTION') === -1) warnings.push('DOWNWARD_ATTENTION')
    }
  }
}
```

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/proctoring-detection-pipeline.test.ts tests/proctoring-behaviour-tracker.test.ts tests/proctoring-warning-copy.test.ts`
Expected: PASS. If `'long downward glance'` fails on event order, the pipeline must push the episode before its behaviour signals. Fix the code, not the test.

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: exit 0; green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 5: behaviour tracker, detection pipeline, warning copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rewire the MediaPipe shell onto the pipeline; retire the old classifier

**Files:**
- Rewrite: `src/lib/proctoring/client/gaze-monitor.ts`
- Modify: `src/lib/proctoring/client/gaze-classify.ts`, `src/lib/proctoring/client/gaze-state.ts`, `src/lib/proctoring/types.ts`, `src/lib/proctoring/config.ts`, `src/app/api/student/proctoring/session/route.ts`, `src/lib/proctoring/client/proctoring-api.ts`, `src/lib/proctoring/client/use-proctoring.ts` (a minimal call-site edit only)
- Delete tests: `tests/proctoring-gaze-classify.test.ts`, `tests/proctoring-gaze-state.test.ts`. Tasks 3 and 4 superseded them.
- Test: `tests/proctoring-gaze-monitor.test.ts` (new, jsdom), `tests/proctoring-config.test.ts` (edit)

**Interfaces:**
- Consumes: `extractFrameSignals` (Task 3), `DetectionPipeline`, `PipelineOutput`, `DetectionEvent` (Task 5).
- Produces: `GazeMonitorOptions { config?: DetectionConfig; onOutput: (out: PipelineOutput) => void; onError?: (err: unknown) => void; assetBasePath?: string }`.
- Produces: `GazeMonitor.create(opts): Promise<GazeMonitor>`, plus `start(video)`, `flush(): DetectionEvent[]`, `stop()`, `get isRunning()`.
- `ProctoringConfig` loses the four gaze fields. The session response `config` becomes `{ heartbeatIntervalMs, screenRequired }`. `PROCTORING_VERSION` becomes `'2'`.

- [ ] **Step 1: Write the failing monitor test**

`tests/proctoring-gaze-monitor.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * The MediaPipe shell, with the model mocked. What is pinned: the model
 * config, GPU->CPU fallback, the frame-rate gate, one loop only, clean stop,
 * and requestVideoFrameCallback with its rAF fallback.
 */

const detectForVideo = vi.fn()
const close = vi.fn()
const createFromOptions = vi.fn()

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(() => Promise.resolve({})) },
  FaceLandmarker: { createFromOptions: (...a: unknown[]) => createFromOptions(...a) },
}))

import { GazeMonitor } from '@/lib/proctoring/client/gaze-monitor'
import type { PipelineOutput } from '@/lib/proctoring/client/detection-pipeline'

let rafQueue: Array<(t: number) => void>
let now: number

function video(readyState = 4): HTMLVideoElement {
  const v = document.createElement('video')
  Object.defineProperty(v, 'readyState', { configurable: true, get: () => readyState })
  return v
}

function tick(ms: number): void {
  now += ms
  const q = rafQueue
  rafQueue = []
  q.forEach(cb => cb(now))
}

beforeEach(() => {
  rafQueue = []
  now = 1000
  detectForVideo.mockReset().mockImplementation(() => ({ faceLandmarks: [], facialTransformationMatrixes: [] }))
  close.mockReset()
  createFromOptions.mockReset().mockImplementation(() => Promise.resolve({ detectForVideo, close }))
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { rafQueue.push(cb); return rafQueue.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GazeMonitor', () => {
  it('loads the self-hosted model: two faces, matrices on, blendshapes off, GPU first', async () => {
    await GazeMonitor.create({ onOutput: () => undefined })
    expect(createFromOptions.mock.calls[0][1]).toMatchObject({
      runningMode: 'VIDEO',
      numFaces: 2,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
      baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'GPU' },
    })
  })

  it('falls back to the CPU delegate when GPU initialisation fails', async () => {
    createFromOptions
      .mockImplementationOnce(() => Promise.reject(new Error('no webgl')))
      .mockImplementationOnce(() => Promise.resolve({ detectForVideo, close }))
    await GazeMonitor.create({ onOutput: () => undefined })
    expect(createFromOptions.mock.calls[1][1].baseOptions.delegate).toBe('CPU')
  })

  it('infers at roughly six frames per second, not at display rate', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    m.start(video())
    for (let i = 0; i < 20; i++) tick(50) // one second at 20 Hz
    expect(detectForVideo.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(detectForVideo.mock.calls.length).toBeLessThanOrEqual(7)
  })

  it('passes strictly increasing timestamps', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    m.start(video())
    for (let i = 0; i < 20; i++) tick(200)
    const ts = detectForVideo.mock.calls.map(c => c[1] as number)
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1])
  })

  it('never runs two loops, even if started twice', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    const v = video()
    m.start(v)
    m.start(v)
    expect(rafQueue.length).toBe(1)
    tick(200)
    expect(rafQueue.length).toBe(1)
  })

  it('skips frames while the video is not ready', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    m.start(video(1))
    for (let i = 0; i < 10; i++) tick(200)
    expect(detectForVideo).not.toHaveBeenCalled()
  })

  it('stop cancels the loop, closes the model and infers nothing more', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    m.start(video())
    tick(200)
    const calls = detectForVideo.mock.calls.length
    m.stop()
    for (let i = 0; i < 10; i++) tick(200)
    expect(detectForVideo.mock.calls.length).toBe(calls)
    expect(close).toHaveBeenCalledTimes(1)
    expect(m.isRunning).toBe(false)
  })

  it('feeds the pipeline: no face in view becomes a FACE_MISSING warning', async () => {
    const outs: PipelineOutput[] = []
    const m = await GazeMonitor.create({ onOutput: o => outs.push(o) })
    m.start(video())
    for (let i = 0; i < 20; i++) tick(170)
    expect(outs.some(o => o.warnings.indexOf('FACE_MISSING') !== -1)).toBe(true)
    expect(m.flush().map(e => e.type)).toEqual(['FACE_MISSING'])
  })

  it('prefers requestVideoFrameCallback when the element has it', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    const v = video() as HTMLVideoElement & { requestVideoFrameCallback: ReturnType<typeof vi.fn> }
    v.requestVideoFrameCallback = vi.fn(() => 1)
    m.start(v)
    expect(v.requestVideoFrameCallback).toHaveBeenCalledTimes(1)
    expect(rafQueue.length).toBe(0)
    m.stop()
  })

  it('falls back to requestAnimationFrame if video-frame callbacks never arrive', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    const v = video() as HTMLVideoElement & { requestVideoFrameCallback: ReturnType<typeof vi.fn>; cancelVideoFrameCallback: ReturnType<typeof vi.fn> }
    v.requestVideoFrameCallback = vi.fn(() => 7)
    v.cancelVideoFrameCallback = vi.fn()
    m.start(v)
    vi.advanceTimersByTime(1100)
    expect(v.cancelVideoFrameCallback).toHaveBeenCalledWith(7)
    expect(rafQueue.length).toBe(1)
    m.stop()
  })
})
```

Run: `npx vitest run tests/proctoring-gaze-monitor.test.ts`
Expected: FAIL. `create` is called with an options object the old shell does not understand, and `flush`/`isRunning` do not exist.

- [ ] **Step 2: Replace `src/lib/proctoring/client/gaze-monitor.ts`**

```ts
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision'
import { extractFrameSignals } from './gaze-classify'
import { DetectionPipeline, type DetectionEvent, type PipelineOutput } from './detection-pipeline'
import { DETECTION_CONFIG, type DetectionConfig } from './detection-config'

/**
 * The only file that touches MediaPipe: it owns the model, the video element
 * and the frame loop. It contains no thresholds and makes no decisions - those
 * are in the pure pipeline, which is fully tested.
 *
 * Nothing here makes a network call. Frames are analysed in the tab and
 * discarded. No image, landmark or baseline ever leaves the browser.
 */

export interface GazeMonitorOptions {
  config?: DetectionConfig
  /** Every inferred frame. Called ~6 times a second - keep it cheap. */
  onOutput: (out: PipelineOutput) => void
  onError?: (err: unknown) => void
  /** Where the vendored WASM and model live. Never a CDN. */
  assetBasePath?: string
}

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/** How long to wait for a first video-frame callback before using rAF instead. */
const RVFC_WATCHDOG_MS = 1000

export class GazeMonitor {
  private landmarker: FaceLandmarker | null
  private video: FrameVideo | null = null
  private handle: number | null = null
  private handleKind: 'rvfc' | 'raf' | null = null
  private useRvfc = false
  private sawFrame = false
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private running = false
  private busy = false
  private lastInferenceAt = -Infinity
  private lastTimestamp = 0
  private readonly frameIntervalMs: number
  private readonly config: DetectionConfig
  private readonly pipeline: DetectionPipeline

  private constructor(landmarker: FaceLandmarker, private readonly opts: GazeMonitorOptions) {
    this.landmarker = landmarker
    this.config = opts.config ?? DETECTION_CONFIG
    this.frameIntervalMs = 1000 / this.config.targetFps
    this.pipeline = new DetectionPipeline(this.config)
  }

  /**
   * Load the model from our own origin. A blocked CDN would otherwise break
   * proctoring after the candidate has granted permissions.
   *
   * Single-threaded WASM only: the app sets no COOP/COEP headers, so the
   * threaded build cannot run. GPU first, CPU if the GPU delegate cannot
   * initialise (no WebGL, blocklisted driver).
   */
  static async create(opts: GazeMonitorOptions): Promise<GazeMonitor> {
    const base = opts.assetBasePath ?? '/mediapipe'
    const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`)
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${base}/face_landmarker.task`, delegate },
      runningMode: 'VIDEO' as const,
      // Two, not one: a second person is the point. More costs time for no signal.
      numFaces: 2,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    })
    let landmarker: FaceLandmarker
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'))
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'))
    }
    return new GazeMonitor(landmarker, opts)
  }

  start(video: HTMLVideoElement): void {
    if (this.running || !this.landmarker) return
    this.running = true
    this.video = video as FrameVideo
    this.pipeline.reset()
    this.lastInferenceAt = -Infinity
    this.useRvfc = typeof this.video.requestVideoFrameCallback === 'function'
    this.sawFrame = false
    this.schedule()
    if (this.useRvfc) {
      this.watchdog = setTimeout(() => {
        this.watchdog = null
        if (!this.running || this.sawFrame) return
        // Some engines deliver no video-frame callbacks for an element that is
        // not in the document. Fall back rather than silently never inferring.
        this.cancelScheduled()
        this.useRvfc = false
        this.schedule()
      }, RVFC_WATCHDOG_MS)
    }
  }

  /** Close the episode in progress. Call before stop(): stop resets the pipeline. */
  flush(): DetectionEvent[] {
    return this.pipeline.flush(performance.now())
  }

  stop(): void {
    this.running = false
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog)
      this.watchdog = null
    }
    this.cancelScheduled()
    try {
      this.landmarker?.close()
    } catch {
      // A model that failed mid-load has nothing to release.
    }
    this.landmarker = null
    this.video = null
    this.pipeline.reset()
  }

  get isRunning(): boolean {
    return this.running
  }

  /**
   * One callback in flight at a time. requestVideoFrameCallback fires once
   * per decoded frame, which is cheaper than rAF at 60+ Hz. Either way the
   * timestamp gate below keeps inference at the target rate.
   */
  private schedule(): void {
    const v = this.video
    if (!this.running || !v || this.handle !== null) return
    if (this.useRvfc && v.requestVideoFrameCallback) {
      this.handleKind = 'rvfc'
      this.handle = v.requestVideoFrameCallback(this.tick)
    } else {
      this.handleKind = 'raf'
      this.handle = requestAnimationFrame(this.tick)
    }
  }

  private cancelScheduled(): void {
    if (this.handle === null) return
    if (this.handleKind === 'rvfc' && this.video && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.handle)
    } else if (this.handleKind === 'raf') {
      cancelAnimationFrame(this.handle)
    }
    this.handle = null
    this.handleKind = null
  }

  private tick = (): void => {
    this.handle = null
    this.handleKind = null
    if (!this.running) return
    this.sawFrame = true
    this.infer()
    this.schedule()
  }

  private infer(): void {
    const video = this.video
    const landmarker = this.landmarker
    // `busy` guards re-entrancy: never two inferences at once.
    if (!video || !landmarker || this.busy || video.readyState < 2) return
    const now = performance.now()
    if (now - this.lastInferenceAt < this.frameIntervalMs) return
    this.lastInferenceAt = now
    // detectForVideo requires strictly increasing timestamps.
    const ts = now > this.lastTimestamp ? now : this.lastTimestamp + 1
    this.lastTimestamp = ts
    this.busy = true
    try {
      const result = landmarker.detectForVideo(video, ts)
      this.opts.onOutput(this.pipeline.process(extractFrameSignals(result, this.config.signs), now))
    } catch (err) {
      this.opts.onError?.(err)
    } finally {
      this.busy = false
    }
  }
}
```

- [ ] **Step 3: Retire the superseded code**

- `src/lib/proctoring/client/gaze-classify.ts`: delete `GazeSignals`, `GazeBaseline`, `GazeThresholds`, `classifyGaze`, the old `extractSignals`, and the old `irisOffset`/`eyeOffset` helpers. Keep `FaceLandmarkerLike`, the landmark index constants, `RAD_TO_DEG`, and everything Task 3 appended. Rewrite the file's header comment to describe extraction plus fusion.
- `src/lib/proctoring/client/gaze-state.ts`: delete `GazeWarningType`, `GazeWarning`, `GazeStateOptions`, `DIRECTION_WARNINGS` and `class GazeStateMachine`. Keep the header comment, updated to describe `TemporalEngine`.
- `src/lib/proctoring/types.ts`: remove `'FACE_NOT_DETECTED'` from `GazeDirection`.
- Delete: `git rm tests/proctoring-gaze-classify.test.ts tests/proctoring-gaze-state.test.ts`.

- [ ] **Step 4: Remove gaze tuning from the server**

`src/lib/proctoring/config.ts`: set `export const PROCTORING_VERSION = '2'` with the comment `// Bumped: detection moved to fusion + temporal engine (live-monitoring phase).`. Delete the four `PROCTORING_*_WARNING*` schema entries, their interface fields and their assignments. Add this to the header comment: "Detection thresholds are not here. They are client tuning in client/detection-config.ts, and must never appear in an API response."

`src/app/api/student/proctoring/session/route.ts`: the `config` object becomes:

```ts
      // Operational parameters only. Detection thresholds are deliberately
      // not sent: a candidate must not be able to read them off the network tab.
      config: {
        heartbeatIntervalMs: cfg.heartbeatIntervalMs,
        screenRequired: cfg.screenRequired,
      },
```

`src/lib/proctoring/client/proctoring-api.ts`: delete the four gaze fields from `SessionConfig`.

`tests/proctoring-config.test.ts`: remove the four `PROCTORING_*WARNING*` names from `KEYS`, and add:

```ts
  it('carries no detection threshold at all', () => {
    expect(Object.keys(getProctoringConfig()).join(',')).not.toMatch(/gaze|warning|face/i)
    expect(getProctoringConfig().version).toBe('2')
  })
```

- [ ] **Step 5: Point the hook at the new monitor (call site only)**

In `src/lib/proctoring/client/use-proctoring.ts`:
1. Replace the imports `import type { GazeThresholds } from './gaze-classify'` and `import type { GazeWarning } from './gaze-state'` with `import type { PipelineOutput } from './detection-pipeline'` and `import { WARNING_COPY as DETECTION_WARNING_COPY } from './warning-copy'`.
2. Delete the `DEFAULT_GAZE_THRESHOLDS` constant and its doc comment.
3. Replace the four `GAZE_*`, `FACE_NOT_DETECTED` and `MULTIPLE_FACES_DETECTED` entries of the local `WARNING_COPY` with a spread, keeping `UPLOAD_FAILURE` (Task 11 deletes it):

```ts
const WARNING_COPY: Record<string, string> = {
  ...DETECTION_WARNING_COPY,
  UPLOAD_FAILURE:
    "We're having trouble saving assessment evidence. Please check your internet connection.",
}
```

4. Replace the whole `const monitor = await GazeMonitor.create({ … })` statement with:

```ts
        const monitor = await GazeMonitor.create({
          onOutput: (out: PipelineOutput) => {
            out.warnings.forEach(kind => showWarning(kind))
            out.events.forEach(e => {
              queueEvent(e.type, { direction: e.direction, durationMs: e.durationMs, severity: 'WARN' })
            })
          },
        })
```

Nothing else in the hook changes in this task.

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/proctoring-gaze-monitor.test.ts tests/proctoring-config.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: exit 0; green. The two jsdom suites that mock `GazeMonitor.create` still pass.

Run: `grep -rn "classifyGaze\|GazeStateMachine\|FACE_NOT_DETECTED\|gazeWarningMs" src tests`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 6: MediaPipe shell on the fusion pipeline, rVFC, CPU fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Integrity monitor (tracks and browser events)

**Files:**
- Create: `src/lib/proctoring/client/integrity-monitor.ts`
- Test: `tests/proctoring-integrity-monitor.test.ts` (jsdom)

**Interfaces:**
- Consumes: `ClientEventType` (Task 2).
- Produces: `DeviceKind = 'camera' | 'microphone' | 'screen'`, `DeviceHealth = 'ACTIVE' | 'MUTED' | 'ENDED' | 'UNAVAILABLE'`.
- Produces: `IntegrityEvent { type: ClientEventType; atMs: number; durationMs?: number; metadata?: Record<string, string | number | boolean> }`. `atMs` is on the `now()` clock, `performance.now()` by default.
- Produces: `IntegrityMonitorOptions { onEvent; onHealthChange?; onPageHide?; blurDebounceMs?; now?; doc?; win? }`.
- Produces: `class IntegrityMonitor(opts)` with `watchTrack(device, track | undefined)`, `attachPage()`, `getHealth(): Record<DeviceKind, DeviceHealth>` and `detach()`.

Events emitted:

| Trigger | Event | Health |
|---|---|---|
| track `ended` | `CAMERA_INTERRUPTED` / `MICROPHONE_INTERRUPTED` / `SCREEN_SHARE_INTERRUPTED` with `{ reason: 'ended' }` | ENDED |
| track `mute` | same types with `{ reason: 'muted' }` | MUTED |
| track `unmute` | `CAMERA_RESTORED` / `MICROPHONE_RESTORED` / `SCREEN_SHARE_RESUMED` with `durationMs` | ACTIVE |
| `visibilitychange` → hidden / visible | `TAB_HIDDEN` / `TAB_VISIBLE` (+ `durationMs`) | – |
| `pagehide` | `PAGE_HIDDEN`, then `onPageHide()` | – |
| `fullscreenchange` | `FULLSCREEN_ENTERED` / `FULLSCREEN_EXITED` (+ `durationMs`), exit only after an enter | – |
| `blur` held past the debounce, then `focus` | `WINDOW_BLUR` (stamped at blur time) / `WINDOW_FOCUS` (+ `durationMs`) | – |

- [ ] **Step 1: Write the failing test**

`tests/proctoring-integrity-monitor.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IntegrityMonitor, type IntegrityEvent } from '@/lib/proctoring/client/integrity-monitor'

interface FakeTrack {
  readyState: string
  muted: boolean
  listeners: Record<string, Array<() => void>>
  addEventListener: (e: string, cb: () => void) => void
  removeEventListener: (e: string, cb: () => void) => void
  fire: (e: string) => void
}

function fakeTrack(): FakeTrack {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    readyState: 'live',
    muted: false,
    listeners,
    addEventListener(e, cb) { listeners[e] = (listeners[e] || []).concat(cb) },
    removeEventListener(e, cb) { listeners[e] = (listeners[e] || []).filter(x => x !== cb) },
    fire(e) { (listeners[e] || []).slice().forEach(cb => cb()) },
  }
}

let now: number
let events: IntegrityEvent[]
let monitor: IntegrityMonitor

function make() {
  events = []
  return new IntegrityMonitor({ onEvent: e => events.push(e), now: () => now, blurDebounceMs: 300 })
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

const types = () => events.map(e => e.type)

beforeEach(() => {
  now = 1000
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  monitor = make()
})

afterEach(() => {
  monitor.detach()
  vi.useRealTimers()
})

describe('IntegrityMonitor: devices', () => {
  it('reports a watched live track as ACTIVE', () => {
    monitor.watchTrack('camera', fakeTrack() as unknown as MediaStreamTrack)
    expect(monitor.getHealth().camera).toBe('ACTIVE')
  })

  it('camera stopped: CAMERA_INTERRUPTED and ENDED', () => {
    const t = fakeTrack()
    monitor.watchTrack('camera', t as unknown as MediaStreamTrack)
    t.fire('ended')
    expect(types()).toEqual(['CAMERA_INTERRUPTED'])
    expect(events[0].metadata).toEqual({ reason: 'ended' })
    expect(monitor.getHealth().camera).toBe('ENDED')
  })

  it('microphone stopped: MICROPHONE_INTERRUPTED', () => {
    const t = fakeTrack()
    monitor.watchTrack('microphone', t as unknown as MediaStreamTrack)
    t.fire('ended')
    expect(types()).toEqual(['MICROPHONE_INTERRUPTED'])
  })

  it('microphone muted then unmuted: interrupted, then restored with a duration', () => {
    const t = fakeTrack()
    monitor.watchTrack('microphone', t as unknown as MediaStreamTrack)
    t.fire('mute')
    expect(monitor.getHealth().microphone).toBe('MUTED')
    now += 2500
    t.fire('unmute')
    expect(types()).toEqual(['MICROPHONE_INTERRUPTED', 'MICROPHONE_RESTORED'])
    expect(events[1].durationMs).toBe(2500)
    expect(monitor.getHealth().microphone).toBe('ACTIVE')
  })

  it('screen sharing stopped: SCREEN_SHARE_INTERRUPTED, never assumed still active', () => {
    const t = fakeTrack()
    monitor.watchTrack('screen', t as unknown as MediaStreamTrack)
    t.fire('ended')
    expect(types()).toEqual(['SCREEN_SHARE_INTERRUPTED'])
    expect(monitor.getHealth().screen).toBe('ENDED')
  })

  it('screen sharing resumed: watching a new track makes it ACTIVE again', () => {
    const old = fakeTrack()
    monitor.watchTrack('screen', old as unknown as MediaStreamTrack)
    old.fire('ended')
    monitor.watchTrack('screen', fakeTrack() as unknown as MediaStreamTrack)
    expect(monitor.getHealth().screen).toBe('ACTIVE')
    // The old track's listeners are gone, so a late event from it is ignored.
    old.fire('ended')
    expect(types()).toEqual(['SCREEN_SHARE_INTERRUPTED'])
  })

  it('a missing track is UNAVAILABLE, not ACTIVE', () => {
    monitor.watchTrack('camera', undefined)
    expect(monitor.getHealth().camera).toBe('UNAVAILABLE')
  })

  it('a track that is already ended when watched is ENDED', () => {
    const t = fakeTrack()
    t.readyState = 'ended'
    monitor.watchTrack('camera', t as unknown as MediaStreamTrack)
    expect(monitor.getHealth().camera).toBe('ENDED')
  })

  it('notifies health changes', () => {
    const seen: string[] = []
    monitor.detach()
    monitor = new IntegrityMonitor({ onEvent: () => undefined, onHealthChange: h => seen.push(h.camera), now: () => now })
    const t = fakeTrack()
    monitor.watchTrack('camera', t as unknown as MediaStreamTrack)
    t.fire('ended')
    expect(seen).toEqual(['ACTIVE', 'ENDED'])
  })
})

describe('IntegrityMonitor: page', () => {
  beforeEach(() => monitor.attachPage())

  it('tab hidden, then visible with how long it was hidden', () => {
    setVisibility('hidden')
    now += 4000
    setVisibility('visible')
    expect(types()).toEqual(['TAB_HIDDEN', 'TAB_VISIBLE'])
    expect(events[1].durationMs).toBe(4000)
  })

  it('fullscreen exit is reported only after an entry', () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(types()).toEqual([])
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.body })
    document.dispatchEvent(new Event('fullscreenchange'))
    now += 1000
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(types()).toEqual(['FULLSCREEN_ENTERED', 'FULLSCREEN_EXITED'])
  })

  it('a blur that is immediately refocused is flicker, not an event', () => {
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(1000)
    expect(types()).toEqual([])
  })

  it('a held blur is WINDOW_BLUR, stamped at the blur, then WINDOW_FOCUS', () => {
    const blurAt = now
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(500)
    now += 3000
    window.dispatchEvent(new Event('focus'))
    expect(types()).toEqual(['WINDOW_BLUR', 'WINDOW_FOCUS'])
    expect(events[0].atMs).toBe(blurAt)
    expect(events[1].durationMs).toBe(3000)
  })

  it('pagehide is recorded and hands off for a final flush', () => {
    const onPageHide = vi.fn()
    monitor.detach()
    events = []
    monitor = new IntegrityMonitor({ onEvent: e => events.push(e), onPageHide, now: () => now })
    monitor.attachPage()
    window.dispatchEvent(new Event('pagehide'))
    expect(types()).toEqual(['PAGE_HIDDEN'])
    expect(onPageHide).toHaveBeenCalledTimes(1)
  })

  it('detach removes every listener', () => {
    const t = fakeTrack()
    monitor.watchTrack('camera', t as unknown as MediaStreamTrack)
    monitor.detach()
    t.fire('ended')
    setVisibility('hidden')
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(1000)
    expect(types()).toEqual([])
  })
})
```

Run: `npx vitest run tests/proctoring-integrity-monitor.test.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 2: Create `src/lib/proctoring/client/integrity-monitor.ts`**

```ts
import type { ClientEventType } from '../event-types'

/**
 * Tamper and interruption detection: media tracks and page lifecycle.
 *
 * Every event is an observation, never a verdict. A blur or a hidden tab
 * means only that the page lost focus; a reviewer reads it next to everything
 * else. What this class guarantees is that nothing goes quiet: an ended or
 * muted track changes device health at once, so the UI and the heartbeat
 * never report a dead device as healthy.
 *
 * Options take a clock, a document and a window, so the whole class runs
 * under jsdom with fake time.
 */

export type DeviceKind = 'camera' | 'microphone' | 'screen'
export type DeviceHealth = 'ACTIVE' | 'MUTED' | 'ENDED' | 'UNAVAILABLE'

export interface IntegrityEvent {
  type: ClientEventType
  /** When it happened, on the `now()` clock. */
  atMs: number
  durationMs?: number
  metadata?: Record<string, string | number | boolean>
}

export interface IntegrityMonitorOptions {
  onEvent: (e: IntegrityEvent) => void
  onHealthChange?: (health: Record<DeviceKind, DeviceHealth>) => void
  /** Last chance to flush before the page goes away. */
  onPageHide?: () => void
  /** A blur shorter than this is flicker - a permission prompt, the share bar. */
  blurDebounceMs?: number
  now?: () => number
  doc?: Document
  win?: Window
}

const INTERRUPTED: Record<DeviceKind, ClientEventType> = {
  camera: 'CAMERA_INTERRUPTED',
  microphone: 'MICROPHONE_INTERRUPTED',
  screen: 'SCREEN_SHARE_INTERRUPTED',
}

const RESTORED: Record<DeviceKind, ClientEventType> = {
  camera: 'CAMERA_RESTORED',
  microphone: 'MICROPHONE_RESTORED',
  screen: 'SCREEN_SHARE_RESUMED',
}

export class IntegrityMonitor {
  private health: Record<DeviceKind, DeviceHealth> = { camera: 'UNAVAILABLE', microphone: 'UNAVAILABLE', screen: 'UNAVAILABLE' }
  private trackCleanup: Record<DeviceKind, (() => void) | null> = { camera: null, microphone: null, screen: null }
  private mutedAt: { [device: string]: number } = {}
  private pageCleanup: (() => void) | null = null
  private hiddenAt: number | null = null
  private fullscreenAt: number | null = null
  private blurredAt: number | null = null
  private blurTimer: ReturnType<typeof setTimeout> | null = null
  private blurReported = false
  private readonly now: () => number
  private readonly blurDebounceMs: number

  constructor(private readonly opts: IntegrityMonitorOptions) {
    this.now = opts.now ?? (() => performance.now())
    this.blurDebounceMs = opts.blurDebounceMs ?? 300
  }

  /** Watch a track, replacing any previous track for that device. */
  watchTrack(device: DeviceKind, track: MediaStreamTrack | undefined): void {
    this.unwatch(device)
    if (!track) {
      this.setHealth(device, 'UNAVAILABLE')
      return
    }
    const onEnded = () => {
      this.unwatch(device)
      this.setHealth(device, 'ENDED')
      this.emit(INTERRUPTED[device], { metadata: { reason: 'ended' } })
    }
    const onMute = () => {
      if (this.health[device] !== 'ACTIVE') return
      this.mutedAt[device] = this.now()
      this.setHealth(device, 'MUTED')
      this.emit(INTERRUPTED[device], { metadata: { reason: 'muted' } })
    }
    const onUnmute = () => {
      if (this.health[device] !== 'MUTED') return
      const since = this.mutedAt[device]
      delete this.mutedAt[device]
      this.setHealth(device, 'ACTIVE')
      this.emit(RESTORED[device], {
        durationMs: since === undefined ? undefined : this.now() - since,
        metadata: { reason: 'unmuted' },
      })
    }
    track.addEventListener('ended', onEnded)
    track.addEventListener('mute', onMute)
    track.addEventListener('unmute', onUnmute)
    this.trackCleanup[device] = () => {
      track.removeEventListener('ended', onEnded)
      track.removeEventListener('mute', onMute)
      track.removeEventListener('unmute', onUnmute)
    }
    this.setHealth(device, track.readyState === 'ended' ? 'ENDED' : track.muted ? 'MUTED' : 'ACTIVE')
  }

  attachPage(): void {
    if (this.pageCleanup) return
    const doc = this.opts.doc ?? document
    const win = this.opts.win ?? window

    const onVisibility = () => {
      if (doc.visibilityState === 'hidden') {
        if (this.hiddenAt !== null) return
        this.hiddenAt = this.now()
        this.emit('TAB_HIDDEN')
      } else if (this.hiddenAt !== null) {
        const d = this.now() - this.hiddenAt
        this.hiddenAt = null
        this.emit('TAB_VISIBLE', { durationMs: d })
      }
    }
    const onPageHide = () => {
      this.emit('PAGE_HIDDEN')
      this.opts.onPageHide?.()
    }
    const onFullscreen = () => {
      if (doc.fullscreenElement) {
        if (this.fullscreenAt !== null) return
        this.fullscreenAt = this.now()
        this.emit('FULLSCREEN_ENTERED')
      } else if (this.fullscreenAt !== null) {
        const d = this.now() - this.fullscreenAt
        this.fullscreenAt = null
        this.emit('FULLSCREEN_EXITED', { durationMs: d })
      }
    }
    const onBlur = () => {
      if (this.blurredAt !== null) return
      const at = this.now()
      this.blurredAt = at
      this.blurReported = false
      this.blurTimer = setTimeout(() => {
        this.blurTimer = null
        this.blurReported = true
        this.emit('WINDOW_BLUR', { atMs: at })
      }, this.blurDebounceMs)
    }
    const onFocus = () => {
      if (this.blurredAt === null) return
      const d = this.now() - this.blurredAt
      this.blurredAt = null
      if (this.blurTimer !== null) {
        clearTimeout(this.blurTimer)
        this.blurTimer = null
        return
      }
      if (this.blurReported) this.emit('WINDOW_FOCUS', { durationMs: d })
    }

    doc.addEventListener('visibilitychange', onVisibility)
    doc.addEventListener('fullscreenchange', onFullscreen)
    win.addEventListener('pagehide', onPageHide)
    win.addEventListener('blur', onBlur)
    win.addEventListener('focus', onFocus)
    this.pageCleanup = () => {
      doc.removeEventListener('visibilitychange', onVisibility)
      doc.removeEventListener('fullscreenchange', onFullscreen)
      win.removeEventListener('pagehide', onPageHide)
      win.removeEventListener('blur', onBlur)
      win.removeEventListener('focus', onFocus)
      if (this.blurTimer !== null) {
        clearTimeout(this.blurTimer)
        this.blurTimer = null
      }
    }
  }

  getHealth(): Record<DeviceKind, DeviceHealth> {
    return { camera: this.health.camera, microphone: this.health.microphone, screen: this.health.screen }
  }

  /** Remove every listener. Safe to call more than once. */
  detach(): void {
    this.unwatch('camera')
    this.unwatch('microphone')
    this.unwatch('screen')
    if (this.pageCleanup) {
      this.pageCleanup()
      this.pageCleanup = null
    }
    this.hiddenAt = null
    this.fullscreenAt = null
    this.blurredAt = null
    this.mutedAt = {}
  }

  private unwatch(device: DeviceKind): void {
    const cleanup = this.trackCleanup[device]
    if (cleanup) cleanup()
    this.trackCleanup[device] = null
  }

  private setHealth(device: DeviceKind, h: DeviceHealth): void {
    if (this.health[device] === h) return
    this.health[device] = h
    this.opts.onHealthChange?.(this.getHealth())
  }

  private emit(
    type: ClientEventType,
    extra: { durationMs?: number; metadata?: IntegrityEvent['metadata']; atMs?: number } = {}
  ): void {
    this.opts.onEvent({
      type,
      atMs: extra.atMs ?? this.now(),
      durationMs: extra.durationMs === undefined ? undefined : Math.max(0, Math.round(extra.durationMs)),
      metadata: extra.metadata,
    })
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/proctoring-integrity-monitor.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: exit 0; green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 7: integrity monitor for tracks and page events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Bounded event queue

**Files:**
- Create: `src/lib/proctoring/client/event-queue.ts`
- Test: `tests/proctoring-event-queue.test.ts`

**Interfaces:**
- Consumes: `ClientEventType` (Task 2).
- Produces: `WireEvent { clientEventId; type: ClientEventType; startedAt: string; endedAt?; durationMs?; confidence?; direction?; severity: 'INFO' | 'WARN'; elapsedMs?; questionId?; metadata? }`. `severity` is used only locally, for eviction priority; the server ignores it.
- Produces: `EventQueueOptions { send(batch, { keepalive }): Promise<boolean>; maxSize?: number /*200*/; batchSize?: number /*50*/; perTypeMax?: number /*20*/; perTypeWindowMs?: number /*60000*/; now?: () => number }`.
- Produces: `class EventQueue(opts)` with `push(e): boolean`, `flush({ keepalive? }): Promise<void>` (single-flight), `close()`, `get size()` and `get dropped()`.

- [ ] **Step 1: Write the failing test**

`tests/proctoring-event-queue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventQueue, type WireEvent } from '@/lib/proctoring/client/event-queue'

let n = 0
function ev(type: WireEvent['type'] = 'LOOKING_LEFT', severity: WireEvent['severity'] = 'WARN'): WireEvent {
  return { clientEventId: `evt-queue-${n++}`, type, startedAt: new Date().toISOString(), severity }
}

describe('EventQueue', () => {
  it('sends batches no larger than the batch size', async () => {
    const send = vi.fn(() => Promise.resolve(true))
    const q = new EventQueue({ send, batchSize: 3, perTypeMax: 100 })
    for (let i = 0; i < 7; i++) q.push(ev())
    await q.flush()
    expect(send.mock.calls.map(c => (c[0] as WireEvent[]).length)).toEqual([3, 3, 1])
    expect(q.size).toBe(0)
  })

  it('never holds more than maxSize, evicting INFO before WARN', () => {
    const q = new EventQueue({ send: () => Promise.resolve(true), maxSize: 3, perTypeMax: 100 })
    q.push(ev('TAB_VISIBLE', 'INFO'))
    q.push(ev('LOOKING_LEFT'))
    q.push(ev('LOOKING_RIGHT'))
    q.push(ev('MULTIPLE_FACES'))
    expect(q.size).toBe(3)
    expect(q.dropped).toBe(1)
  })

  it('caps each type per window, so a stuck condition cannot spam', () => {
    let now = 0
    const q = new EventQueue({ send: () => Promise.resolve(true), perTypeMax: 5, perTypeWindowMs: 60_000, now: () => now })
    const accepted = [0, 1, 2, 3, 4, 5, 6].map(() => q.push(ev('WINDOW_BLUR')))
    expect(accepted).toEqual([true, true, true, true, true, false, false])
    expect(q.push(ev('LOOKING_LEFT'))).toBe(true) // other types unaffected
    now = 61_000
    expect(q.push(ev('WINDOW_BLUR'))).toBe(true)
  })

  it('keeps a failed batch for the next flush, still bounded', async () => {
    const send = vi.fn(() => Promise.resolve(false))
    const q = new EventQueue({ send, maxSize: 5, perTypeMax: 100 })
    for (let i = 0; i < 4; i++) q.push(ev())
    await q.flush()
    expect(q.size).toBe(4)
    send.mockImplementation(() => Promise.resolve(true))
    await q.flush()
    expect(q.size).toBe(0)
  })

  it('treats a throwing sender as a failure, not a crash', async () => {
    const q = new EventQueue({ send: () => Promise.reject(new Error('offline')), perTypeMax: 100 })
    q.push(ev())
    await expect(q.flush()).resolves.toBeUndefined()
    expect(q.size).toBe(1)
  })

  it('is single-flight: overlapping flushes share one drain', async () => {
    let release: (v: boolean) => void = () => undefined
    const send = vi.fn(() => new Promise<boolean>(r => { release = r }))
    const q = new EventQueue({ send, perTypeMax: 100 })
    q.push(ev())
    const a = q.flush()
    const b = q.flush()
    release(true)
    await Promise.all([a, b])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('passes keepalive through for the pagehide flush', async () => {
    const send = vi.fn(() => Promise.resolve(true))
    const q = new EventQueue({ send, perTypeMax: 100 })
    q.push(ev())
    await q.flush({ keepalive: true })
    expect(send.mock.calls[0][1]).toEqual({ keepalive: true })
  })

  it('refuses events after close, and forgets what it held', () => {
    const q = new EventQueue({ send: () => Promise.resolve(true), perTypeMax: 100 })
    q.push(ev())
    q.close()
    expect(q.size).toBe(0)
    expect(q.push(ev())).toBe(false)
  })
})
```

- [ ] **Step 2: Create `src/lib/proctoring/client/event-queue.ts`**

```ts
import type { ClientEventType } from '../event-types'

/**
 * The client's outbox for metadata events.
 *
 * Three bounds, because an exam tab runs for hours on unreliable networks:
 *  - size: never more than maxSize events in memory; INFO goes before WARN;
 *  - rate: at most perTypeMax of one type per window, so a stuck condition or
 *    a flapping focus cannot flood the server or the tab;
 *  - flight: one drain at a time.
 * A failed batch goes back to the front and is retried on the next flush. The
 * server dedups on clientEventId, so resending a batch that actually landed
 * is harmless.
 */

export interface WireEvent {
  clientEventId: string
  type: ClientEventType
  startedAt: string
  endedAt?: string
  durationMs?: number
  confidence?: number
  direction?: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
  /** Eviction priority only. The server derives its own severity. */
  severity: 'INFO' | 'WARN'
  elapsedMs?: number
  questionId?: string
  metadata?: Record<string, string | number | boolean>
}

export interface EventQueueOptions {
  send: (batch: WireEvent[], opts: { keepalive: boolean }) => Promise<boolean>
  maxSize?: number
  batchSize?: number
  perTypeMax?: number
  perTypeWindowMs?: number
  now?: () => number
}

export class EventQueue {
  private items: WireEvent[] = []
  private recent: { [type: string]: number[] } = {}
  private droppedCount = 0
  private inFlight: Promise<void> | null = null
  private closed = false
  private readonly maxSize: number
  private readonly batchSize: number
  private readonly perTypeMax: number
  private readonly perTypeWindowMs: number
  private readonly now: () => number

  constructor(private readonly opts: EventQueueOptions) {
    this.maxSize = opts.maxSize ?? 200
    this.batchSize = opts.batchSize ?? 50
    this.perTypeMax = opts.perTypeMax ?? 20
    this.perTypeWindowMs = opts.perTypeWindowMs ?? 60_000
    this.now = opts.now ?? (() => Date.now())
  }

  /** False when the event was refused (closed, or over its type's rate cap). */
  push(e: WireEvent): boolean {
    if (this.closed) return false
    const now = this.now()
    const times = (this.recent[e.type] ?? []).filter(t => now - t < this.perTypeWindowMs)
    if (times.length >= this.perTypeMax) {
      this.recent[e.type] = times
      this.droppedCount++
      return false
    }
    times.push(now)
    this.recent[e.type] = times

    if (this.items.length >= this.maxSize) {
      let evict = 0
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].severity === 'INFO') { evict = i; break }
      }
      this.items.splice(evict, 1)
      this.droppedCount++
    }
    this.items.push(e)
    return true
  }

  flush(opts: { keepalive?: boolean } = {}): Promise<void> {
    if (this.inFlight) return this.inFlight
    const run = this.drain(!!opts.keepalive)
    const done = run.then(
      () => { this.inFlight = null },
      () => { this.inFlight = null }
    )
    this.inFlight = done
    return done
  }

  /** Stop accepting events and drop what is held. Used at teardown. */
  close(): void {
    this.closed = true
    this.items = []
    this.recent = {}
  }

  get size(): number {
    return this.items.length
  }

  get dropped(): number {
    return this.droppedCount
  }

  private async drain(keepalive: boolean): Promise<void> {
    while (this.items.length > 0 && !this.closed) {
      const batch = this.items.slice(0, this.batchSize)
      this.items = this.items.slice(batch.length)
      let ok = false
      try {
        ok = await this.opts.send(batch, { keepalive })
      } catch {
        ok = false
      }
      if (!ok) {
        if (this.closed) return
        this.items = batch.concat(this.items)
        if (this.items.length > this.maxSize) {
          this.droppedCount += this.items.length - this.maxSize
          this.items = this.items.slice(this.items.length - this.maxSize)
        }
        return
      }
    }
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/proctoring-event-queue.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: exit 0; green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 8: bounded, rate-capped event queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Server authority: session binding, health heartbeat, missed heartbeats, resume

**Files:**
- Modify: `src/lib/proctoring/schemas.ts`, `src/lib/proctoring/events.ts`, `src/lib/proctoring/session.ts`, `src/app/api/student/proctoring/events/route.ts`, `src/app/api/student/proctoring/heartbeat/route.ts`, `src/app/api/student/proctoring/session/route.ts`
- Test: `tests/proctoring-session-api.test.ts` (replace everything from `describe('startSession'`), `tests/proctoring-events-api.test.ts` (edit), `tests/proctoring-student-routes.test.ts` (new)

**Interfaces:**
- Wire (heartbeat body): `{ attemptId, kind, parentId, sessionId, clientState, camera, microphone, screen: DeviceHealth, gazeMonitor: 'STARTING' | 'CALIBRATING' | 'RUNNING' | 'UNAVAILABLE' | 'STOPPED', clientTimestamp: ISO, droppedEvents? }` → `{ ok: true, session: { sessionId, status } | null }`.
- Wire (events body): gains `sessionId`. Response: `{ accepted, duplicates, capped, session }`.
- Wire (session POST response): `{ sessionId, status, version, retentionExpiresAt, resumed: boolean, config: { heartbeatIntervalMs, screenRequired } }`.
- Produces (session.ts): `StartResult { session: SessionView; resumed: boolean }`; `startSession(a): Promise<StartResult>`; `HeartbeatHealth`; `HeartbeatResult { live; status; degraded; missed }`; `recordHeartbeat(sessionId, report, now?)`; `recordGapIfMissed(sessionId, since, now, thresholdMs, source)`; `finalizeSession(sessionId, status?, now?)`; `HEARTBEAT_MISSED_FACTOR = 2.5`.
- Produces (events.ts): `MAX_EVENTS_PER_SESSION = 2000`; `ingestEvents(...)` returns `{ accepted, duplicates, capped }`; `recordServerEvent(sessionId, e): Promise<boolean>` (true when inserted).
- The client (`proctoring-api.ts`, hook) is **not** changed here. Task 11 moves it onto this contract.

- [ ] **Step 1: Schemas**

In `src/lib/proctoring/schemas.ts`, replace `heartbeatSchema` with the following and add `sessionId: idSchema,` to `eventBatchSchema` after `parentId`:

```ts
export const deviceHealthSchema = z.enum(['ACTIVE', 'MUTED', 'ENDED', 'UNAVAILABLE'])

/**
 * Liveness plus device health. No media, ever - this is what the browser
 * says about its own devices. The server records it and decides what a gap or
 * a dead device means; it never takes the client's word that all is well.
 */
export const heartbeatSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  parentId: idSchema,
  sessionId: idSchema,
  clientState: z.string().regex(/^[A-Z_]{1,32}$/),
  camera: deviceHealthSchema,
  microphone: deviceHealthSchema,
  screen: deviceHealthSchema,
  gazeMonitor: z.enum(['STARTING', 'CALIBRATING', 'RUNNING', 'UNAVAILABLE', 'STOPPED']),
  clientTimestamp: z.string().datetime(),
  droppedEvents: z.number().int().min(0).max(1_000_000).optional(),
})

export type HeartbeatInput = z.infer<typeof heartbeatSchema>
```

- [ ] **Step 2: Per-session cap and server-written events in `src/lib/proctoring/events.ts`**

Add after the imports:

```ts
import type { ServerEventType } from './event-types'

/**
 * Hard ceiling on stored events per session. A normal hour produces tens of
 * rows. This bounds what a hostile client cycling fresh clientEventIds can
 * write, on top of the per-student rate limit.
 */
export const MAX_EVENTS_PER_SESSION = 2000
```

Change `ingestEvents` so that it:

```ts
export async function ingestEvents(
  sessionId: string,
  events: IncomingEvent[],
  assignedQuestionIds: string[]
): Promise<{ accepted: number; duplicates: number; capped: boolean }> {
  const stored = await prisma.proctoringEvent.count({ where: { proctoringSessionId: sessionId } })
  const room = Math.max(0, MAX_EVENTS_PER_SESSION - stored)
  if (room === 0) return { accepted: 0, duplicates: 0, capped: true }
  const admitted = events.slice(0, room)
  // ... the existing body, mapping `admitted` instead of `events` ...
  return { accepted: result.count, duplicates: rows.length - result.count, capped: admitted.length < events.length }
}
```

That is: the existing `rows = events.map(...)` becomes `rows = admitted.map(...)`, and the return gains `capped`. Then append:

```ts
/**
 * An event the server itself observed. The deterministic `srv-` id makes a
 * repeat observation of the same fact a no-op, and clients may not use that
 * prefix (schemas.ts). Returns true when a row was actually inserted.
 */
export async function recordServerEvent(
  sessionId: string,
  e: {
    clientEventId: string
    type: ServerEventType
    startedAt: Date
    endedAt?: Date
    durationMs?: number
    metadata?: Record<string, string | number | boolean>
  }
): Promise<boolean> {
  const result = await prisma.proctoringEvent.createMany({
    data: [{
      proctoringSessionId: sessionId,
      clientEventId: e.clientEventId,
      type: e.type,
      startedAt: e.startedAt,
      endedAt: e.endedAt ?? null,
      durationMs: e.durationMs ?? null,
      severity: severityFor(e.type),
      metadata: e.metadata ?? undefined,
    }],
    skipDuplicates: true,
  })
  return result.count === 1
}
```

- [ ] **Step 3: Replace the lifecycle half of `src/lib/proctoring/session.ts`**

Change the imports to:

```ts
import type { ProctoringSessionStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  HttpError,
  requireScheduledAttempt,
  requireWalkInAttempt,
  assignedQuestionIds,
  isPastDeadline,
} from '@/lib/attempt-auth'
import { getProctoringConfig } from './config'
import { recordServerEvent } from './events'
import type { HeartbeatInput } from './schemas'
import type { AttemptKind } from './types'
```

Keep `ResolvedAttempt`, `SessionView`, `LIVE_STATUSES`, `SESSION_VIEW_SELECT`, `resolveOwnedAttempt`, `linkFor`, `activeSessionFor` and `assertProctoringAvailable` from Task 1. Replace `startSession`, `recordHeartbeat`, `finalizeSession` and `sweepStaleSessions` with:

```ts
export interface StartResult {
  session: SessionView
  /** True when an INTERRUPTED session was reopened rather than created. */
  resumed: boolean
}

/**
 * Create or resume the session for an attempt. Idempotent.
 *
 * One session per attempt, ever: the FK is unique. An INTERRUPTED session -
 * closed by the sweep after its heartbeat went stale - is reopened while the
 * attempt is still running, because a dropped network is not a finished
 * attempt. The gap it left stays on record as HEARTBEAT_MISSED. COMPLETED and
 * EXPIRED sessions, and attempts past their deadline, stay closed.
 */
export async function startSession(a: ResolvedAttempt): Promise<StartResult> {
  const cfg = getProctoringConfig()

  if (!a.proctoringEnabled) throw new HttpError(400, 'This assessment is not proctored')
  if (a.isSubmitted) throw new HttpError(409, 'Test already submitted')

  const existing = await activeSessionFor(a)
  if (existing) return { session: existing, resumed: false }

  assertProctoringAvailable(cfg)

  const previous = await prisma.proctoringSession.findFirst({
    where: linkFor(a),
    select: { id: true, status: true },
  })
  if (previous) {
    if (previous.status !== 'INTERRUPTED' || isPastDeadline(a.expiresAt)) {
      throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
    }
    return { session: await resumeInterrupted(previous.id), resumed: true }
  }

  const now = new Date()
  try {
    const session = await prisma.proctoringSession.create({
      data: {
        ...linkFor(a),
        status: 'ACTIVE',
        version: cfg.version,
        startedAt: now,
        lastHeartbeatAt: now,
        retentionExpiresAt: new Date(now.getTime() + cfg.retentionHours * 3_600_000),
      },
      select: SESSION_VIEW_SELECT,
    })
    return { session, resumed: false }
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err
    const winner = await activeSessionFor(a)
    if (winner) return { session: winner, resumed: false }
    throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
  }
}

async function resumeInterrupted(sessionId: string): Promise<SessionView> {
  const now = new Date()
  const updated = await prisma.proctoringSession.updateMany({
    where: { id: sessionId, status: 'INTERRUPTED' },
    data: { status: 'ACTIVE', endedAt: null, lastHeartbeatAt: now },
  })
  if (updated.count === 1) {
    await recordServerEvent(sessionId, {
      clientEventId: `srv-resumed-${sessionId}-${now.getTime()}`,
      type: 'PROCTORING_RESUMED',
      startedAt: now,
    })
  }
  // This call or a racing one reopened it; either way, read what is live now.
  const live = await prisma.proctoringSession.findFirst({
    where: { id: sessionId, status: { in: LIVE_STATUSES } },
    select: SESSION_VIEW_SELECT,
  })
  if (!live) throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
  return live
}

/** A gap longer than this many heartbeat intervals is recorded as missed. */
export const HEARTBEAT_MISSED_FACTOR = 2.5
const MAX_GAP_MS = 14_400_000

/**
 * Record a heartbeat gap as a server-side HEARTBEAT_MISSED event.
 *
 * The id derives from the session and the last heartbeat seen, so the
 * heartbeat route, the sweep and finalize can all notice the same gap and it
 * is still stored once. Written by the server, so a client that simply stops
 * sending cannot prevent it.
 */
export async function recordGapIfMissed(
  sessionId: string,
  since: Date | null,
  now: Date,
  thresholdMs: number,
  source: 'heartbeat' | 'sweep' | 'finalize'
): Promise<boolean> {
  if (!since) return false
  const gap = now.getTime() - since.getTime()
  if (gap <= thresholdMs) return false
  const inserted = await recordServerEvent(sessionId, {
    clientEventId: `srv-hb-${sessionId}-${since.getTime()}`,
    type: 'HEARTBEAT_MISSED',
    startedAt: since,
    endedAt: now,
    durationMs: Math.min(gap, MAX_GAP_MS),
    metadata: { source },
  })
  if (inserted) {
    await prisma.proctoringSession.update({
      where: { id: sessionId },
      data: { missedHeartbeatCount: { increment: 1 } },
    })
  }
  return inserted
}

export type HeartbeatHealth = Pick<
  HeartbeatInput,
  'camera' | 'microphone' | 'screen' | 'gazeMonitor' | 'clientState' | 'clientTimestamp' | 'droppedEvents'
>

export interface HeartbeatResult {
  live: boolean
  status: string | null
  degraded: boolean
  missed: boolean
}

/**
 * Stamp liveness and health. The server decides: any required device not
 * ACTIVE, or no gaze analysis at all, is DEGRADED - whatever the client's own
 * state name says.
 */
export async function recordHeartbeat(
  sessionId: string,
  report: HeartbeatHealth,
  now = new Date()
): Promise<HeartbeatResult> {
  const cfg = getProctoringConfig()
  const session = await prisma.proctoringSession.findUnique({
    where: { id: sessionId },
    select: { status: true, lastHeartbeatAt: true },
  })
  if (!session || (session.status !== 'ACTIVE' && session.status !== 'DEGRADED')) {
    return { live: false, status: session ? session.status : null, degraded: false, missed: false }
  }

  const missed = await recordGapIfMissed(
    sessionId, session.lastHeartbeatAt, now, cfg.heartbeatIntervalMs * HEARTBEAT_MISSED_FACTOR, 'heartbeat'
  )

  const degraded =
    report.camera !== 'ACTIVE' ||
    report.microphone !== 'ACTIVE' ||
    (cfg.screenRequired && report.screen !== 'ACTIVE') ||
    report.gazeMonitor === 'UNAVAILABLE'
  const status = degraded ? 'DEGRADED' : 'ACTIVE'
  const clientMs = Date.parse(report.clientTimestamp)

  await prisma.proctoringSession.updateMany({
    // Guarded on status, so a late heartbeat cannot resurrect a closed session.
    where: { id: sessionId, status: { in: ['ACTIVE', 'DEGRADED'] } },
    data: {
      lastHeartbeatAt: now,
      // Latch: "did screen sharing ever start?". `undefined` leaves it alone.
      screenShareStarted: report.screen === 'ACTIVE' || undefined,
      status,
      lastHealth: {
        camera: report.camera,
        microphone: report.microphone,
        screen: report.screen,
        gazeMonitor: report.gazeMonitor,
        clientState: report.clientState,
        droppedEvents: report.droppedEvents ?? 0,
        // Recorded, never trusted: a candidate's clock can be wrong on purpose.
        clockSkewMs: Number.isFinite(clientMs) ? now.getTime() - clientMs : null,
        receivedAt: now.toISOString(),
      },
    },
  })
  return { live: true, status, degraded, missed }
}

/**
 * Close a session. Idempotent. A trailing heartbeat gap is recorded first:
 * stopping the proctoring script and then submitting is the cheapest bypass,
 * and it must leave a mark even when the cron sweep never ran.
 */
export async function finalizeSession(
  sessionId: string,
  status: 'COMPLETED' | 'INTERRUPTED' = 'COMPLETED',
  now = new Date()
): Promise<void> {
  const cfg = getProctoringConfig()
  const s = await prisma.proctoringSession.findUnique({
    where: { id: sessionId },
    select: { status: true, lastHeartbeatAt: true },
  })
  if (!s || LIVE_STATUSES.indexOf(s.status) === -1) return
  await recordGapIfMissed(sessionId, s.lastHeartbeatAt, now, cfg.heartbeatIntervalMs * HEARTBEAT_MISSED_FACTOR, 'finalize')
  await prisma.proctoringSession.updateMany({
    where: { id: sessionId, status: { in: LIVE_STATUSES } },
    data: { status, endedAt: now },
  })
}

/** Close sessions whose browser vanished, recording the gap. Bounded. */
export async function sweepStaleSessions(now = new Date()): Promise<number> {
  const cfg = getProctoringConfig()
  const cutoff = new Date(now.getTime() - cfg.staleSessionMs)
  const stale = await prisma.proctoringSession.findMany({
    where: {
      status: { in: LIVE_STATUSES },
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { lastHeartbeatAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true, lastHeartbeatAt: true, createdAt: true },
    take: 200,
  })
  let interrupted = 0
  for (const s of stale) {
    const updated = await prisma.proctoringSession.updateMany({
      where: { id: s.id, status: { in: LIVE_STATUSES } },
      data: { status: 'INTERRUPTED', endedAt: now },
    })
    if (updated.count !== 1) continue
    interrupted++
    await recordGapIfMissed(s.id, s.lastHeartbeatAt ?? s.createdAt, now, cfg.staleSessionMs, 'sweep')
  }
  return interrupted
}
```

- [ ] **Step 4: Routes**

`src/app/api/student/proctoring/session/route.ts` POST: replace `const session = await startSession(attempt)` with `const { session, resumed } = await startSession(attempt)`, and add `resumed,` to the JSON after `retentionExpiresAt`.

`src/app/api/student/proctoring/heartbeat/route.ts`: replace the file with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse, HttpError } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { heartbeatSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor, recordHeartbeat } from '@/lib/proctoring/session'
import { rateLimit } from '@/lib/proctoring/rate-limit'

/**
 * Liveness and device health. No media passes through here.
 *
 * The session id in the body must be the caller's own live session, resolved
 * from their own attempt. Naming anyone else's session is a 404 - it never
 * confirms that the id exists.
 */
export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    // Normal cadence is ~3/min; 12 allows retries without letting a client hammer it.
    if (!rateLimit(`heartbeat:${student.studentId}`, 12, 60_000)) {
      throw new HttpError(429, 'Too many heartbeats. Please wait a moment.')
    }
    const body = await parseBody(req, heartbeatSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    // Not an error: the client may not have noticed the session closed. It
    // learns here and shows the resume prompt.
    if (!session) return NextResponse.json({ ok: true, session: null })
    if (session.id !== body.sessionId) throw new HttpError(404, 'Proctoring session not found')

    const result = await recordHeartbeat(session.id, body)
    if (!result.live) return NextResponse.json({ ok: true, session: null })
    return NextResponse.json({ ok: true, session: { sessionId: session.id, status: result.status } })
  } catch (err) {
    return errorResponse(err, 'Proctoring heartbeat error', 'Could not record heartbeat.')
  }
}
```

`src/app/api/student/proctoring/events/route.ts`: change the not-live return to `NextResponse.json({ accepted: 0, duplicates: 0, capped: false, session: null })`, and insert before `ingestEvents`:

```ts
    // The session the client names must be its own live session. Events for
    // anyone else's session are refused as not found, never stored.
    if (session.id !== body.sessionId) throw new HttpError(404, 'Proctoring session not found')
```

- [ ] **Step 5: Replace the lifecycle tests in `tests/proctoring-session-api.test.ts`**

Change the import block to also bring in `recordGapIfMissed` and `sweepStaleSessions`. Keep the fixtures and the `resolveOwnedAttempt` describe. Replace everything from `describe('startSession'` to the end of the file with:

```ts
const HEALTHY = {
  camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE', gazeMonitor: 'RUNNING',
  clientState: 'ACTIVE', clientTimestamp: new Date().toISOString(),
} as const

/** A brand-new session on attempt A, with its events wiped by the cascade. */
async function freshA() {
  await prisma.proctoringSession.deleteMany({ where: { testAttemptId: attemptAId } })
  const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
  const { session } = await startSession(a)
  return { a, s: session }
}

const eventsOf = (sessionId: string, type: 'HEARTBEAT_MISSED' | 'PROCTORING_RESUMED') =>
  prisma.proctoringEvent.findMany({ where: { proctoringSessionId: sessionId, type } })

describe('startSession', () => {
  it('creates an ACTIVE session', async () => {
    const { s } = await freshA()
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('ACTIVE')
    expect(row.testAttemptId).toBe(attemptAId)
    expect(row.walkInAttemptId).toBeNull()
    expect(row.lastHeartbeatAt).not.toBeNull()
  })

  it('is idempotent - a second call returns the same session, not resumed', async () => {
    const { a, s } = await freshA()
    const again = await startSession(a)
    expect(again.session.id).toBe(s.id)
    expect(again.resumed).toBe(false)
    expect(await prisma.proctoringSession.count({ where: { testAttemptId: attemptAId } })).toBe(1)
  })

  it('creates a walk-in session against the other FK', async () => {
    await prisma.proctoringSession.deleteMany({ where: { walkInAttemptId } })
    const a = await resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentAId)
    const { session } = await startSession(a)
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(row.walkInAttemptId).toBe(walkInAttemptId)
    expect(row.testAttemptId).toBeNull()
  })

  it('refuses with 400 when the test is not proctored', async () => {
    const a = await resolveOwnedAttempt(plainAttemptId, 'scheduled', plainScheduleId, studentAId)
    await expect(startSession(a)).rejects.toMatchObject({ status: 400 })
    expect(await prisma.proctoringSession.count({ where: { testAttemptId: plainAttemptId } })).toBe(0)
  })

  it('refuses with 409 when the attempt is already submitted', async () => {
    const a = await resolveOwnedAttempt(submittedAttemptId, 'scheduled', proctoredScheduleId, studentBId)
    await expect(startSession(a)).rejects.toMatchObject({ status: 409 })
  })

  it('refuses with 503 when proctoring is globally disabled, and needs no storage', async () => {
    process.env.PROCTORING_ENABLED = 'false'
    resetProctoringConfigForTests()
    await prisma.proctoringSession.deleteMany({ where: { walkInAttemptId } })
    const a = await resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentAId)
    await expect(startSession(a)).rejects.toMatchObject({ status: 503, message: 'PROCTORING_DISABLED' })
  })

  it('refuses with 503 when proctoring is switched non-operational', async () => {
    process.env.PROCTORING_OPERATIONAL = 'false'
    resetProctoringConfigForTests()
    await prisma.proctoringSession.deleteMany({ where: { walkInAttemptId } })
    const a = await resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentAId)
    await expect(startSession(a)).rejects.toMatchObject({ status: 503, message: 'PROCTORING_NOT_OPERATIONAL' })
  })

  it('resumes an INTERRUPTED session in place and records that it did', async () => {
    const { a, s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { status: 'INTERRUPTED', endedAt: new Date() } })
    const resumed = await startSession(a)
    expect(resumed.resumed).toBe(true)
    expect(resumed.session.id).toBe(s.id)
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('ACTIVE')
    expect(row.endedAt).toBeNull()
    expect((await eventsOf(s.id, 'PROCTORING_RESUMED')).length).toBe(1)
  })

  it('does not resume once the attempt deadline has passed', async () => {
    const { s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { status: 'INTERRUPTED' } })
    await prisma.testAttempt.update({ where: { id: attemptAId }, data: { expiresAt: new Date(Date.now() - 10 * 60_000) } })
    try {
      const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
      await expect(startSession(a)).rejects.toMatchObject({ status: 409, message: 'PROCTORING_SESSION_CLOSED' })
    } finally {
      await prisma.testAttempt.update({ where: { id: attemptAId }, data: { expiresAt: null } })
    }
  })

  it('never reopens a COMPLETED session', async () => {
    const { a, s } = await freshA()
    await finalizeSession(s.id)
    const err = await startSession(a).catch(e => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 409, message: 'PROCTORING_SESSION_CLOSED' })
  })
})

describe('recordHeartbeat', () => {
  it('advances lastHeartbeatAt and stores device health', async () => {
    const { s } = await freshA()
    const before = new Date(Date.now() - 5_000)
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: before } })
    const r = await recordHeartbeat(s.id, HEALTHY)
    expect(r).toMatchObject({ live: true, status: 'ACTIVE', degraded: false, missed: false })
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.lastHeartbeatAt!.getTime()).toBeGreaterThan(before.getTime())
    expect(row.screenShareStarted).toBe(true)
    expect(row.lastHealth).toMatchObject({ camera: 'ACTIVE', screen: 'ACTIVE', gazeMonitor: 'RUNNING' })
  })

  it('camera stopped: DEGRADED; camera back: ACTIVE again', async () => {
    const { s } = await freshA()
    expect((await recordHeartbeat(s.id, { ...HEALTHY, camera: 'ENDED' })).status).toBe('DEGRADED')
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('DEGRADED')
    expect((await recordHeartbeat(s.id, HEALTHY)).status).toBe('ACTIVE')
  })

  it('microphone muted, screen stopped, or no gaze analysis are each DEGRADED', async () => {
    const { s } = await freshA()
    expect((await recordHeartbeat(s.id, { ...HEALTHY, microphone: 'MUTED' })).degraded).toBe(true)
    expect((await recordHeartbeat(s.id, { ...HEALTHY, screen: 'ENDED' })).degraded).toBe(true)
    expect((await recordHeartbeat(s.id, { ...HEALTHY, gazeMonitor: 'UNAVAILABLE' })).degraded).toBe(true)
  })

  it('heartbeat failure: a long gap is recorded once, server-side', async () => {
    const { s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: new Date(Date.now() - 120_000) } })
    expect((await recordHeartbeat(s.id, HEALTHY)).missed).toBe(true)
    // Heartbeat recovery: the next one on time records nothing more.
    expect((await recordHeartbeat(s.id, HEALTHY)).missed).toBe(false)
    const gaps = await eventsOf(s.id, 'HEARTBEAT_MISSED')
    expect(gaps.length).toBe(1)
    expect(gaps[0].durationMs).toBeGreaterThanOrEqual(119_000)
    expect(gaps[0].metadata).toEqual({ source: 'heartbeat' })
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).missedHeartbeatCount).toBe(1)
  })

  it('a heartbeat at normal cadence records no gap', async () => {
    const { s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: new Date(Date.now() - 20_000) } })
    expect((await recordHeartbeat(s.id, HEALTHY)).missed).toBe(false)
  })

  it('does not resurrect a finalized session', async () => {
    const { s } = await freshA()
    await finalizeSession(s.id, 'COMPLETED')
    expect((await recordHeartbeat(s.id, HEALTHY)).live).toBe(false)
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('COMPLETED')
  })
})

describe('recordGapIfMissed', () => {
  it('stores one row for one gap however many callers notice it', async () => {
    const { s } = await freshA()
    const since = new Date(Date.now() - 300_000)
    const now = new Date()
    expect(await recordGapIfMissed(s.id, since, now, 50_000, 'heartbeat')).toBe(true)
    expect(await recordGapIfMissed(s.id, since, now, 50_000, 'sweep')).toBe(false)
    expect((await eventsOf(s.id, 'HEARTBEAT_MISSED')).length).toBe(1)
  })
})

describe('finalizeSession', () => {
  it('marks COMPLETED and stamps endedAt', async () => {
    const { s } = await freshA()
    await finalizeSession(s.id)
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('COMPLETED')
    expect(row.endedAt).not.toBeNull()
  })

  it('is idempotent - a second finalize changes nothing', async () => {
    const { s } = await freshA()
    await finalizeSession(s.id)
    const first = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    await finalizeSession(s.id, 'INTERRUPTED')
    const second = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(second.status).toBe('COMPLETED')
    expect(second.endedAt!.getTime()).toBe(first.endedAt!.getTime())
  })

  it('leaves no live session behind', async () => {
    const { a, s } = await freshA()
    await finalizeSession(s.id)
    expect(await activeSessionFor(a)).toBeNull()
  })

  it('records the trailing gap of a client that stopped heartbeating before submit', async () => {
    const { s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: new Date(Date.now() - 5 * 60_000) } })
    await finalizeSession(s.id)
    const gaps = await eventsOf(s.id, 'HEARTBEAT_MISSED')
    expect(gaps.length).toBe(1)
    expect(gaps[0].metadata).toEqual({ source: 'finalize' })
  })
})

describe('sweepStaleSessions', () => {
  it('interrupts a stale session, records the gap, and leaves it resumable', async () => {
    const { a, s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) } })
    await sweepStaleSessions()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('INTERRUPTED')
    const gaps = await eventsOf(s.id, 'HEARTBEAT_MISSED')
    expect(gaps.length).toBe(1)
    expect(gaps[0].metadata).toEqual({ source: 'sweep' })
    expect((await startSession(a)).resumed).toBe(true)
  })
})
```

Delete the old `recordHeartbeat` and `finalizeSession` describes. The code above replaces them. In `beforeEach`, add `process.env.PROCTORING_HEARTBEAT_INTERVAL_MS = '20000'` so the gap threshold is pinned whatever the local `.env` says.

- [ ] **Step 6: Edit `tests/proctoring-events-api.test.ts`**

- `expect(r).toEqual({ accepted: 3, duplicates: 0 })` becomes `expect(r).toEqual({ accepted: 3, duplicates: 0, capped: false })`. The overlap case becomes `{ accepted: 1, duplicates: 1, capped: false }`.
- Add `sessionId: 's1',` to the `base` object in `describe('eventBatchSchema')`. Import `MAX_EVENTS_PER_SESSION` and `recordServerEvent` from `@/lib/proctoring/events`. Append inside `describe('ingestEvents')`:

```ts
  it('stops storing at the per-session ceiling', async () => {
    const filler = []
    for (let i = 0; i < MAX_EVENTS_PER_SESSION - 2; i++) {
      filler.push({ proctoringSessionId: sessionId, clientEventId: `fill-${i}`, type: 'WINDOW_BLUR' as const, startedAt: new Date() })
    }
    await prisma.proctoringEvent.createMany({ data: filler })
    const r = await ingestEvents(sessionId, [gaze(), gaze(), gaze(), gaze()], ASSIGNED)
    expect(r).toMatchObject({ accepted: 2, capped: true })
    expect(await prisma.proctoringEvent.count({ where: { proctoringSessionId: sessionId } })).toBe(MAX_EVENTS_PER_SESSION)
    expect((await ingestEvents(sessionId, [gaze()], ASSIGNED)).accepted).toBe(0)
  })

  it('records a server event once, however often it is observed', async () => {
    const at = new Date()
    const e = { clientEventId: `srv-test-${sessionId}`, type: 'HEARTBEAT_MISSED' as const, startedAt: at }
    expect(await recordServerEvent(sessionId, e)).toBe(true)
    expect(await recordServerEvent(sessionId, e)).toBe(false)
  })
```

- [ ] **Step 7: Route-level ownership tests**

`tests/proctoring-student-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

/**
 * The student proctoring routes, called as handlers with a stubbed session.
 * What is pinned is server authority: a candidate can only ever touch their
 * own live session, whatever ids they put in the body.
 */
const getServerSession = vi.fn()
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}))

import { prisma } from '@/lib/db'
import { POST as eventsPost } from '@/app/api/student/proctoring/events/route'
import { POST as heartbeatPost } from '@/app/api/student/proctoring/heartbeat/route'
import { POST as sessionPost } from '@/app/api/student/proctoring/session/route'
import { resetRateLimitsForTests } from '@/lib/proctoring/rate-limit'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'

const TAG = `routes-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
const userIds: string[] = []
const people: Record<'a' | 'b', { email: string; attemptId: string; sessionId: string }> = {
  a: { email: '', attemptId: '', sessionId: '' },
  b: { email: '', attemptId: '', sessionId: '' },
}

function post(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

const as = (who: 'a' | 'b') => getServerSession.mockResolvedValue({ user: { email: people[who].email, role: 'STUDENT' } })
const ref = (who: 'a' | 'b') => ({ attemptId: people[who].attemptId, kind: 'scheduled', parentId: scheduleId })
const event = (id: string, type = 'LOOKING_LEFT') => ({ clientEventId: id, type, startedAt: new Date().toISOString() })
const HEALTH = {
  clientState: 'ACTIVE', camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE',
  gazeMonitor: 'RUNNING', clientTimestamp: new Date().toISOString(),
}

beforeAll(async () => {
  collegeId = (await prisma.college.create({ data: { name: `${TAG}-college` } })).id
  testId = (await prisma.test.create({
    data: { title: TAG, durationMinutes: 60, proctoringEnabled: true, assessmentConfig: [] },
  })).id
  scheduleId = (await prisma.testSchedule.create({
    data: { testId, collegeId, scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
  })).id
  for (const who of ['a', 'b'] as const) {
    const email = `${TAG}-${who}@example.test`
    const user = await prisma.user.create({ data: { email, name: TAG, password: 'x', role: 'STUDENT' } })
    userIds.push(user.id)
    const profile = await prisma.studentProfile.create({ data: { userId: user.id, collegeId, fullName: TAG, email } })
    const attempt = await prisma.testAttempt.create({
      data: { scheduleId, studentId: profile.id, userId: user.id, questionIds: [] },
    })
    const session = await prisma.proctoringSession.create({
      data: {
        testAttemptId: attempt.id, status: 'ACTIVE', startedAt: new Date(), lastHeartbeatAt: new Date(),
        retentionExpiresAt: new Date(Date.now() + 72 * 3_600_000),
      },
    })
    people[who] = { email, attemptId: attempt.id, sessionId: session.id }
  }
})

afterAll(async () => {
  await prisma.proctoringSession.deleteMany({ where: { testAttemptId: { in: [people.a.attemptId, people.b.attemptId] } } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

beforeEach(() => {
  getServerSession.mockReset()
  resetRateLimitsForTests()
  process.env.PROCTORING_ENABLED = 'true'
  process.env.PROCTORING_OPERATIONAL = 'true'
  resetProctoringConfigForTests()
})

const countFor = (who: 'a' | 'b') => prisma.proctoringEvent.count({ where: { proctoringSessionId: people[who].sessionId } })

describe('POST /api/student/proctoring/events', () => {
  it('stores events for the caller\'s own live session', async () => {
    as('a')
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('a'), sessionId: people.a.sessionId, events: [event('evt-route-own-01')],
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).accepted).toBe(1)
  })

  it('refuses another candidate\'s session id with 404 and stores nothing anywhere', async () => {
    as('a')
    const before = [await countFor('a'), await countFor('b')]
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('a'), sessionId: people.b.sessionId, events: [event('evt-route-fake-01')],
    }))
    expect(res.status).toBe(404)
    expect([await countFor('a'), await countFor('b')]).toEqual(before)
  })

  it('refuses another candidate\'s attempt with 404', async () => {
    as('a')
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('b'), sessionId: people.b.sessionId, events: [event('evt-route-fake-02')],
    }))
    expect(res.status).toBe(404)
  })

  it('refuses a server-only event type from a client', async () => {
    as('a')
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('a'), sessionId: people.a.sessionId, events: [event('evt-route-srv-01', 'HEARTBEAT_MISSED')],
    }))
    expect(res.status).toBe(400)
  })

  it('rate-limits a client streaming batches', async () => {
    as('a')
    let last = 0
    for (let i = 0; i < 31; i++) {
      const res = await eventsPost(post('/api/student/proctoring/events', {
        ...ref('a'), sessionId: people.a.sessionId, events: [event(`evt-route-rate-${i}`)],
      }))
      last = res.status
    }
    expect(last).toBe(429)
  })

  it('refuses an unauthenticated caller', async () => {
    getServerSession.mockResolvedValue(null)
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('a'), sessionId: people.a.sessionId, events: [event('evt-route-anon-01')],
    }))
    expect(res.status).toBe(401)
  })
})

describe('POST /api/student/proctoring/heartbeat', () => {
  it('records health for the caller\'s own session', async () => {
    as('a')
    const res = await heartbeatPost(post('/api/student/proctoring/heartbeat', {
      ...ref('a'), sessionId: people.a.sessionId, ...HEALTH,
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, session: { sessionId: people.a.sessionId, status: 'ACTIVE' } })
  })

  it('marks the session DEGRADED server-side when the camera is reported stopped', async () => {
    as('a')
    await heartbeatPost(post('/api/student/proctoring/heartbeat', {
      ...ref('a'), sessionId: people.a.sessionId, ...HEALTH, camera: 'ENDED',
    }))
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: people.a.sessionId } })).status).toBe('DEGRADED')
  })

  it('refuses a mismatched session id with 404', async () => {
    as('a')
    const res = await heartbeatPost(post('/api/student/proctoring/heartbeat', {
      ...ref('a'), sessionId: people.b.sessionId, ...HEALTH,
    }))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/student/proctoring/session', () => {
  it('returns operational config only - no detection threshold ever leaves the server', async () => {
    as('b')
    const res = await sessionPost(post('/api/student/proctoring/session', ref('b')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body.config).sort()).toEqual(['heartbeatIntervalMs', 'screenRequired'])
    expect(body.resumed).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/gaze|warningMs|cooldown|yaw|pitch|threshold/i)
  })
})
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. The hook still calls the old `proctoringApi.heartbeat(ref, {…})`. That compiles against the client's own type, and Task 11 moves it over.

Run: `npx vitest run`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 9: session-bound events and heartbeats, server-side gaps, resume

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Pin the `/start` gate (security review items 1, 6 and 10)

The gate already exists in both start routes (Part 4) but has no test. This task pins it. If a case fails, fix the route; do not loosen the test.

**Files:**
- Test: `tests/proctoring-start-gate.test.ts` (new)
- Modify (only if a case fails): `src/app/api/student/test/[scheduleId]/start/route.ts`, `src/app/api/student/walkin-test/[testId]/start/route.ts`

**Interfaces:**
- Consumes: the two start route handlers, `ProctoringSession` rows. No new code is expected.

- [ ] **Step 1: Write the test**

`tests/proctoring-start-gate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

/**
 * The clock cannot start on a proctored test without a live proctoring
 * session, whatever the client says. The attempt is pre-created with an empty
 * question set so the route never calls the question picker.
 */
const getServerSession = vi.fn()
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}))

import { prisma } from '@/lib/db'
import { POST as scheduledStart } from '@/app/api/student/test/[scheduleId]/start/route'
import { POST as walkInStart } from '@/app/api/student/walkin-test/[testId]/start/route'

const TAG = `start-gate-${Date.now()}`
let collegeId = ''
let studentId = ''
let userId = ''
let email = ''
let proctoredTestId = ''
let plainTestId = ''
let proctoredScheduleId = ''
let plainScheduleId = ''
let walkInTestId = ''
let proctoredAttemptId = ''
let plainAttemptId = ''
let walkInAttemptId = ''

const req = (body: unknown = {}) =>
  new Request('http://localhost/start', { method: 'POST', body: JSON.stringify(body) }) as never
const scheduled = (scheduleId: string, body?: unknown) =>
  scheduledStart(req(body), { params: Promise.resolve({ scheduleId }) })
const walkIn = (testId: string, body?: unknown) =>
  walkInStart(req(body), { params: Promise.resolve({ testId }) })

async function setSession(where: { testAttemptId?: string; walkInAttemptId?: string }, status: 'ACTIVE' | 'INTERRUPTED' | 'COMPLETED' | null) {
  await prisma.proctoringSession.deleteMany({ where })
  if (status) {
    await prisma.proctoringSession.create({
      data: { ...where, status, startedAt: new Date(), lastHeartbeatAt: new Date(), retentionExpiresAt: new Date(Date.now() + 3_600_000) },
    })
  }
}

async function resetClock() {
  await prisma.testAttempt.updateMany({ where: { id: { in: [proctoredAttemptId, plainAttemptId] } }, data: { startedAt: null, expiresAt: null } })
  await prisma.walkInAttempt.updateMany({ where: { id: walkInAttemptId }, data: { startedAt: null, expiresAt: null } })
}

beforeAll(async () => {
  collegeId = (await prisma.college.create({ data: { name: `${TAG}-college` } })).id
  email = `${TAG}@example.test`
  const user = await prisma.user.create({ data: { email, name: TAG, password: 'x', role: 'STUDENT' } })
  userId = user.id
  studentId = (await prisma.studentProfile.create({ data: { userId, collegeId, fullName: TAG, email } })).id

  const window = { scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) }
  proctoredTestId = (await prisma.test.create({ data: { title: `${TAG}-p`, proctoringEnabled: true, assessmentConfig: [] } })).id
  plainTestId = (await prisma.test.create({ data: { title: `${TAG}-plain`, assessmentConfig: [] } })).id
  proctoredScheduleId = (await prisma.testSchedule.create({ data: { testId: proctoredTestId, collegeId, ...window } })).id
  plainScheduleId = (await prisma.testSchedule.create({ data: { testId: plainTestId, collegeId, ...window } })).id
  proctoredAttemptId = (await prisma.testAttempt.create({ data: { scheduleId: proctoredScheduleId, studentId, userId, questionIds: [] } })).id
  plainAttemptId = (await prisma.testAttempt.create({ data: { scheduleId: plainScheduleId, studentId, userId, questionIds: [] } })).id

  walkInTestId = (await prisma.test.create({
    data: { title: `${TAG}-w`, isWalkIn: true, status: 'ACTIVE', proctoringEnabled: true, assessmentConfig: [] },
  })).id
  await prisma.walkInEligibleStudent.create({ data: { testId: walkInTestId, studentId } })
  walkInAttemptId = (await prisma.walkInAttempt.create({ data: { testId: walkInTestId, studentId, userId, questionIds: [] } })).id
})

afterAll(async () => {
  await prisma.proctoringSession.deleteMany({
    where: { OR: [{ testAttemptId: { in: [proctoredAttemptId, plainAttemptId] } }, { walkInAttemptId }] },
  })
  await prisma.testAttempt.deleteMany({ where: { scheduleId: { in: [proctoredScheduleId, plainScheduleId] } } })
  await prisma.walkInAttempt.deleteMany({ where: { testId: walkInTestId } })
  await prisma.walkInEligibleStudent.deleteMany({ where: { testId: walkInTestId } })
  await prisma.testSchedule.deleteMany({ where: { id: { in: [proctoredScheduleId, plainScheduleId] } } })
  await prisma.test.deleteMany({ where: { id: { in: [proctoredTestId, plainTestId, walkInTestId] } } })
  await prisma.studentProfile.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { id: userId } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

beforeEach(async () => {
  getServerSession.mockResolvedValue({ user: { email, role: 'STUDENT' } })
  await resetClock()
})

const startedAt = async (kind: 'scheduled' | 'walkin', id: string) =>
  kind === 'scheduled'
    ? (await prisma.testAttempt.findUniqueOrThrow({ where: { id } })).startedAt
    : (await prisma.walkInAttempt.findUniqueOrThrow({ where: { id } })).startedAt

describe('/start on a proctored scheduled test', () => {
  it('refuses without any proctoring session, and the clock does not start', async () => {
    await setSession({ testAttemptId: proctoredAttemptId }, null)
    const res = await scheduled(proctoredScheduleId)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROCTORING_REQUIRED')
    expect(await startedAt('scheduled', proctoredAttemptId)).toBeNull()
  })

  it('ignores a client that simply claims proctoring is active', async () => {
    await setSession({ testAttemptId: proctoredAttemptId }, null)
    const res = await scheduled(proctoredScheduleId, { proctoringActive: true, sessionId: 'made-up' })
    expect(res.status).toBe(409)
  })

  it('refuses an INTERRUPTED or COMPLETED session', async () => {
    for (const status of ['INTERRUPTED', 'COMPLETED'] as const) {
      await setSession({ testAttemptId: proctoredAttemptId }, status)
      expect((await scheduled(proctoredScheduleId)).status).toBe(409)
    }
  })

  it('starts the clock once a live session exists', async () => {
    await setSession({ testAttemptId: proctoredAttemptId }, 'ACTIVE')
    const res = await scheduled(proctoredScheduleId)
    expect(res.status).toBe(200)
    expect(await startedAt('scheduled', proctoredAttemptId)).not.toBeNull()
  })

  it('refuses an unauthenticated caller even with a live session in place', async () => {
    await setSession({ testAttemptId: proctoredAttemptId }, 'ACTIVE')
    getServerSession.mockResolvedValue(null)
    expect((await scheduled(proctoredScheduleId)).status).toBe(401)
  })
})

describe('/start on a proctored walk-in test', () => {
  it('refuses without a live session', async () => {
    await setSession({ walkInAttemptId }, null)
    const res = await walkIn(walkInTestId)
    expect(res.status).toBe(409)
    expect(await startedAt('walkin', walkInAttemptId)).toBeNull()
  })

  it('starts once a live session exists', async () => {
    await setSession({ walkInAttemptId }, 'ACTIVE')
    expect((await walkIn(walkInTestId)).status).toBe(200)
    expect(await startedAt('walkin', walkInAttemptId)).not.toBeNull()
  })
})

describe('/start on a non-proctored test (regression)', () => {
  it('starts exactly as before, with no proctoring session and none created', async () => {
    const res = await scheduled(plainScheduleId)
    expect(res.status).toBe(200)
    expect(await startedAt('scheduled', plainAttemptId)).not.toBeNull()
    expect(await prisma.proctoringSession.count({ where: { testAttemptId: plainAttemptId } })).toBe(0)
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/proctoring-start-gate.test.ts`
Expected: PASS without code changes. The gate was built in Part 4. If `'refuses an INTERRUPTED or COMPLETED session'` fails, the route's `status: { in: [...] }` list has drifted. Restore it to `['ACTIVE', 'DEGRADED']` in both routes.

- [ ] **Step 3: Full suite, then commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: green.

```bash
git add -A
git commit -m "proctoring live-monitoring 10: pin the /start gate for both attempt kinds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Client rewire: the hook on live monitoring, with no recording and no upload

**Files:**
- Delete: `src/lib/proctoring/client/webcam-recorder.ts`, `src/lib/proctoring/client/screen-capture.ts`, `src/lib/proctoring/client/upload-queue.ts`, `tests/proctoring-screen-capture.test.tsx`, `tests/proctoring-upload-queue.test.ts`
- Create: `src/lib/proctoring/client/diagnostics.ts`
- Rewrite: `src/lib/proctoring/client/use-proctoring.ts`, `src/lib/proctoring/client/proctoring-api.ts`, `src/lib/proctoring/client/state-machine.ts`, `src/lib/proctoring/client/media-support.ts`, `src/components/proctoring/ProctoringStatusIndicator.tsx`
- Modify: `src/lib/proctoring/types.ts`, `src/components/proctoring/ProctoringSetup.tsx` (state rename only), both candidate pages (top-bar indicator props only)
- Test: rewrite `tests/proctoring-use-proctoring.test.tsx`, `tests/proctoring-state-machine.test.ts`, `tests/proctoring-media-support.test.ts`; edit `tests/proctoring-setup.test.tsx`; new `tests/proctoring-diagnostics.test.ts`

**Interfaces:**
- Consumes: `GazeMonitor` (T6), `IntegrityMonitor` (T7), `EventQueue`/`WireEvent` (T8), `WARNING_COPY`/`INTEGRITY_COPY`/`WarningGate` (T5), `severityFor` (T2), and the Task 9 wire contract.
- Produces (hook): `GazeHealth = 'IDLE' | 'LOADING' | 'CALIBRATING' | 'RUNNING' | 'UNAVAILABLE'`; `ProctoringHealth { camera, microphone, screen: DeviceHealth; gaze: GazeHealth; connection: 'OK' | 'LOST' }`; `CaptureState { screenSharing; cameraLive; micLive }`.
- Produces (hook): `UseProctoringResult { state, support, devices, warning: { message; kind: WarningKind } | null, health, capture, startError, needsRecovery, diagnostics: DiagnosticsSnapshot | null, requestPermissionsAndStart, resumeScreenShare, resumeCamera, resumeSession, finalize, videoRef }`.
- Produces (api): `SessionConfig { heartbeatIntervalMs; screenRequired }`, `StartedSession { …; resumed; config }`, `GazeMonitorHealth`, `HeartbeatReport`, `proctoringApi.heartbeat(ref, report)`, `proctoringApi.sendEvents(ref, sessionId, events, { keepalive? })`.
- Produces (diagnostics): `DIAGNOSTICS_ENABLED`, `DiagnosticsSnapshot`, `directionLabel(o)`, `toDiagnosticsSnapshot(out)`.
- `ProctoringClientState` final set: `IDLE CHECKING_DEVICES AWAITING_PERMISSION READY STARTING ACTIVE DEGRADED FINALIZING COMPLETED PERMISSION_DENIED SCREEN_SHARE_STOPPED CAMERA_STOPPED MICROPHONE_STOPPED NETWORK_OFFLINE SESSION_INTERRUPTED UNSUPPORTED_BROWSER PROCTORING_UNAVAILABLE EXPIRED`.
- Produces (indicator): `ProctoringStatusIndicator({ state, health, variant?: 'chip' | 'panel' })` and `needsAttention(state, health): boolean`.

- [ ] **Step 1: Delete the capture and upload modules**

```bash
git rm src/lib/proctoring/client/webcam-recorder.ts src/lib/proctoring/client/screen-capture.ts \
  src/lib/proctoring/client/upload-queue.ts tests/proctoring-screen-capture.test.tsx tests/proctoring-upload-queue.test.ts
```

- [ ] **Step 2: `types.ts` and the state machine**

In `src/lib/proctoring/types.ts`, replace `ProctoringClientState` with:

```ts
export type ProctoringClientState =
  | 'IDLE' | 'CHECKING_DEVICES' | 'AWAITING_PERMISSION' | 'READY'
  | 'STARTING' | 'ACTIVE' | 'DEGRADED' | 'FINALIZING' | 'COMPLETED'
  | 'PERMISSION_DENIED' | 'SCREEN_SHARE_STOPPED' | 'CAMERA_STOPPED'
  | 'MICROPHONE_STOPPED' | 'NETWORK_OFFLINE' | 'SESSION_INTERRUPTED'
  | 'UNSUPPORTED_BROWSER' | 'PROCTORING_UNAVAILABLE' | 'EXPIRED'
```

Replace `src/lib/proctoring/client/state-machine.ts` below its header comment with:

```ts
import type { ProctoringClientState } from '../types'

export type ProctoringEventName =
  | 'CHECK_DEVICES' | 'DEVICES_OK' | 'UNSUPPORTED'
  | 'START_REQUESTED' | 'PERMISSIONS_GRANTED' | 'PERMISSIONS_DENIED'
  | 'SESSION_STARTED' | 'PROCTORING_UNAVAILABLE'
  | 'SCREEN_SHARE_ENDED' | 'SCREEN_SHARE_RESUMED'
  | 'CAMERA_ENDED' | 'MICROPHONE_ENDED' | 'DEVICES_RECOVERED'
  | 'SESSION_LOST' | 'SESSION_RESUMED'
  | 'OFFLINE' | 'ONLINE' | 'EXPIRE' | 'FINALIZE' | 'FINALIZED'

type Table = {
  [S in ProctoringClientState]?: { [E in ProctoringEventName]?: ProctoringClientState }
}

/** From every live state, the server can report the session gone. */
const LOST = { SESSION_LOST: 'SESSION_INTERRUPTED' as const, EXPIRE: 'EXPIRED' as const }

const LIVE_STATES: ProctoringClientState[] = [
  'STARTING', 'ACTIVE', 'DEGRADED', 'SCREEN_SHARE_STOPPED', 'CAMERA_STOPPED',
  'MICROPHONE_STOPPED', 'NETWORK_OFFLINE', 'SESSION_INTERRUPTED',
]

const TABLE: Table = {
  IDLE: { CHECK_DEVICES: 'CHECKING_DEVICES', UNSUPPORTED: 'UNSUPPORTED_BROWSER' },
  CHECKING_DEVICES: { DEVICES_OK: 'READY', UNSUPPORTED: 'UNSUPPORTED_BROWSER' },
  READY: { START_REQUESTED: 'AWAITING_PERMISSION', UNSUPPORTED: 'UNSUPPORTED_BROWSER' },
  AWAITING_PERMISSION: { PERMISSIONS_GRANTED: 'STARTING', PERMISSIONS_DENIED: 'PERMISSION_DENIED' },
  // A retry goes back through the permission step: the gesture rule means
  // asking again, never assuming.
  PERMISSION_DENIED: { START_REQUESTED: 'AWAITING_PERMISSION' },
  PROCTORING_UNAVAILABLE: { START_REQUESTED: 'AWAITING_PERMISSION' },
  STARTING: {
    SESSION_STARTED: 'ACTIVE',
    PROCTORING_UNAVAILABLE: 'PROCTORING_UNAVAILABLE',
    PERMISSIONS_DENIED: 'PERMISSION_DENIED',
  },
  ACTIVE: {
    SCREEN_SHARE_ENDED: 'SCREEN_SHARE_STOPPED',
    CAMERA_ENDED: 'CAMERA_STOPPED',
    MICROPHONE_ENDED: 'MICROPHONE_STOPPED',
    OFFLINE: 'NETWORK_OFFLINE',
    ...LOST,
  },
  DEGRADED: { DEVICES_RECOVERED: 'ACTIVE', ...LOST },
  SCREEN_SHARE_STOPPED: { SCREEN_SHARE_RESUMED: 'ACTIVE', CAMERA_ENDED: 'CAMERA_STOPPED', ...LOST },
  CAMERA_STOPPED: { DEVICES_RECOVERED: 'ACTIVE', SCREEN_SHARE_ENDED: 'SCREEN_SHARE_STOPPED', ...LOST },
  MICROPHONE_STOPPED: { DEVICES_RECOVERED: 'ACTIVE', ...LOST },
  NETWORK_OFFLINE: { ONLINE: 'ACTIVE', ...LOST },
  SESSION_INTERRUPTED: { SESSION_RESUMED: 'ACTIVE', EXPIRE: 'EXPIRED' },
  FINALIZING: { FINALIZED: 'COMPLETED' },
}

/**
 * (state, event) -> state. Anything absent from the table leaves the state
 * unchanged, so a late event cannot reanimate a finished session. The UI does
 * not read device problems from this single state - several can be true at
 * once - but from the hook's `health`.
 */
export function nextState(current: ProctoringClientState, event: ProctoringEventName): ProctoringClientState {
  const target = TABLE[current]?.[event]
  if (target) return target
  // A candidate must always be able to submit, whatever proctoring is doing.
  if (event === 'FINALIZE' && LIVE_STATES.indexOf(current) !== -1) return 'FINALIZING'
  return current
}
```

Replace `tests/proctoring-state-machine.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { nextState } from '@/lib/proctoring/client/state-machine'

describe('proctoring client state machine', () => {
  it('walks the happy path to ACTIVE and on to COMPLETED', () => {
    let s = nextState('IDLE', 'CHECK_DEVICES')
    s = nextState(s, 'DEVICES_OK')
    s = nextState(s, 'START_REQUESTED')
    s = nextState(s, 'PERMISSIONS_GRANTED')
    s = nextState(s, 'SESSION_STARTED')
    expect(s).toBe('ACTIVE')
    expect(nextState(nextState(s, 'FINALIZE'), 'FINALIZED')).toBe('COMPLETED')
  })

  it('screen share stops and resumes', () => {
    expect(nextState('ACTIVE', 'SCREEN_SHARE_ENDED')).toBe('SCREEN_SHARE_STOPPED')
    expect(nextState('SCREEN_SHARE_STOPPED', 'SCREEN_SHARE_RESUMED')).toBe('ACTIVE')
  })

  it('camera stops and recovers', () => {
    expect(nextState('ACTIVE', 'CAMERA_ENDED')).toBe('CAMERA_STOPPED')
    expect(nextState('CAMERA_STOPPED', 'DEVICES_RECOVERED')).toBe('ACTIVE')
  })

  it('a lost session is interrupted from any live state and resumes to ACTIVE', () => {
    const live = ['ACTIVE', 'SCREEN_SHARE_STOPPED', 'CAMERA_STOPPED', 'MICROPHONE_STOPPED', 'NETWORK_OFFLINE'] as const
    live.forEach(s => expect(nextState(s, 'SESSION_LOST')).toBe('SESSION_INTERRUPTED'))
    expect(nextState('SESSION_INTERRUPTED', 'SESSION_RESUMED')).toBe('ACTIVE')
  })

  it('always allows FINALIZE from a live state', () => {
    const live = ['STARTING', 'ACTIVE', 'SCREEN_SHARE_STOPPED', 'CAMERA_STOPPED', 'SESSION_INTERRUPTED', 'NETWORK_OFFLINE'] as const
    live.forEach(s => expect(nextState(s, 'FINALIZE')).toBe('FINALIZING'))
  })

  it('lets a candidate retry after a denial or an unavailable service', () => {
    expect(nextState('PERMISSION_DENIED', 'START_REQUESTED')).toBe('AWAITING_PERMISSION')
    expect(nextState('PROCTORING_UNAVAILABLE', 'START_REQUESTED')).toBe('AWAITING_PERMISSION')
  })

  it('ignores events that do not apply, so nothing reanimates COMPLETED', () => {
    expect(nextState('COMPLETED', 'SESSION_STARTED')).toBe('COMPLETED')
    expect(nextState('COMPLETED', 'SESSION_RESUMED')).toBe('COMPLETED')
    expect(nextState('AWAITING_PERMISSION', 'SESSION_STARTED')).toBe('AWAITING_PERMISSION')
  })
})
```

- [ ] **Step 3: `media-support.ts` no longer needs a recorder**

```ts
/**
 * Browser capability check. Live monitoring needs a camera + microphone and
 * screen capture - nothing else. There is no recorder, so no recording format.
 */
export interface SupportReport {
  supported: boolean
  missing: string[]
}

export function checkBrowserSupport(): SupportReport {
  const missing: string[] = []
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    missing.push('MediaDevices')
  } else {
    if (typeof navigator.mediaDevices.getUserMedia !== 'function') missing.push('getUserMedia')
    if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') missing.push('getDisplayMedia')
  }
  return { supported: missing.length === 0, missing }
}
```

Replace `tests/proctoring-media-support.test.ts` with:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { checkBrowserSupport } from '@/lib/proctoring/client/media-support'

function install(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value })
}

afterEach(() => install(undefined))

describe('checkBrowserSupport', () => {
  it('is supported with camera and screen capture, and needs no recorder', () => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder
    install({ getUserMedia: () => undefined, getDisplayMedia: () => undefined })
    expect(checkBrowserSupport()).toEqual({ supported: true, missing: [] })
  })

  it('names screen capture specifically when only that is missing', () => {
    install({ getUserMedia: () => undefined })
    expect(checkBrowserSupport()).toEqual({ supported: false, missing: ['getDisplayMedia'] })
  })

  it('reports every missing capability', () => {
    install({})
    expect(checkBrowserSupport().missing).toEqual(['getUserMedia', 'getDisplayMedia'])
  })

  it('reports MediaDevices itself when absent', () => {
    install(undefined)
    expect(checkBrowserSupport().missing).toEqual(['MediaDevices'])
  })
})
```

- [ ] **Step 4: Replace `src/lib/proctoring/client/proctoring-api.ts`**

```ts
import type { AttemptKind } from '../types'
import type { DeviceHealth } from './integrity-monitor'
import type { WireEvent } from './event-queue'

/**
 * Typed wrappers over the student proctoring endpoints - the only module that
 * knows these URLs. Every method returns a discriminated result rather than
 * throwing: proctoring failures are degraded around, never allowed to crash a
 * live assessment. Nothing here ever carries media.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string }

export interface AttemptRef {
  attemptId: string
  kind: AttemptKind
  parentId: string
}

/** Operational only. Detection thresholds are never sent by the server. */
export interface SessionConfig {
  heartbeatIntervalMs: number
  screenRequired: boolean
}

export interface StartedSession {
  sessionId: string
  status: string
  version: string
  retentionExpiresAt: string
  resumed: boolean
  config: SessionConfig
}

export type GazeMonitorHealth = 'STARTING' | 'CALIBRATING' | 'RUNNING' | 'UNAVAILABLE' | 'STOPPED'

export interface HeartbeatReport {
  sessionId: string
  clientState: string
  camera: DeviceHealth
  microphone: DeviceHealth
  screen: DeviceHealth
  gazeMonitor: GazeMonitorHealth
  clientTimestamp: string
  droppedEvents?: number
}

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        // errorResponse never puts internal detail in `error`, so this is safe to show.
        error: (body && typeof body.error === 'string' && body.error) || `Request failed (${res.status})`,
        code: body && typeof body.code === 'string' ? body.code : body && typeof body.error === 'string' ? body.error : undefined,
      }
    }
    return { ok: true, data: body as T }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' }
  }
}

const post = <T>(url: string, body: unknown, extra: RequestInit = {}) =>
  request<T>(url, { method: 'POST', body: JSON.stringify(body), ...extra })

export const proctoringApi = {
  startSession(ref: AttemptRef): Promise<ApiResult<StartedSession>> {
    return post<StartedSession>('/api/student/proctoring/session', ref)
  },

  getSession(ref: AttemptRef): Promise<ApiResult<{
    proctoringEnabled: boolean
    session: { sessionId: string; status: string; startedAt: string | null } | null
  }>> {
    const q = new URLSearchParams({ attemptId: ref.attemptId, kind: ref.kind, parentId: ref.parentId })
    return request(`/api/student/proctoring/session?${q.toString()}`)
  },

  heartbeat(ref: AttemptRef, report: HeartbeatReport): Promise<ApiResult<{
    ok: boolean
    session: { sessionId: string; status: string } | null
  }>> {
    return post('/api/student/proctoring/heartbeat', { ...ref, ...report })
  },

  finalize(ref: AttemptRef): Promise<ApiResult<{ ok: boolean; alreadyFinalized: boolean }>> {
    return post('/api/student/proctoring/finalize', ref)
  },

  /** `keepalive` lets the pagehide flush outlive the page. */
  sendEvents(ref: AttemptRef, sessionId: string, events: WireEvent[], opts: { keepalive?: boolean } = {}): Promise<ApiResult<{
    accepted: number
    duplicates: number
    capped: boolean
  }>> {
    return post('/api/student/proctoring/events', { ...ref, sessionId, events }, { keepalive: !!opts.keepalive })
  },
}
```

(The `code` fallback exists because `errorResponse` puts reason codes such as `PROCTORING_SESSION_CLOSED` in `error`. The recovery screen keys on it.)

- [ ] **Step 5: Create `src/lib/proctoring/client/diagnostics.ts` and its test**

```ts
import type { PipelineOutput, PipelinePhase } from './detection-pipeline'
import type { Baseline, FusedObservation } from './gaze-classify'
import type { TemporalState } from './gaze-state'

/**
 * Development-only diagnostics.
 *
 * Next inlines both variables at build time, so in any production build this
 * is the literal `false`: the hook never computes a snapshot and the panel
 * renders nothing. Enable locally with NEXT_PUBLIC_PROCTORING_DIAGNOSTICS=true
 * in .env.local while running `npm run dev`.
 */
export const DIAGNOSTICS_ENABLED =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_PROCTORING_DIAGNOSTICS === 'true'

export interface DiagnosticsSnapshot {
  faceCount: number
  yaw: number | null
  pitch: number | null
  roll: number | null
  irisX: number | null
  irisY: number | null
  quality: number
  faceWidth: number | null
  baseline: Baseline | null
  deviation: FusedObservation['deviation']
  direction: string
  confidence: number
  agreement: string
  phase: PipelinePhase
  temporalState: TemporalState
  condition: string | null
}

/** "LEFT + DOWN" for a diagonal, so a tester can check both axes at once. */
export function directionLabel(o: FusedObservation): string {
  if (o.direction === 'UNCERTAIN') return 'UNKNOWN'
  if ((o.direction === 'DOWN' || o.direction === 'LEFT' || o.direction === 'RIGHT' || o.direction === 'UP') &&
      o.horizontal && o.vertical) {
    return `${o.horizontal} + ${o.vertical}`
  }
  return o.direction
}

export function toDiagnosticsSnapshot(out: PipelineOutput): DiagnosticsSnapshot {
  const s = out.signals
  return {
    faceCount: s.faceCount,
    yaw: s.yaw, pitch: s.pitch, roll: s.roll,
    irisX: s.irisX, irisY: s.irisY,
    quality: s.quality, faceWidth: s.faceWidth,
    baseline: out.baseline,
    deviation: out.observation.deviation,
    direction: directionLabel(out.observation),
    confidence: out.observation.confidence,
    agreement: out.observation.agreement,
    phase: out.phase,
    temporalState: out.temporal.state,
    condition: out.temporal.condition,
  }
}
```

`tests/proctoring-diagnostics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DIAGNOSTICS_ENABLED, directionLabel } from '@/lib/proctoring/client/diagnostics'
import type { FusedObservation } from '@/lib/proctoring/client/gaze-classify'

const o = (p: Partial<FusedObservation>): FusedObservation => ({
  direction: 'CENTER', horizontal: null, vertical: null, confidence: 1, agreement: 'NONE',
  deviation: { yaw: null, pitch: null, irisX: null, irisY: null }, ...p,
})

describe('diagnostics', () => {
  it('is off outside development', () => {
    expect(DIAGNOSTICS_ENABLED).toBe(false)
  })

  it('labels diagonals with both axes, and uncertainty as UNKNOWN', () => {
    expect(directionLabel(o({ direction: 'DOWN', horizontal: 'LEFT', vertical: 'DOWN' }))).toBe('LEFT + DOWN')
    expect(directionLabel(o({ direction: 'DOWN', horizontal: 'RIGHT', vertical: 'DOWN' }))).toBe('RIGHT + DOWN')
    expect(directionLabel(o({ direction: 'LEFT', horizontal: 'LEFT' }))).toBe('LEFT')
    expect(directionLabel(o({ direction: 'UNCERTAIN' }))).toBe('UNKNOWN')
  })
})
```

- [ ] **Step 6: Replace `src/lib/proctoring/client/use-proctoring.ts`**

```ts
'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AttemptKind, ProctoringClientState } from '../types'
import { severityFor, type ClientEventType } from '../event-types'
import { checkBrowserSupport, type SupportReport } from './media-support'
import { nextState, type ProctoringEventName } from './state-machine'
import { proctoringApi, type AttemptRef, type GazeMonitorHealth } from './proctoring-api'
import { GazeMonitor } from './gaze-monitor'
import type { DetectionEvent, PipelineOutput } from './detection-pipeline'
import { IntegrityMonitor, type DeviceHealth, type DeviceKind, type IntegrityEvent } from './integrity-monitor'
import { EventQueue, type WireEvent } from './event-queue'
import { INTEGRITY_COPY, WARNING_COPY, WarningGate, type WarningKind } from './warning-copy'
import { DIAGNOSTICS_ENABLED, toDiagnosticsSnapshot, type DiagnosticsSnapshot } from './diagnostics'

/**
 * The single integration point between live proctoring and React, called
 * from both candidate pages. Every decision - what starts monitoring, what
 * tears it down, when recovery is needed - lives here, never in a page.
 *
 * Metadata only. The camera and microphone stream feeds an off-DOM video
 * element that MediaPipe reads in this tab. The screen stream is held only so
 * its end can be detected. No frame, sample or snapshot is ever encoded,
 * stored or sent: the only network traffic is session, heartbeat and event
 * JSON.
 *
 * Long-lived handles live in refs, and every callback that fires from a
 * timer, a track or MediaPipe reads refs rather than render-time values, so
 * there are no stale closures and no capture restarts on re-render.
 */

export type DeviceState = 'IDLE' | 'CHECKING' | 'READY' | 'DENIED' | 'FAILED' | 'NOT_REQUIRED'

export interface DeviceStatus {
  state: DeviceState
  /** Candidate-facing, already phrased for display. Never an internal error. */
  message?: string
}

export interface UseProctoringOptions {
  enabled: boolean
  attemptId: string | null
  kind: AttemptKind
  parentId: string
  /** Current question id, for correlation. Validated server-side. */
  currentQuestionId: string | null
  /** True once the server says this attempt is already started. */
  alreadyStarted: boolean
}

export type GazeHealth = 'IDLE' | 'LOADING' | 'CALIBRATING' | 'RUNNING' | 'UNAVAILABLE'

export interface ProctoringHealth {
  camera: DeviceHealth
  microphone: DeviceHealth
  screen: DeviceHealth
  gaze: GazeHealth
  connection: 'OK' | 'LOST'
}

export interface CaptureState {
  screenSharing: boolean
  cameraLive: boolean
  micLive: boolean
}

export interface UseProctoringResult {
  state: ProctoringClientState
  support: SupportReport
  devices: { camera: DeviceStatus; microphone: DeviceStatus; screen: DeviceStatus }
  warning: { message: string; kind: WarningKind } | null
  /** What is actually true right now. The UI reads this, never the state name. */
  health: ProctoringHealth
  capture: CaptureState
  startError: { message: string; code?: string } | null
  needsRecovery: boolean
  /** Dev-only; always null in production builds. */
  diagnostics: DiagnosticsSnapshot | null
  requestPermissionsAndStart: () => Promise<boolean>
  resumeScreenShare: () => Promise<boolean>
  resumeCamera: () => Promise<boolean>
  resumeSession: () => Promise<boolean>
  finalize: () => Promise<void>
  videoRef: React.RefObject<HTMLVideoElement>
}

const EVENT_FLUSH_INTERVAL_MS = 5000
const WARNING_VISIBLE_MS = 4000
/** Monitoring must never cost a candidate their answers: the final flush is abandoned after this. */
const FINALIZE_FLUSH_TIMEOUT_MS = 5000
const HEARTBEAT_FAILURES_BEFORE_LOST = 2
const DIAGNOSTICS_MIN_INTERVAL_MS = 250
const MAX_EVENT_DURATION_MS = 14_400_000

const IDLE_DEVICE: DeviceStatus = { state: 'IDLE' }
const INITIAL_HEALTH: ProctoringHealth = {
  camera: 'UNAVAILABLE', microphone: 'UNAVAILABLE', screen: 'UNAVAILABLE', gaze: 'IDLE', connection: 'OK',
}

function newEventId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      // Fall through to the manual id.
    }
  }
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** A performance.now() instant as a wall-clock ISO string. */
function wallClock(perfMs: number): string {
  return new Date(Date.now() - (performance.now() - perfMs)).toISOString()
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => {
    try {
      track.stop()
    } catch {
      // An already-ended track throws on some engines.
    }
  })
}

function displaySurfaceOf(stream: MediaStream): string {
  const track = stream.getVideoTracks()[0]
  if (!track || typeof track.getSettings !== 'function') return 'unknown'
  const surface = (track.getSettings() as { displaySurface?: unknown }).displaySurface
  return typeof surface === 'string' ? surface : 'unknown'
}

function gazeForServer(g: GazeHealth): GazeMonitorHealth {
  switch (g) {
    case 'LOADING': return 'STARTING'
    case 'CALIBRATING': return 'CALIBRATING'
    case 'RUNNING': return 'RUNNING'
    case 'UNAVAILABLE': return 'UNAVAILABLE'
    default: return 'STOPPED'
  }
}

function captureFrom(h: ProctoringHealth): CaptureState {
  return {
    cameraLive: h.camera === 'ACTIVE' || h.camera === 'MUTED',
    micLive: h.microphone === 'ACTIVE' || h.microphone === 'MUTED',
    screenSharing: h.screen === 'ACTIVE',
  }
}

/** Race a promise against a timer, and clear the timer either way. */
function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    const done = () => { clearTimeout(timer); resolve() }
    p.then(done, done)
  })
}

export function useProctoring(opts: UseProctoringOptions): UseProctoringResult {
  const { enabled, attemptId, kind, parentId, currentQuestionId, alreadyStarted } = opts

  const [state, setState] = useState<ProctoringClientState>('IDLE')
  const [support, setSupport] = useState<SupportReport>({ supported: true, missing: [] })
  const [camera, setCamera] = useState<DeviceStatus>(IDLE_DEVICE)
  const [microphone, setMicrophone] = useState<DeviceStatus>(IDLE_DEVICE)
  const [screen, setScreen] = useState<DeviceStatus>(IDLE_DEVICE)
  const [warning, setWarning] = useState<{ message: string; kind: WarningKind } | null>(null)
  const [health, setHealth] = useState<ProctoringHealth>(INITIAL_HEALTH)
  const [startError, setStartError] = useState<{ message: string; code?: string } | null>(null)
  /** Whether this page instance brought monitoring up. Recovery keys on it. */
  const [captureLive, setCaptureLive] = useState(false)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null)

  const stateRef = useRef<ProctoringClientState>('IDLE')
  const healthRef = useRef<ProctoringHealth>(INITIAL_HEALTH)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const gazeRef = useRef<GazeMonitor | null>(null)
  /** Bumped on every start/stop, so a model that finishes loading late is discarded. */
  const gazeGenerationRef = useRef(0)
  const integrityRef = useRef<IntegrityMonitor | null>(null)
  const queueRef = useRef<EventQueue | null>(null)
  const gateRef = useRef(new WarningGate())
  const sessionIdRef = useRef<string | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const eventTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatFailuresRef = useRef(0)
  const lastDiagnosticsAtRef = useRef(0)
  const startedAtRef = useRef(0)
  const startingRef = useRef(false)
  const finalizedRef = useRef(false)
  /** The monitor's own video element, deliberately off-DOM. */
  const inferenceVideoRef = useRef<HTMLVideoElement | null>(null)
  /** The visible self-view. Never what inference reads from. */
  const videoRef = useRef<HTMLVideoElement>(null)
  const teardownRef = useRef<(() => void) | null>(null)
  const questionIdRef = useRef<string | null>(currentQuestionId)
  questionIdRef.current = currentQuestionId

  const attemptRef = useMemo<AttemptRef | null>(
    () => (attemptId ? { attemptId, kind, parentId } : null),
    [attemptId, kind, parentId]
  )
  const attemptRefRef = useRef<AttemptRef | null>(attemptRef)
  attemptRefRef.current = attemptRef

  /** Against the ref, so the ref and the rendered state never disagree. */
  const dispatch = useCallback((event: ProctoringEventName) => {
    const next = nextState(stateRef.current, event)
    stateRef.current = next
    setState(next)
  }, [])

  const patchHealth = useCallback((patch: Partial<ProctoringHealth>) => {
    const merged = { ...healthRef.current, ...patch }
    healthRef.current = merged
    setHealth(merged)
  }, [])

  const enqueue = useCallback((
    type: ClientEventType,
    extra: {
      startedAtPerf?: number
      endedAtPerf?: number
      durationMs?: number
      confidence?: number
      direction?: WireEvent['direction']
      metadata?: WireEvent['metadata']
    } = {}
  ) => {
    const queue = queueRef.current
    if (!queue) return
    const startPerf = extra.startedAtPerf ?? performance.now()
    const questionId = questionIdRef.current
    queue.push({
      clientEventId: newEventId(),
      type,
      startedAt: wallClock(startPerf),
      endedAt: extra.endedAtPerf !== undefined ? wallClock(extra.endedAtPerf) : undefined,
      durationMs: extra.durationMs !== undefined
        ? Math.min(MAX_EVENT_DURATION_MS, Math.max(0, Math.round(extra.durationMs)))
        : undefined,
      confidence: extra.confidence,
      direction: extra.direction,
      severity: severityFor(type),
      elapsedMs: startedAtRef.current ? Math.max(0, Math.round(startPerf - startedAtRef.current)) : undefined,
      questionId: questionId ?? undefined,
      metadata: extra.metadata,
    })
  }, [])

  const showWarning = useCallback((kind: WarningKind) => {
    if (!gateRef.current.allow(kind, performance.now())) return
    setWarning({ message: WARNING_COPY[kind], kind })
    if (warningTimerRef.current !== null) clearTimeout(warningTimerRef.current)
    warningTimerRef.current = setTimeout(() => {
      warningTimerRef.current = null
      setWarning(null)
    }, WARNING_VISIBLE_MS)
  }, [])

  const handleDetectionEvent = useCallback((e: DetectionEvent) => {
    enqueue(e.type, {
      startedAtPerf: e.startedAtMs,
      endedAtPerf: e.endedAtMs,
      durationMs: e.durationMs,
      confidence: e.confidence,
      direction: e.direction,
      metadata: e.metadata,
    })
  }, [enqueue])

  const handleOutput = useCallback((out: PipelineOutput) => {
    out.events.forEach(handleDetectionEvent)
    out.warnings.forEach(showWarning)
    const g: GazeHealth = out.phase === 'CALIBRATING' ? 'CALIBRATING' : 'RUNNING'
    if (healthRef.current.gaze !== g) patchHealth({ gaze: g })
    if (DIAGNOSTICS_ENABLED) {
      const now = performance.now()
      if (now - lastDiagnosticsAtRef.current >= DIAGNOSTICS_MIN_INTERVAL_MS) {
        lastDiagnosticsAtRef.current = now
        setDiagnostics(toDiagnosticsSnapshot(out))
      }
    }
  }, [handleDetectionEvent, patchHealth, showWarning])

  /** Stop inference. `flush` keeps the episode in progress (finalize, camera loss). */
  const stopGaze = useCallback((flush: boolean) => {
    gazeGenerationRef.current++
    const monitor = gazeRef.current
    gazeRef.current = null
    if (!monitor) return
    if (flush) {
      try {
        monitor.flush().forEach(handleDetectionEvent)
      } catch {
        // Nothing in progress to keep.
      }
    }
    try {
      monitor.stop()
    } catch {
      // A monitor that never finished loading has nothing to stop.
    }
  }, [handleDetectionEvent])

  const startGaze = useCallback(async (stream: MediaStream) => {
    stopGaze(false)
    const generation = ++gazeGenerationRef.current
    patchHealth({ gaze: 'LOADING' })
    try {
      let inference = inferenceVideoRef.current
      if (!inference) {
        inference = document.createElement('video')
        inference.muted = true
        inference.playsInline = true
        inferenceVideoRef.current = inference
      }
      inference.srcObject = stream
      await inference.play().catch(() => undefined)
      const monitor = await GazeMonitor.create({ onOutput: handleOutput })
      // Superseded while the model loaded (camera reconnected, or torn down):
      // discard, so there is never more than one MediaPipe instance.
      if (generation !== gazeGenerationRef.current) {
        monitor.stop()
        return
      }
      gazeRef.current = monitor
      monitor.start(inference)
    } catch {
      if (generation !== gazeGenerationRef.current) return
      // Gaze analysis is the one part that may be absent. It is reported,
      // never hidden: the heartbeat says UNAVAILABLE and a reviewer sees it.
      patchHealth({ gaze: 'UNAVAILABLE' })
      enqueue('GAZE_MONITOR_UNAVAILABLE')
    }
  }, [enqueue, handleOutput, patchHealth, stopGaze])

  const handleIntegrityEvent = useCallback((e: IntegrityEvent) => {
    enqueue(e.type, { startedAtPerf: e.atMs, durationMs: e.durationMs, metadata: e.metadata })
  }, [enqueue])

  const handleHealthChange = useCallback((next: Record<DeviceKind, DeviceHealth>) => {
    const prev = healthRef.current
    patchHealth({ camera: next.camera, microphone: next.microphone, screen: next.screen })
    if (finalizedRef.current) return
    if (next.camera === 'ENDED' && prev.camera !== 'ENDED') {
      setCamera({ state: 'FAILED', message: INTEGRITY_COPY.CAMERA_INTERRUPTED })
      dispatch('CAMERA_ENDED')
      // A frozen last frame would keep reading as "face present". Stop
      // inference rather than trust it.
      stopGaze(true)
      patchHealth({ gaze: 'IDLE' })
    }
    if (next.microphone === 'ENDED' && prev.microphone !== 'ENDED') {
      setMicrophone({ state: 'FAILED', message: INTEGRITY_COPY.MICROPHONE_INTERRUPTED })
      dispatch('MICROPHONE_ENDED')
    }
    if (next.screen === 'ENDED' && prev.screen !== 'ENDED') {
      setScreen({ state: 'DENIED', message: INTEGRITY_COPY.SCREEN_SHARE_STOPPED })
      dispatch('SCREEN_SHARE_ENDED')
    }
    if (next.screen === 'ACTIVE' && prev.screen === 'ENDED') setScreen({ state: 'READY' })
  }, [dispatch, patchHealth, stopGaze])

  const clearTimers = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
    if (eventTimerRef.current !== null) {
      clearInterval(eventTimerRef.current)
      eventTimerRef.current = null
    }
  }, [])

  /** Stop everything. Safe to call more than once, and from an unmount. */
  const teardown = useCallback(() => {
    clearTimers()
    if (warningTimerRef.current !== null) {
      clearTimeout(warningTimerRef.current)
      warningTimerRef.current = null
    }
    stopGaze(false)
    integrityRef.current?.detach()
    integrityRef.current = null
    queueRef.current?.close()
    queueRef.current = null
    // A camera left live after the candidate leaves is the most visible way
    // to lose their trust.
    stopStream(cameraStreamRef.current)
    stopStream(screenStreamRef.current)
    cameraStreamRef.current = null
    screenStreamRef.current = null
    const preview = videoRef.current
    if (preview) preview.srcObject = null
    const inference = inferenceVideoRef.current
    if (inference) inference.srcObject = null
    inferenceVideoRef.current = null
    sessionIdRef.current = null
    gateRef.current.reset()
    heartbeatFailuresRef.current = 0
    healthRef.current = INITIAL_HEALTH
    setHealth(INITIAL_HEALTH)
    setWarning(null)
    setDiagnostics(null)
  }, [clearTimers, stopGaze])

  teardownRef.current = teardown

  useEffect(() => {
    return () => {
      teardownRef.current?.()
    }
  }, [])

  /**
   * Keep the visible self-view bound to the camera stream. No dependency
   * array on purpose: the page swaps the preview element between pre-check
   * and exam, and a one-shot attach leaves the exam's preview blank.
   */
  useEffect(() => {
    const el = videoRef.current
    const stream = cameraStreamRef.current
    if (!el || !stream) return
    if (el.srcObject !== stream) {
      el.srcObject = stream
      el.muted = true
      void el.play().catch(() => undefined)
    }
  })

  // Capability check only - no prompt, no network - so it is safe before a gesture.
  useEffect(() => {
    if (!enabled) return
    const report = checkBrowserSupport()
    setSupport(report)
    if (!report.supported) {
      dispatch('UNSUPPORTED')
      setCamera({ state: 'FAILED', message: 'This browser cannot be used for a proctored assessment.' })
      setMicrophone({ state: 'FAILED' })
      setScreen({ state: 'FAILED' })
      return
    }
    dispatch('CHECK_DEVICES')
    dispatch('DEVICES_OK')
  }, [enabled, dispatch])

  const sendBatch = useCallback(async (batch: WireEvent[], o: { keepalive: boolean }): Promise<boolean> => {
    const ref = attemptRefRef.current
    const sessionId = sessionIdRef.current
    if (!ref || !sessionId) return false
    const res = await proctoringApi.sendEvents(ref, sessionId, batch, o)
    if (res.ok) return true
    // A 4xx other than 429 is a permanent refusal. Resending it would loop,
    // so the batch is let go.
    return res.status >= 400 && res.status < 500 && res.status !== 429
  }, [])

  const sendHeartbeat = useCallback(async () => {
    const ref = attemptRefRef.current
    const sessionId = sessionIdRef.current
    if (!ref || !sessionId || finalizedRef.current) return
    const h = healthRef.current
    const res = await proctoringApi.heartbeat(ref, {
      sessionId,
      clientState: stateRef.current,
      camera: h.camera,
      microphone: h.microphone,
      screen: h.screen,
      gazeMonitor: gazeForServer(h.gaze),
      clientTimestamp: new Date().toISOString(),
      droppedEvents: queueRef.current ? queueRef.current.dropped : 0,
    })
    if (finalizedRef.current) return
    if (!res.ok) {
      if (res.status === 404 || res.status === 409) {
        dispatch('SESSION_LOST')
        return
      }
      heartbeatFailuresRef.current++
      if (heartbeatFailuresRef.current >= HEARTBEAT_FAILURES_BEFORE_LOST && healthRef.current.connection !== 'LOST') {
        patchHealth({ connection: 'LOST' })
        dispatch('OFFLINE')
      }
      return
    }
    heartbeatFailuresRef.current = 0
    if (healthRef.current.connection === 'LOST') {
      patchHealth({ connection: 'OK' })
      dispatch('ONLINE')
    }
    if (res.data.session === null) dispatch('SESSION_LOST')
  }, [dispatch, patchHealth])

  const startTimers = useCallback((heartbeatIntervalMs: number) => {
    clearTimers()
    heartbeatTimerRef.current = setInterval(() => { void sendHeartbeat() }, heartbeatIntervalMs)
    eventTimerRef.current = setInterval(() => { void queueRef.current?.flush() }, EVENT_FLUSH_INTERVAL_MS)
  }, [clearTimers, sendHeartbeat])

  const watchCameraTracks = useCallback((integrity: IntegrityMonitor, stream: MediaStream) => {
    integrity.watchTrack('camera', stream.getVideoTracks()[0])
    integrity.watchTrack('microphone', stream.getAudioTracks()[0])
  }, [])

  const acquireScreen = useCallback(async (): Promise<MediaStream | null> => {
    setScreen({ state: 'CHECKING' })
    try {
      // No audio: nothing of the screen is captured, only whether it is shared.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      setScreen({ state: 'READY' })
      return stream
    } catch (err) {
      const name = (err as { name?: string }).name
      setScreen({
        state: name === 'NotAllowedError' ? 'DENIED' : 'FAILED',
        message: name === 'NotAllowedError'
          ? 'Screen sharing was not allowed. A proctored assessment cannot begin without it.'
          : 'Screen sharing could not be started. Please try again.',
      })
      return null
    }
  }, [])

  const requestPermissionsAndStart = useCallback(async (): Promise<boolean> => {
    if (!enabled || startingRef.current) return false
    const ref = attemptRefRef.current
    if (!ref) {
      setStartError({ message: 'This assessment is not ready yet. Please reload the page.' })
      return false
    }
    if (!support.supported) {
      dispatch('UNSUPPORTED')
      return false
    }

    startingRef.current = true
    setStartError(null)
    dispatch('START_REQUESTED')

    try {
      // Screen first: getDisplayMedia needs transient user activation, which
      // a first-time camera prompt can outlast.
      const screenStream = await acquireScreen()
      if (!screenStream) {
        dispatch('PERMISSIONS_DENIED')
        return false
      }

      setCamera({ state: 'CHECKING' })
      setMicrophone({ state: 'CHECKING' })
      let cameraStream: MediaStream
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch (err) {
        const name = (err as { name?: string }).name
        const denied = name === 'NotAllowedError' || name === 'SecurityError'
        const missing = name === 'NotFoundError' || name === 'DevicesNotFoundError'
        const message = denied
          ? 'Camera and microphone access was denied. A proctored assessment cannot begin without both.'
          : missing
            ? 'No camera or microphone was found. Please connect one and try again.'
            : 'The camera and microphone could not be started. Please close other apps using them and try again.'
        setCamera({ state: denied ? 'DENIED' : 'FAILED', message })
        setMicrophone({ state: denied ? 'DENIED' : 'FAILED', message })
        stopStream(screenStream)
        setScreen(IDLE_DEVICE)
        dispatch('PERMISSIONS_DENIED')
        return false
      }

      const hasVideo = cameraStream.getVideoTracks().length > 0
      const hasAudio = cameraStream.getAudioTracks().length > 0
      setCamera(hasVideo ? { state: 'READY' } : { state: 'FAILED', message: 'No camera track was produced. Please check your camera.' })
      setMicrophone(hasAudio ? { state: 'READY' } : { state: 'FAILED', message: 'No microphone track was produced. Please check your microphone.' })
      if (!hasVideo || !hasAudio) {
        // Setup cancelled: nothing may stay live.
        stopStream(cameraStream)
        stopStream(screenStream)
        dispatch('PERMISSIONS_DENIED')
        return false
      }
      cameraStreamRef.current = cameraStream
      screenStreamRef.current = screenStream
      dispatch('PERMISSIONS_GRANTED')

      // Only now is a session created, so a denial never leaves one behind
      // for /start to accept.
      const started = await proctoringApi.startSession(ref)
      if (!started.ok) {
        if (started.status === 503) {
          dispatch('PROCTORING_UNAVAILABLE')
          setStartError({ message: 'Proctored assessment is temporarily unavailable. Please try again later.', code: started.code })
        } else {
          setStartError({ message: started.error, code: started.code })
          dispatch('PERMISSIONS_DENIED')
        }
        teardown()
        return false
      }

      sessionIdRef.current = started.data.sessionId
      startedAtRef.current = performance.now()
      finalizedRef.current = false
      heartbeatFailuresRef.current = 0
      gateRef.current.reset()
      queueRef.current = new EventQueue({ send: sendBatch })

      const integrity = new IntegrityMonitor({
        onEvent: handleIntegrityEvent,
        onHealthChange: handleHealthChange,
        onPageHide: () => { void queueRef.current?.flush({ keepalive: true }) },
      })
      integrityRef.current = integrity
      // Watch before anything else runs, so a device yanked during startup is
      // still reported.
      watchCameraTracks(integrity, cameraStream)
      integrity.watchTrack('screen', screenStream.getVideoTracks()[0])
      integrity.attachPage()
      patchHealth({ connection: 'OK' })

      enqueue('PROCTORING_STARTED', { metadata: { resumed: started.data.resumed } })
      enqueue('SCREEN_SHARE_STARTED', { metadata: { displaySurface: displaySurfaceOf(screenStream) } })

      // Not awaited: the model loads in the background while the exam opens.
      // Health reads LOADING until it runs.
      void startGaze(cameraStream)

      dispatch('SESSION_STARTED')
      setCaptureLive(true)
      startTimers(started.data.config.heartbeatIntervalMs)
      void sendHeartbeat()
      return true
    } catch {
      setStartError({ message: 'Proctoring could not be started. Please try again.' })
      dispatch('PERMISSIONS_DENIED')
      teardown()
      return false
    } finally {
      startingRef.current = false
    }
  }, [
    acquireScreen, dispatch, enabled, enqueue, handleHealthChange, handleIntegrityEvent, patchHealth,
    sendBatch, sendHeartbeat, startGaze, startTimers, support.supported, teardown, watchCameraTracks,
  ])

  /** From the candidate's click on the resume button: needs the gesture. */
  const resumeScreenShare = useCallback(async (): Promise<boolean> => {
    const integrity = integrityRef.current
    if (!sessionIdRef.current || !integrity) return false
    const stream = await acquireScreen()
    if (!stream) return false
    stopStream(screenStreamRef.current)
    screenStreamRef.current = stream
    integrity.watchTrack('screen', stream.getVideoTracks()[0])
    enqueue('SCREEN_SHARE_RESUMED', { metadata: { displaySurface: displaySurfaceOf(stream) } })
    dispatch('SCREEN_SHARE_RESUMED')
    return true
  }, [acquireScreen, dispatch, enqueue])

  const resumeCamera = useCallback(async (): Promise<boolean> => {
    const integrity = integrityRef.current
    if (!sessionIdRef.current || !integrity) return false
    const before = healthRef.current
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch {
      setCamera({ state: 'FAILED', message: 'The camera could not be restarted. Please check it is connected and not in use by another app.' })
      return false
    }
    if (stream.getVideoTracks().length === 0 || stream.getAudioTracks().length === 0) {
      stopStream(stream)
      return false
    }
    stopStream(cameraStreamRef.current)
    cameraStreamRef.current = stream
    watchCameraTracks(integrity, stream)
    if (before.camera !== 'ACTIVE') enqueue('CAMERA_RESTORED', { metadata: { reason: 'reconnected' } })
    if (before.microphone !== 'ACTIVE') enqueue('MICROPHONE_RESTORED', { metadata: { reason: 'reconnected' } })
    setCamera({ state: 'READY' })
    setMicrophone({ state: 'READY' })
    dispatch('DEVICES_RECOVERED')
    void startGaze(stream)
    return true
  }, [dispatch, enqueue, startGaze, watchCameraTracks])

  /** The server closed the session (stale heartbeat). Reopen it - it resumes in place. */
  const resumeSession = useCallback(async (): Promise<boolean> => {
    const ref = attemptRefRef.current
    if (!ref || finalizedRef.current) return false
    const started = await proctoringApi.startSession(ref)
    if (!started.ok) {
      setStartError({ message: started.error, code: started.code })
      return false
    }
    sessionIdRef.current = started.data.sessionId
    setStartError(null)
    dispatch('SESSION_RESUMED')
    void sendHeartbeat()
    return true
  }, [dispatch, sendHeartbeat])

  const finalize = useCallback(async (): Promise<void> => {
    if (!enabled || finalizedRef.current) return
    finalizedRef.current = true
    dispatch('FINALIZE')
    clearTimers()
    // Keep the episode in progress: the last look away must not be lost.
    stopGaze(true)
    enqueue('PROCTORING_ENDED')
    const queue = queueRef.current
    if (queue) await withTimeout(queue.flush(), FINALIZE_FLUSH_TIMEOUT_MS)
    const ref = attemptRefRef.current
    if (ref && sessionIdRef.current) {
      // Best effort. The submit route's safety net closes it otherwise.
      await proctoringApi.finalize(ref)
    }
    teardown()
    dispatch('FINALIZED')
    setCaptureLive(false)
  }, [clearTimers, dispatch, enabled, enqueue, stopGaze, teardown])

  // Back online: report and flush at once rather than waiting for the timers.
  useEffect(() => {
    if (!enabled || !captureLive) return
    const onOnline = () => {
      void sendHeartbeat()
      void queueRef.current?.flush()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [enabled, captureLive, sendHeartbeat])

  const needsRecovery = enabled && alreadyStarted && !captureLive

  return {
    state,
    support,
    devices: { camera, microphone, screen },
    warning,
    health,
    capture: captureFrom(health),
    startError,
    needsRecovery,
    diagnostics,
    requestPermissionsAndStart,
    resumeScreenShare,
    resumeCamera,
    resumeSession,
    finalize,
    videoRef,
  }
}
```

- [ ] **Step 7: Honest status indicator, and the two pages' top bars**

Replace `src/components/proctoring/ProctoringStatusIndicator.tsx`:

```tsx
'use client'
import { Camera, MonitorUp, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ProctoringHealth } from '@/lib/proctoring/client/use-proctoring'
import type { DeviceHealth } from '@/lib/proctoring/client/integrity-monitor'
import type { ProctoringClientState } from '@/lib/proctoring/types'

/**
 * "Proctoring active" - and only when it is true. Everything shown is read
 * from live device health. Nothing mentions recording or saving, because
 * nothing is recorded or saved. Status is never colour-only: every row pairs
 * a dot with a word.
 */

const HIDDEN: ProctoringClientState[] = [
  'IDLE', 'CHECKING_DEVICES', 'READY', 'AWAITING_PERMISSION', 'PERMISSION_DENIED',
  'UNSUPPORTED_BROWSER', 'PROCTORING_UNAVAILABLE', 'COMPLETED',
]

const LABEL: Record<DeviceHealth, string> = {
  ACTIVE: 'Active',
  MUTED: 'Interrupted',
  ENDED: 'Stopped',
  UNAVAILABLE: 'Unavailable',
}

export function needsAttention(state: ProctoringClientState, h: ProctoringHealth): boolean {
  return (
    h.camera !== 'ACTIVE' || h.microphone !== 'ACTIVE' || h.screen !== 'ACTIVE' ||
    h.connection === 'LOST' || state === 'SESSION_INTERRUPTED'
  )
}

function Dot({ ok }: { ok: boolean }) {
  return <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-amber-500'}`} />
}

function Row({ icon, name, health }: { icon: React.ReactNode; name: string; health: DeviceHealth }) {
  const ok = health === 'ACTIVE'
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="flex items-center gap-1.5 text-gray-600">{icon}{name}</span>
      <span className={`flex items-center gap-1.5 ${ok ? 'text-gray-700' : 'text-amber-700 font-medium'}`}>
        <Dot ok={ok} /> {LABEL[health]}
      </span>
    </div>
  )
}

export default function ProctoringStatusIndicator({
  state,
  health,
  variant = 'chip',
}: {
  state: ProctoringClientState
  health: ProctoringHealth
  variant?: 'chip' | 'panel'
}) {
  if (HIDDEN.indexOf(state) !== -1) return null
  const attention = needsAttention(state, health)
  const headline = attention ? 'Proctoring: attention needed' : 'Proctoring active'

  if (variant === 'chip') {
    return (
      <span
        aria-label="Proctoring status"
        data-testid="proctoring-chip"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${
          attention ? 'bg-amber-500/25 text-amber-100' : 'bg-white/10 text-white/90'
        }`}
      >
        <Dot ok={!attention} /> {headline}
      </span>
    )
  }

  return (
    <div
      aria-label="Proctoring status"
      data-testid="proctoring-panel"
      className="rounded-lg bg-white border border-gray-200 shadow-lg px-3 py-2 text-xs w-full"
    >
      <p className="flex items-center gap-1.5 font-semibold text-gray-800 uppercase tracking-wide mb-1.5">
        {attention ? <ShieldAlert size={13} className="text-amber-600" /> : <ShieldCheck size={13} className="text-green-600" />}
        {headline}
      </p>
      <Row icon={<Camera size={12} />} name="Camera" health={health.camera} />
      <Row icon={<MonitorUp size={12} />} name="Screen Share" health={health.screen} />
    </div>
  )
}
```

In **both** `src/app/student/test/[scheduleId]/page.tsx` and `src/app/student/walkin-test/[testId]/page.tsx`, replace:

```tsx
            <ProctoringStatusIndicator
              state={proctoring.state}
              capture={proctoring.capture}
              uploads={proctoring.uploads}
            />
```

with:

```tsx
            <ProctoringStatusIndicator variant="chip" state={proctoring.state} health={proctoring.health} />
```

In `src/components/proctoring/ProctoringSetup.tsx`, rename `const storageUnavailable = state === 'STORAGE_UNAVAILABLE'` to `const unavailable = state === 'PROCTORING_UNAVAILABLE'`, and update its two uses.

- [ ] **Step 8: Update `tests/proctoring-setup.test.tsx`**

- Replace `SESSION_CONFIG` with `{ heartbeatIntervalMs: 20_000, screenRequired: true }`, and add `resumed: false` to the mocked session body.
- Delete `installMediaRecorder` and both calls to it, and delete the `HTMLCanvasElement.prototype.*` stubs and their comment.
- In `'refuses an unsupported browser and does not offer to start'`, replace `installMediaRecorder(false)` with `installMediaDevices({ getUserMedia: harness.getUserMedia } as unknown as Harness)`, which removes screen capture.
- In the 503 case: rename it to `'shows the calm unavailable message on a 503 and no internal reason'`, use `'PROCTORING_DISABLED'` as the error/code, expect state `'PROCTORING_UNAVAILABLE'`, and expect the body not to contain `'PROCTORING_DISABLED'`.
- Rename the "must not reserve storage" comment to "a denial must not create a session".

- [ ] **Step 9: Rewrite `tests/proctoring-use-proctoring.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'

/**
 * The hook end to end with fake devices and a fake network. MediaPipe is
 * mocked (it never loads under jsdom); the pipeline has its own node tests.
 * The first case protects every existing assessment: off means inert.
 */

type Fn = ReturnType<typeof vi.fn>

// vi.hoisted: the mock factory below is hoisted above every import, so the
// object it closes over must be hoisted too. The fns are assigned in beforeEach.
const gaze = vi.hoisted(() => ({
  onOutput: null as null | ((o: unknown) => void),
  start: null as unknown as Fn,
  stop: null as unknown as Fn,
  flush: null as unknown as Fn,
}))

vi.mock('@/lib/proctoring/client/gaze-monitor', () => ({
  GazeMonitor: {
    create: (opts: { onOutput: (o: unknown) => void }) => {
      gaze.onOutput = opts.onOutput
      return Promise.resolve({ start: gaze.start, stop: gaze.stop, flush: gaze.flush })
    },
  },
}))

import { useProctoring } from '@/lib/proctoring/client/use-proctoring'

const SESSION_URL = '/api/student/proctoring/session'
const EVENTS_URL = '/api/student/proctoring/events'
const HEARTBEAT_URL = '/api/student/proctoring/heartbeat'
const FINALIZE_URL = '/api/student/proctoring/finalize'

interface FakeTrack {
  kind: string
  readyState: string
  muted: boolean
  stop: ReturnType<typeof vi.fn>
  getSettings: () => { displaySurface: string }
  addEventListener: (e: string, cb: () => void) => void
  removeEventListener: (e: string, cb: () => void) => void
  fire: (e: string) => void
}

function fakeTrack(kind: string): FakeTrack {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    kind, readyState: 'live', muted: false, stop: vi.fn(),
    getSettings: () => ({ displaySurface: 'monitor' }),
    addEventListener(e, cb) { listeners[e] = (listeners[e] || []).concat(cb) },
    removeEventListener(e, cb) { listeners[e] = (listeners[e] || []).filter(x => x !== cb) },
    fire(e) { (listeners[e] || []).slice().forEach(cb => cb()) },
  }
}

function fakeStream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
  } as unknown as MediaStream
}

let cameraTracks: FakeTrack[]
let screenTracks: FakeTrack[]
let fetchMock: ReturnType<typeof vi.fn>
let heartbeatReply: () => Promise<Response>

const OPTIONS = {
  enabled: true, attemptId: 'attempt1', kind: 'scheduled' as const,
  parentId: 'sched1', currentQuestionId: 'q1', alreadyStarted: false,
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as { body?: string } | undefined
  return init?.body ? JSON.parse(init.body) : {}
}

const callsTo = (url: string) => fetchMock.mock.calls.filter(c => String(c[0]).indexOf(url) === 0)
const sentTypes = () => callsTo(EVENTS_URL).reduce<string[]>(
  (a, c) => a.concat((bodyOf(c).events as Array<{ type: string }>).map(e => e.type)), []
)

async function started() {
  const hook = renderHook(() => useProctoring(OPTIONS))
  await act(async () => { await hook.result.current.requestPermissionsAndStart() })
  await waitFor(() => expect(hook.result.current.state).toBe('ACTIVE'))
  return hook
}

beforeEach(() => {
  gaze.onOutput = null
  gaze.start = vi.fn()
  gaze.stop = vi.fn()
  gaze.flush = vi.fn(() => [])
  cameraTracks = [fakeTrack('video'), fakeTrack('audio')]
  screenTracks = [fakeTrack('video')]
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => Promise.resolve(fakeStream(cameraTracks))),
      getDisplayMedia: vi.fn(() => Promise.resolve(fakeStream(screenTracks))),
    },
  })
  HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve())
  heartbeatReply = () => json({ ok: true, session: { sessionId: 's1', status: 'ACTIVE' } })
  fetchMock = vi.fn((url: string) => {
    const u = String(url)
    if (u.indexOf(SESSION_URL) === 0) {
      return json({
        sessionId: 's1', status: 'ACTIVE', version: '2', resumed: false,
        retentionExpiresAt: new Date().toISOString(),
        config: { heartbeatIntervalMs: 20_000, screenRequired: true },
      })
    }
    if (u.indexOf(HEARTBEAT_URL) === 0) return heartbeatReply()
    if (u.indexOf(FINALIZE_URL) === 0) return json({ ok: true, alreadyFinalized: false })
    return json({ accepted: 1, duplicates: 0, capped: false })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useProctoring: regression', () => {
  it('does nothing whatsoever when proctoring is disabled', () => {
    const getUserMedia = vi.fn()
    const getDisplayMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, getDisplayMedia } })
    const disabledFetch = vi.fn()
    vi.stubGlobal('fetch', disabledFetch)
    const { result } = renderHook(() => useProctoring({ ...OPTIONS, enabled: false }))
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(disabledFetch).not.toHaveBeenCalled()
    expect(result.current.state).toBe('IDLE')
    expect(result.current.needsRecovery).toBe(false)
  })
})

describe('useProctoring: session', () => {
  it('reports needsRecovery for a proctored attempt that is already started', () => {
    const { result } = renderHook(() => useProctoring({ ...OPTIONS, alreadyStarted: true }))
    expect(result.current.needsRecovery).toBe(true)
  })

  it('clears needsRecovery once monitoring is live, with one session call', async () => {
    const { result } = renderHook(() => useProctoring({ ...OPTIONS, alreadyStarted: true }))
    await act(async () => { await result.current.requestPermissionsAndStart() })
    await waitFor(() => expect(result.current.needsRecovery).toBe(false))
    expect(callsTo(SESSION_URL).length).toBe(1)
  })

  it('reports every device ACTIVE and says so honestly', async () => {
    const { result } = await started()
    expect(result.current.health).toMatchObject({ camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE', connection: 'OK' })
    expect(result.current.capture).toEqual({ cameraLive: true, micLive: true, screenSharing: true })
  })

  it('heartbeats with the session id and device health, and no media fields', async () => {
    await started()
    await waitFor(() => expect(callsTo(HEARTBEAT_URL).length).toBeGreaterThan(0))
    const body = bodyOf(callsTo(HEARTBEAT_URL)[0])
    expect(body).toMatchObject({ sessionId: 's1', camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE', clientState: 'ACTIVE' })
    expect(Object.keys(body).join(',')).not.toMatch(/record|upload|segment|screenshot/i)
  })

  it('never calls anything but the proctoring JSON endpoints - no upload, no storage', async () => {
    const { result } = await started()
    await act(async () => { await result.current.finalize() })
    fetchMock.mock.calls.forEach(c => {
      expect(String(c[0])).toMatch(/^\/api\/student\/proctoring\/(session|heartbeat|events|finalize)/)
      const init = c[1] as { body?: unknown } | undefined
      if (init && init.body !== undefined) expect(typeof init.body).toBe('string')
    })
  })
})

describe('useProctoring: integrity', () => {
  it('camera stopped: CAMERA_INTERRUPTED, camera health ENDED, inference stopped', async () => {
    const { result } = await started()
    await waitFor(() => expect(gaze.onOutput).not.toBeNull())
    act(() => { cameraTracks[0].fire('ended') })
    expect(result.current.health.camera).toBe('ENDED')
    expect(result.current.state).toBe('CAMERA_STOPPED')
    expect(gaze.stop).toHaveBeenCalled()
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('CAMERA_INTERRUPTED')
  })

  it('camera reconnect: new stream, CAMERA_RESTORED, back to ACTIVE', async () => {
    const { result } = await started()
    act(() => { cameraTracks[0].fire('ended') })
    cameraTracks = [fakeTrack('video'), fakeTrack('audio')]
    await act(async () => { await result.current.resumeCamera() })
    expect(result.current.health.camera).toBe('ACTIVE')
    expect(result.current.state).toBe('ACTIVE')
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('CAMERA_RESTORED')
  })

  it('microphone stopped: MICROPHONE_INTERRUPTED', async () => {
    const { result } = await started()
    act(() => { cameraTracks[1].fire('ended') })
    expect(result.current.health.microphone).toBe('ENDED')
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('MICROPHONE_INTERRUPTED')
  })

  it('screen sharing stopped: SCREEN_SHARE_INTERRUPTED and a stopped state', async () => {
    const { result } = await started()
    act(() => { screenTracks[0].fire('ended') })
    expect(result.current.health.screen).toBe('ENDED')
    expect(result.current.capture.screenSharing).toBe(false)
    expect(result.current.state).toBe('SCREEN_SHARE_STOPPED')
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('SCREEN_SHARE_INTERRUPTED')
  })

  it('screen sharing resumed from a gesture: SCREEN_SHARE_RESUMED and ACTIVE', async () => {
    const { result } = await started()
    act(() => { screenTracks[0].fire('ended') })
    screenTracks = [fakeTrack('video')]
    await act(async () => { await result.current.resumeScreenShare() })
    expect(result.current.health.screen).toBe('ACTIVE')
    expect(result.current.state).toBe('ACTIVE')
    expect((navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('SCREEN_SHARE_RESUMED')
  })

  it('tab hidden and visible are both logged', async () => {
    const { result } = await started()
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => { await result.current.finalize() })
    const types = sentTypes()
    expect(types).toContain('TAB_HIDDEN')
    expect(types).toContain('TAB_VISIBLE')
  })

  it('heartbeat failure marks the connection LOST; recovery clears it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    heartbeatReply = () => Promise.reject(new TypeError('Failed to fetch'))
    const { result } = await started()
    await act(async () => { vi.advanceTimersByTime(20_000) })
    await waitFor(() => expect(result.current.health.connection).toBe('LOST'))
    heartbeatReply = () => json({ ok: true, session: { sessionId: 's1', status: 'ACTIVE' } })
    await act(async () => { vi.advanceTimersByTime(20_000) })
    await waitFor(() => expect(result.current.health.connection).toBe('OK'))
  })

  it('a session the server closed moves to SESSION_INTERRUPTED and can be resumed', async () => {
    heartbeatReply = () => json({ ok: true, session: null })
    // Not started(): the first heartbeat can move the state on before a
    // wait for ACTIVE would ever observe it.
    const { result } = renderHook(() => useProctoring(OPTIONS))
    await act(async () => { await result.current.requestPermissionsAndStart() })
    await waitFor(() => expect(result.current.state).toBe('SESSION_INTERRUPTED'))
    heartbeatReply = () => json({ ok: true, session: { sessionId: 's1', status: 'ACTIVE' } })
    await act(async () => { await result.current.resumeSession() })
    expect(result.current.state).toBe('ACTIVE')
  })
})

describe('useProctoring: detection output', () => {
  it('shows a warning from detection, with no numbers in it', async () => {
    const { result } = await started()
    await waitFor(() => expect(gaze.onOutput).not.toBeNull())
    act(() => {
      gaze.onOutput!({ phase: 'MONITORING', warnings: ['MULTIPLE_FACES'], events: [] })
    })
    expect(result.current.warning?.kind).toBe('MULTIPLE_FACES')
    expect(result.current.warning?.message).not.toMatch(/\d/)
    expect(result.current.health.gaze).toBe('RUNNING')
  })

  it('sends one aggregated episode with start, end, duration and confidence', async () => {
    const { result } = await started()
    await waitFor(() => expect(gaze.onOutput).not.toBeNull())
    const t = performance.now()
    act(() => {
      gaze.onOutput!({
        phase: 'MONITORING', warnings: [],
        events: [{ type: 'LOOKING_DOWN', startedAtMs: t - 3200, endedAtMs: t, durationMs: 3200, confidence: 0.89, direction: 'DOWN' }],
      })
    })
    await act(async () => { await result.current.finalize() })
    const all = callsTo(EVENTS_URL).reduce<Array<Record<string, unknown>>>(
      (a, c) => a.concat(bodyOf(c).events as Array<Record<string, unknown>>), []
    )
    const down = all.find(e => e.type === 'LOOKING_DOWN')!
    expect(down).toMatchObject({ durationMs: 3200, confidence: 0.89, direction: 'DOWN' })
    expect(typeof down.startedAt).toBe('string')
    expect(typeof down.endedAt).toBe('string')
    expect(bodyOf(callsTo(EVENTS_URL)[0]).sessionId).toBe('s1')
  })
})

describe('useProctoring: cleanup', () => {
  it('stops every track on unmount', async () => {
    const { unmount } = await started()
    unmount()
    cameraTracks.concat(screenTracks).forEach(t => expect(t.stop).toHaveBeenCalled())
  })

  it('finalize stops every track, flushes, closes the session and stops heartbeating', async () => {
    const { result } = await started()
    await act(async () => { await result.current.finalize() })
    cameraTracks.concat(screenTracks).forEach(t => expect(t.stop).toHaveBeenCalled())
    expect(callsTo(FINALIZE_URL).length).toBe(1)
    const types = sentTypes()
    expect(types).toContain('PROCTORING_STARTED')
    expect(types).toContain('SCREEN_SHARE_STARTED')
    expect(types).toContain('PROCTORING_ENDED')
    expect(result.current.state).toBe('COMPLETED')
    expect(result.current.health.camera).toBe('UNAVAILABLE')
    const before = fetchMock.mock.calls.length
    await new Promise(r => setTimeout(r, 50))
    expect(fetchMock.mock.calls.length).toBe(before)
  })
})
```

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx vitest run`
Expected: green.

Run: `grep -rn "MediaRecorder\|toBlob\|proctoring.uploads\|UPLOAD_\|capture.recording" src/lib/proctoring src/components/proctoring src/app/student`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 11: hook on live monitoring, no recorder, no uploads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Candidate deterrence UX: setup copy, live panel, integrity notices, both pages

**Files:**
- Create: `src/components/proctoring/ProctoringIntegrityBanner.tsx`, `src/components/proctoring/ProctoringExamOverlay.tsx`
- Modify: `src/components/proctoring/ProctoringSetup.tsx`, `src/components/proctoring/ProctoringRecovery.tsx`, `src/app/student/test/[scheduleId]/page.tsx`, `src/app/student/walkin-test/[testId]/page.tsx`
- Test: `tests/proctoring-candidate-ui.test.tsx` (new, jsdom)

**Interfaces:**
- Consumes: `UseProctoringResult` (T11), `INTEGRITY_COPY` (T5), `ProctoringStatusIndicator` (T11), `ProctoringWarning`, `CameraPreview`.
- Produces: `ProctoringIntegrityBanner({ proctoring })`, `ProctoringExamOverlay({ proctoring })`, and exported `CONSENT_COPY`, `PROCTORING_RULES: string[]`, `DATA_NOTE` from `ProctoringSetup.tsx`.

- [ ] **Step 1: Write the failing UI test**

`tests/proctoring-candidate-ui.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import ProctoringStatusIndicator from '@/components/proctoring/ProctoringStatusIndicator'
import ProctoringIntegrityBanner from '@/components/proctoring/ProctoringIntegrityBanner'
import ProctoringWarning from '@/components/proctoring/ProctoringWarning'
import { CONSENT_COPY, DATA_NOTE, PROCTORING_RULES } from '@/components/proctoring/ProctoringSetup'
import { INTEGRITY_COPY } from '@/lib/proctoring/client/warning-copy'
import type { ProctoringHealth, UseProctoringResult } from '@/lib/proctoring/client/use-proctoring'

afterEach(() => cleanup())

const HEALTHY: ProctoringHealth = { camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE', gaze: 'RUNNING', connection: 'OK' }

function fake(p: Partial<UseProctoringResult> = {}): UseProctoringResult {
  return {
    state: 'ACTIVE',
    support: { supported: true, missing: [] },
    devices: { camera: { state: 'READY' }, microphone: { state: 'READY' }, screen: { state: 'READY' } },
    warning: null,
    health: HEALTHY,
    capture: { cameraLive: true, micLive: true, screenSharing: true },
    startError: null,
    needsRecovery: false,
    diagnostics: null,
    requestPermissionsAndStart: vi.fn(() => Promise.resolve(true)),
    resumeScreenShare: vi.fn(() => Promise.resolve(true)),
    resumeCamera: vi.fn(() => Promise.resolve(true)),
    resumeSession: vi.fn(() => Promise.resolve(true)),
    finalize: vi.fn(() => Promise.resolve()),
    videoRef: { current: null },
    ...p,
  }
}

describe('setup copy', () => {
  it('states the ticket consent verbatim', () => {
    expect(CONSENT_COPY).toBe(
      'Proctoring is enabled for this assessment. Your camera, microphone permission status, ' +
      'screen-sharing status, and exam activity may be monitored during the assessment. ' +
      'Gaze analysis runs locally in your browser.'
    )
  })

  it('tells the candidate plainly that phones are not permitted', () => {
    expect(PROCTORING_RULES.some(r => /mobile phone/i.test(r))).toBe(true)
  })

  it('says what is actually stored, and reveals no thresholds', () => {
    expect(DATA_NOTE).toMatch(/No video, audio or screenshots are stored/)
    PROCTORING_RULES.concat(CONSENT_COPY).forEach(s => {
      expect(s).not.toMatch(/\d|second|degree|threshold/i)
      expect(s).not.toMatch(/record|upload|saved/i)
    })
  })
})

describe('ProctoringStatusIndicator', () => {
  it('panel: PROCTORING ACTIVE with Camera and Screen Share active', () => {
    render(<ProctoringStatusIndicator variant="panel" state="ACTIVE" health={HEALTHY} />)
    const panel = screen.getByTestId('proctoring-panel')
    expect(panel.textContent).toMatch(/Proctoring active/i)
    expect(panel.textContent).toMatch(/Camera/)
    expect(panel.textContent).toMatch(/Screen Share/)
    expect(screen.getAllByText('Active').length).toBe(2)
  })

  it('never claims recording, saving or uploading', () => {
    render(<ProctoringStatusIndicator variant="panel" state="ACTIVE" health={HEALTHY} />)
    expect(document.body.textContent).not.toMatch(/record|saved|upload|evidence/i)
  })

  it('says attention is needed the moment screen sharing stops', () => {
    render(<ProctoringStatusIndicator variant="panel" state="SCREEN_SHARE_STOPPED" health={{ ...HEALTHY, screen: 'ENDED' }} />)
    expect(screen.getByTestId('proctoring-panel').textContent).toMatch(/attention needed/i)
    expect(screen.getByText('Stopped')).toBeTruthy()
  })

  it('chip variant for the top bar', () => {
    render(<ProctoringStatusIndicator variant="chip" state="ACTIVE" health={HEALTHY} />)
    expect(screen.getByTestId('proctoring-chip').textContent).toMatch(/Proctoring active/i)
  })

  it('renders nothing before monitoring starts', () => {
    const { container } = render(<ProctoringStatusIndicator state="IDLE" health={HEALTHY} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('ProctoringIntegrityBanner', () => {
  it('is a polite live region and shows nothing when all is well', () => {
    render(<ProctoringIntegrityBanner proctoring={fake()} />)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
  })

  it('screen sharing stopped: the ticket message and a resume button needing a click', async () => {
    const p = fake({ state: 'SCREEN_SHARE_STOPPED', health: { ...HEALTHY, screen: 'ENDED' } })
    render(<ProctoringIntegrityBanner proctoring={p} />)
    expect(screen.getByText(INTEGRITY_COPY.SCREEN_SHARE_STOPPED)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /resume screen sharing/i }))
    await waitFor(() => expect(p.resumeScreenShare).toHaveBeenCalledTimes(1))
  })

  it('camera stopped: "Your camera connection was interrupted." and a reconnect button', async () => {
    const p = fake({ state: 'CAMERA_STOPPED', health: { ...HEALTHY, camera: 'ENDED' } })
    render(<ProctoringIntegrityBanner proctoring={p} />)
    expect(screen.getByText('Your camera connection was interrupted.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))
    await waitFor(() => expect(p.resumeCamera).toHaveBeenCalledTimes(1))
  })

  it('connection lost is shown, with nothing to click', () => {
    render(<ProctoringIntegrityBanner proctoring={fake({ health: { ...HEALTHY, connection: 'LOST' } })} />)
    expect(screen.getByText(INTEGRITY_COPY.CONNECTION_LOST)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('an interrupted session offers resume; a closed one tells them to get help', () => {
    const p = fake({ state: 'SESSION_INTERRUPTED' })
    const { rerender } = render(<ProctoringIntegrityBanner proctoring={p} />)
    expect(screen.getByRole('button', { name: /resume proctoring/i })).toBeTruthy()
    rerender(<ProctoringIntegrityBanner proctoring={fake({ state: 'SESSION_INTERRUPTED', startError: { message: 'x', code: 'PROCTORING_SESSION_CLOSED' } })} />)
    expect(screen.getByText(INTEGRITY_COPY.SESSION_CLOSED)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('ProctoringWarning', () => {
  it('is non-blocking: a polite status region that does not capture clicks', () => {
    render(<ProctoringWarning warning={{ message: 'Please look at the assessment screen.', kind: 'LOOK_AT_SCREEN' }} />)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.className).toMatch(/pointer-events-none/)
  })
})
```

Run: `npx vitest run tests/proctoring-candidate-ui.test.tsx`
Expected: FAIL, "Cannot find module '@/components/proctoring/ProctoringIntegrityBanner'".

- [ ] **Step 2: Create `src/components/proctoring/ProctoringIntegrityBanner.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { INTEGRITY_COPY } from '@/lib/proctoring/client/warning-copy'
import type { UseProctoringResult } from '@/lib/proctoring/client/use-proctoring'

/**
 * Persistent integrity notices, one per live problem, read from device health
 * rather than the single state name, since several can be true at once.
 *
 * Non-blocking: the candidate keeps answering. Screen sharing and the camera
 * can only be re-acquired from a user gesture, hence the buttons.
 */

interface Notice {
  key: string
  message: string
  action?: { label: string; run: () => Promise<boolean> }
}

export default function ProctoringIntegrityBanner({ proctoring }: { proctoring: UseProctoringResult }) {
  const [busy, setBusy] = useState<string | null>(null)
  const { health, state, startError } = proctoring
  const notices: Notice[] = []

  if (state === 'SESSION_INTERRUPTED') {
    const closed = startError?.code === 'PROCTORING_SESSION_CLOSED'
    notices.push({
      key: 'session',
      message: closed ? INTEGRITY_COPY.SESSION_CLOSED : INTEGRITY_COPY.SESSION_INTERRUPTED,
      action: closed ? undefined : { label: 'Resume proctoring', run: proctoring.resumeSession },
    })
  }
  if (health.screen === 'ENDED') {
    notices.push({
      key: 'screen',
      message: INTEGRITY_COPY.SCREEN_SHARE_STOPPED,
      action: { label: 'Resume screen sharing', run: proctoring.resumeScreenShare },
    })
  } else if (health.screen === 'MUTED') {
    notices.push({ key: 'screen-paused', message: INTEGRITY_COPY.SCREEN_SHARE_PAUSED })
  }
  if (health.camera === 'ENDED' || health.microphone === 'ENDED') {
    notices.push({
      key: 'camera',
      message: health.camera === 'ENDED' ? INTEGRITY_COPY.CAMERA_INTERRUPTED : INTEGRITY_COPY.MICROPHONE_INTERRUPTED,
      action: { label: 'Reconnect camera and microphone', run: proctoring.resumeCamera },
    })
  } else if (health.camera === 'MUTED') {
    notices.push({ key: 'camera-muted', message: INTEGRITY_COPY.CAMERA_INTERRUPTED })
  } else if (health.microphone === 'MUTED') {
    notices.push({ key: 'mic-muted', message: INTEGRITY_COPY.MICROPHONE_INTERRUPTED })
  }
  if (health.connection === 'LOST') {
    notices.push({ key: 'connection', message: INTEGRITY_COPY.CONNECTION_LOST })
  }

  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 left-4 z-30 max-w-sm space-y-2">
      {notices.map(n => (
        <div key={n.key} data-testid={`integrity-${n.key}`} className="bg-white border border-amber-300 rounded-lg shadow-lg p-4">
          <p className="text-sm text-amber-800 flex items-start gap-2 leading-relaxed">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{n.message}</span>
          </p>
          {n.action && (
            <button
              onClick={async () => {
                const action = n.action
                if (!action) return
                setBusy(n.key)
                try {
                  await action.run()
                } finally {
                  setBusy(null)
                }
              }}
              disabled={busy !== null}
              className="btn-primary text-sm py-2 w-full justify-center mt-3 disabled:opacity-60"
            >
              {busy === n.key ? <><Loader2 size={14} className="animate-spin" /> Working…</> : n.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create `src/components/proctoring/ProctoringExamOverlay.tsx`**

```tsx
'use client'
import type { UseProctoringResult } from '@/lib/proctoring/client/use-proctoring'
import CameraPreview from './CameraPreview'
import ProctoringIntegrityBanner from './ProctoringIntegrityBanner'
import ProctoringStatusIndicator from './ProctoringStatusIndicator'
import ProctoringWarning from './ProctoringWarning'

/**
 * Everything proctoring puts on screen during the exam, in one element, so
 * the two near-identical candidate pages each render exactly one line of it.
 *
 * The self-view and the status panel sit together so the candidate can see,
 * at all times, that the camera is live and monitoring is active.
 */
export default function ProctoringExamOverlay({ proctoring }: { proctoring: UseProctoringResult }) {
  return (
    <>
      <ProctoringWarning warning={proctoring.warning} />
      <ProctoringIntegrityBanner proctoring={proctoring} />
      <div className="fixed bottom-4 right-4 z-30 w-48 space-y-2">
        <CameraPreview videoRef={proctoring.videoRef} live={proctoring.capture.cameraLive} size="small" />
        <ProctoringStatusIndicator variant="panel" state={proctoring.state} health={proctoring.health} />
      </div>
    </>
  )
}
```

- [ ] **Step 4: `ProctoringSetup.tsx` copy and rules**

Replace the `CONSENT_COPY` constant and its comment with:

```ts
/** Verbatim from the live-monitoring ticket. Do not reword without the product owner. */
export const CONSENT_COPY =
  'Proctoring is enabled for this assessment. Your camera, microphone permission status, ' +
  'screen-sharing status, and exam activity may be monitored during the assessment. ' +
  'Gaze analysis runs locally in your browser.'

/** Rules, not thresholds: what to do, never how detection decides. */
export const PROCTORING_RULES = [
  'Do not use a mobile phone, smartwatch or any other device during the assessment.',
  'Keep your face clearly visible to the camera. Only you should be in view.',
  'Keep screen sharing on until you submit.',
  'Stay on this tab until you submit.',
]

/** What is and is not kept. True, and deliberately not frightening. */
export const DATA_NOTE =
  'Monitoring events, such as camera or screen-sharing interruptions, are logged for review. ' +
  'No video, audio or screenshots are stored.'
```

Replace the purple consent box (the `<div className="bg-brand-purple/5 …">` block) with:

```tsx
      <div className="bg-brand-purple/5 border border-brand-purple/20 rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-brand-purple flex items-center gap-2">
          <ShieldCheck size={16} /> This is a proctored assessment
        </p>
        <p className="text-sm text-gray-600 leading-relaxed">{CONSENT_COPY}</p>
        <ul className="text-sm text-gray-700 space-y-1.5 list-disc pl-5">
          {PROCTORING_RULES.map(rule => <li key={rule}>{rule}</li>)}
        </ul>
        <p className="text-xs text-gray-500 leading-relaxed">{DATA_NOTE}</p>
      </div>
```

Update the component's header comment: the consent copy is verbatim from the live-monitoring ticket, and the rules state what not to do without describing detection.

- [ ] **Step 5: `ProctoringRecovery.tsx` closed-session copy**

Replace the paragraph inside the `closed ?` branch (the one starting "This attempt&apos;s proctoring session was closed…") with:

```tsx
            <p className="text-sm text-red-700 leading-relaxed">
              This attempt&apos;s proctoring session has already been closed and cannot be reopened.
              Please contact your invigilator or the assessment coordinator now — do not close this page.
            </p>
```

Update the matching comment above it: "COMPLETED and EXPIRED sessions cannot be reopened. An interrupted one resumes through the same button."

- [ ] **Step 6: Both candidate pages, identically**

In **both** `src/app/student/test/[scheduleId]/page.tsx` and `src/app/student/walkin-test/[testId]/page.tsx`:

1. Delete the imports of `ProctoringWarning` and `CameraPreview`, and add `import ProctoringExamOverlay from '@/components/proctoring/ProctoringExamOverlay'`.
2. Replace `{proctoringEnabled && <ProctoringWarning warning={proctoring.warning} />}` with `{proctoringEnabled && <ProctoringExamOverlay proctoring={proctoring} />}`.
3. Delete the self-view block, from the comment `The self-view stays mounted for the whole exam…` through its closing `)}`:

```tsx
      {proctoringEnabled && proctoring.capture.cameraLive && (
        <div className="fixed bottom-4 right-4 z-30">
          <CameraPreview videoRef={proctoring.videoRef} live size="small" />
        </div>
      )}
```

4. Delete the inline screen-share banner, from the comment `Screen sharing can only be re-acquired from a user gesture…` through its closing `)}` (the block conditioned on `proctoring.state === 'SCREEN_SHARE_STOPPED'`). The overlay's integrity banner replaces it.

Then check parity:

Run: `diff <(grep -n "proctoring\|Proctoring" "src/app/student/test/[scheduleId]/page.tsx" | sed 's/^[0-9]*://') <(grep -n "proctoring\|Proctoring" "src/app/student/walkin-test/[testId]/page.tsx" | sed 's/^[0-9]*://')`
Expected: only the `kind:` and `parentId:` lines differ.

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/proctoring-candidate-ui.test.tsx tests/proctoring-setup.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: exit 0; green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 12: visible monitoring panel, integrity notices, honest setup copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Development-only diagnostics panel

**Files:**
- Create: `src/components/proctoring/ProctoringDiagnostics.tsx`
- Modify: `src/components/proctoring/ProctoringExamOverlay.tsx`, `.env.example`
- Test: `tests/proctoring-diagnostics-panel.test.tsx` (new, jsdom)

**Interfaces:**
- Consumes: `DIAGNOSTICS_ENABLED`, `DiagnosticsSnapshot` (T11), `ProctoringHealth` (T11).
- Produces: `ProctoringDiagnostics({ snapshot, state, health, enabled? })`. The `enabled` prop exists for tests only and defaults to `DIAGNOSTICS_ENABLED`.

- [ ] **Step 1: Write the failing test**

`tests/proctoring-diagnostics-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ProctoringDiagnostics from '@/components/proctoring/ProctoringDiagnostics'
import type { DiagnosticsSnapshot } from '@/lib/proctoring/client/diagnostics'

afterEach(() => cleanup())

const HEALTH = { camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ENDED', gaze: 'RUNNING', connection: 'OK' } as const

const SNAP: DiagnosticsSnapshot = {
  faceCount: 1, yaw: -21.46, pitch: -18.02, roll: 2.4, irisX: -0.19, irisY: 0.2, quality: 1, faceWidth: 0.21,
  baseline: { yaw: 3, pitch: -2, irisX: 0.01, irisY: 0.02 },
  deviation: { yaw: -24.46, pitch: -16.02, irisX: -0.2, irisY: 0.18 },
  direction: 'LEFT + DOWN', confidence: 0.9, agreement: 'HEAD_AND_EYES',
  phase: 'MONITORING', temporalState: 'WARNING', condition: 'LOOKING_DOWN',
}

describe('ProctoringDiagnostics', () => {
  it('renders nothing unless diagnostics are enabled (the production case)', () => {
    const { container } = render(<ProctoringDiagnostics snapshot={SNAP} state="ACTIVE" health={HEALTH} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows every field the spec lists when enabled in development', () => {
    render(<ProctoringDiagnostics enabled snapshot={SNAP} state="ACTIVE" health={HEALTH} />)
    const text = screen.getByTestId('proctoring-diagnostics').textContent ?? ''
    const labels = [
      'Face count', 'Yaw', 'Pitch', 'Roll', 'Iris X', 'Iris Y', 'Baseline', 'Deviation',
      'Direction', 'Confidence', 'Temporal state', 'Proctoring state', 'Camera', 'Screen share',
    ]
    labels.forEach(l => expect(text).toContain(l))
    expect(text).toContain('LEFT + DOWN')
    expect(text).toContain('-21.5')
    expect(text).toContain('ENDED')
  })

  it('renders null readings as a dash, never as 0', () => {
    render(<ProctoringDiagnostics enabled snapshot={{ ...SNAP, irisX: null, irisY: null }} state="ACTIVE" health={HEALTH} />)
    expect(screen.getByTestId('diag-iris-x').textContent).toBe('—')
  })
})
```

- [ ] **Step 2: Create `src/components/proctoring/ProctoringDiagnostics.tsx`**

```tsx
'use client'
import { DIAGNOSTICS_ENABLED, type DiagnosticsSnapshot } from '@/lib/proctoring/client/diagnostics'
import type { ProctoringHealth } from '@/lib/proctoring/client/use-proctoring'
import type { ProctoringClientState } from '@/lib/proctoring/types'

/**
 * Development-only live readout, for validating the sign convention and
 * thresholds against a real face (CENTER, LEFT, RIGHT, UP, DOWN, LEFT+DOWN,
 * RIGHT+DOWN).
 *
 * DIAGNOSTICS_ENABLED is the literal `false` in a production build, so this
 * renders nothing there. It also shows raw values that must never reach a
 * candidate.
 */

const fmt = (n: number | null | undefined, digits = 1): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(digits)

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-400">{label}</span>
      <span data-testid={testId} className="text-gray-100">{value}</span>
    </div>
  )
}

export default function ProctoringDiagnostics({
  snapshot,
  state,
  health,
  enabled = DIAGNOSTICS_ENABLED,
}: {
  snapshot: DiagnosticsSnapshot | null
  state: ProctoringClientState
  health: ProctoringHealth
  enabled?: boolean
}) {
  if (!enabled) return null
  const s = snapshot
  return (
    <div
      data-testid="proctoring-diagnostics"
      className="fixed top-16 right-4 z-50 w-64 rounded-lg bg-gray-900/90 text-[11px] font-mono p-3 space-y-0.5 pointer-events-none"
    >
      <p className="text-amber-300 font-semibold mb-1">Proctoring diagnostics (dev only)</p>
      <Row label="Face count" value={s ? String(s.faceCount) : '—'} />
      <Row label="Yaw" value={fmt(s?.yaw)} />
      <Row label="Pitch" value={fmt(s?.pitch)} />
      <Row label="Roll" value={fmt(s?.roll)} />
      <Row label="Iris X" value={fmt(s?.irisX, 3)} testId="diag-iris-x" />
      <Row label="Iris Y" value={fmt(s?.irisY, 3)} />
      <Row label="Quality" value={fmt(s?.quality, 2)} />
      <Row label="Face width" value={fmt(s?.faceWidth, 3)} />
      <Row
        label="Baseline"
        value={s?.baseline ? `${fmt(s.baseline.yaw)} / ${fmt(s.baseline.pitch)} / ${fmt(s.baseline.irisX, 3)}` : 'calibrating'}
      />
      <Row
        label="Deviation"
        value={s ? `${fmt(s.deviation.yaw)} / ${fmt(s.deviation.pitch)} / ${fmt(s.deviation.irisX, 3)} / ${fmt(s.deviation.irisY, 3)}` : '—'}
      />
      <Row label="Direction" value={s ? s.direction : '—'} />
      <Row label="Confidence" value={s ? `${fmt(s.confidence, 2)} (${s.agreement})` : '—'} />
      <Row label="Phase" value={s ? s.phase : '—'} />
      <Row label="Temporal state" value={s ? `${s.temporalState}${s.condition ? ` · ${s.condition}` : ''}` : '—'} />
      <Row label="Proctoring state" value={state} />
      <Row label="Camera" value={health.camera} />
      <Row label="Microphone" value={health.microphone} />
      <Row label="Screen share" value={health.screen} />
      <Row label="Gaze monitor" value={health.gaze} />
      <Row label="Connection" value={health.connection} />
    </div>
  )
}
```

- [ ] **Step 3: Mount it in the overlay and document the flag**

In `ProctoringExamOverlay.tsx`, import `ProctoringDiagnostics` and add as the last child of the fragment:

```tsx
      <ProctoringDiagnostics snapshot={proctoring.diagnostics} state={proctoring.state} health={proctoring.health} />
```

Append to the proctoring block of `.env.example`:

```bash
# Development only: a live readout of face count, head pose, iris offsets,
# baseline, direction and temporal state, for validating detection against a
# real face. Ignored in production builds. Put it in .env.local, not .env.
# NEXT_PUBLIC_PROCTORING_DIAGNOSTICS="true"
```

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/proctoring-diagnostics-panel.test.tsx && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: green.

```bash
git add -A
git commit -m "proctoring live-monitoring 13: development-only diagnostics panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Admin-only `PROCTORING_REVIEW_SIGNAL`

**Files:**
- Create: `src/lib/proctoring/review-signal.ts`
- Modify: `src/lib/proctoring/admin.ts`, `src/components/proctoring/admin/ProctoringPanel.tsx`
- Test: `tests/proctoring-review-signal.test.ts` (new), `tests/proctoring-admin-api.test.ts` (append)

**Interfaces:**
- Produces: `ReviewLevel = 'NONE' | 'LOW' | 'MODERATE' | 'ELEVATED'`; `ObservationStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NEGLIGIBLE'`; `ReviewContribution { group; count; points; strength }`; `ProctoringReviewSignal { name: 'PROCTORING_REVIEW_SIGNAL'; level; score; contributions }`; `computeReviewSignal(events: ReadonlyArray<{ type: string; durationMs: number | null }>): ProctoringReviewSignal`; `LONG_FACE_ABSENCE_MS = 10_000`.
- `AdminEvidence` gains `reviewSignal: ProctoringReviewSignal | null`.
- Computed on read, never stored and never an input to scoring. When the weights change, every attempt's signal changes with them and no data migration is needed.

- [ ] **Step 1: Write the failing test**

`tests/proctoring-review-signal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeReviewSignal } from '@/lib/proctoring/review-signal'

const e = (type: string, durationMs: number | null = null) => ({ type, durationMs })
const many = (n: number, type: string, d: number | null = null) => Array.from({ length: n }, () => e(type, d))

describe('computeReviewSignal', () => {
  it('is named as a review prompt, never a verdict', () => {
    const s = computeReviewSignal(many(3, 'MULTIPLE_FACES').concat(many(3, 'SCREEN_SHARE_INTERRUPTED')))
    expect(s.name).toBe('PROCTORING_REVIEW_SIGNAL')
    expect(JSON.stringify(s)).not.toMatch(/cheat|confirmed|guilty|fail/i)
  })

  it('nothing observed is NONE', () => {
    expect(computeReviewSignal([]).level).toBe('NONE')
  })

  it('one brief glance is negligible', () => {
    expect(computeReviewSignal([e('LOOKING_LEFT', 1900)]).level).toBe('NONE')
  })

  it('window blur alone never raises the signal', () => {
    expect(computeReviewSignal(many(50, 'WINDOW_BLUR')).level).toBe('NONE')
  })

  it('many glances add up only to LOW', () => {
    expect(computeReviewSignal(many(40, 'LOOKING_DOWN', 3000)).level).toBe('LOW')
  })

  it('repeated downward attention is a moderate observation', () => {
    const s = computeReviewSignal([e('REPEATED_DOWNWARD_ATTENTION', 12_000)])
    expect(s.level).toBe('LOW')
    expect(s.contributions[0]).toMatchObject({ group: 'REPEATED_DOWNWARD_ATTENTION', strength: 'MODERATE' })
  })

  it('long face absence is strong; a brief one is weak', () => {
    expect(computeReviewSignal([e('FACE_MISSING', 12_000)]).contributions[0].strength).toBe('STRONG')
    expect(computeReviewSignal([e('FACE_MISSING', 2500)]).contributions[0].strength).toBe('WEAK')
  })

  it('one kind of observation alone, however often, stops at MODERATE', () => {
    const s = computeReviewSignal(many(10, 'MULTIPLE_FACES'))
    expect(s.score).toBeGreaterThanOrEqual(8)
    expect(s.level).toBe('MODERATE')
  })

  it('strong observations of different kinds together reach ELEVATED', () => {
    const s = computeReviewSignal([e('MULTIPLE_FACES'), e('SCREEN_SHARE_INTERRUPTED'), e('SCREEN_SHARE_INTERRUPTED')])
    expect(s.level).toBe('ELEVATED')
  })

  it('caps each group so one noisy type cannot dominate', () => {
    const s = computeReviewSignal(many(100, 'TAB_HIDDEN'))
    expect(s.contributions[0].points).toBeLessThanOrEqual(5)
    expect(s.contributions[0].count).toBe(100)
  })

  it('ignores types it does not weigh, such as lifecycle events', () => {
    expect(computeReviewSignal([e('PROCTORING_STARTED'), e('PROCTORING_ENDED'), e('TAB_VISIBLE')]).contributions).toEqual([])
  })
})
```

- [ ] **Step 2: Create `src/lib/proctoring/review-signal.ts`**

```ts
/**
 * PROCTORING_REVIEW_SIGNAL: an internal prompt for human review.
 *
 * Aggregates the observations recorded for one attempt into a coarse level
 * that tells a reviewer where to look first. It is not a finding of
 * misconduct, it is never shown to the candidate, and it is never an input to
 * scoring - grading.ts does not know it exists.
 *
 * Built so that no single signal decides anything:
 *  - each observation group is capped, so one noisy type cannot dominate;
 *  - ELEVATED needs at least two different substantive kinds of observation;
 *  - focus changes are negligible on their own.
 */

export type ReviewLevel = 'NONE' | 'LOW' | 'MODERATE' | 'ELEVATED'
export type ObservationStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NEGLIGIBLE'

export interface ReviewContribution {
  group: string
  count: number
  points: number
  strength: ObservationStrength
}

export interface ProctoringReviewSignal {
  name: 'PROCTORING_REVIEW_SIGNAL'
  level: ReviewLevel
  score: number
  contributions: ReviewContribution[]
}

export const LONG_FACE_ABSENCE_MS = 10_000

const CAP: Record<ObservationStrength, number> = { STRONG: 9, MODERATE: 5, WEAK: 2, NEGLIGIBLE: 0.5 }

function classify(e: { type: string; durationMs: number | null }):
  { group: string; strength: ObservationStrength; points: number } | null {
  switch (e.type) {
    case 'MULTIPLE_FACES':
    case 'SCREEN_SHARE_INTERRUPTED':
    case 'CAMERA_INTERRUPTED':
      return { group: e.type, strength: 'STRONG', points: 3 }
    case 'FACE_MISSING':
      return (e.durationMs ?? 0) >= LONG_FACE_ABSENCE_MS
        ? { group: 'FACE_MISSING_LONG', strength: 'STRONG', points: 3 }
        : { group: 'FACE_MISSING_BRIEF', strength: 'WEAK', points: 0.5 }
    case 'REPEATED_DOWNWARD_ATTENTION':
      return { group: e.type, strength: 'MODERATE', points: 2 }
    case 'SUSTAINED_DOWNWARD_ATTENTION':
    case 'HEARTBEAT_MISSED':
    case 'MICROPHONE_INTERRUPTED':
      return { group: e.type, strength: 'MODERATE', points: 1.5 }
    case 'TAB_HIDDEN':
    case 'PAGE_HIDDEN':
    case 'GAZE_MONITOR_UNAVAILABLE':
      return { group: e.type, strength: 'MODERATE', points: 1 }
    case 'LOOKING_LEFT':
    case 'LOOKING_RIGHT':
    case 'LOOKING_UP':
    case 'LOOKING_DOWN':
      return { group: 'LOOKING_AWAY', strength: 'WEAK', points: 0.25 }
    case 'FULLSCREEN_EXITED':
      return { group: e.type, strength: 'WEAK', points: 0.25 }
    case 'WINDOW_BLUR':
      return { group: e.type, strength: 'NEGLIGIBLE', points: 0.1 }
    default:
      return null
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function computeReviewSignal(
  events: ReadonlyArray<{ type: string; durationMs: number | null }>
): ProctoringReviewSignal {
  const groups: { [group: string]: ReviewContribution } = {}
  for (let i = 0; i < events.length; i++) {
    const c = classify(events[i])
    if (!c) continue
    const g = groups[c.group] ?? (groups[c.group] = { group: c.group, count: 0, points: 0, strength: c.strength })
    g.count++
    g.points = Math.min(CAP[c.strength], g.points + c.points)
  }

  const contributions = Object.keys(groups)
    .map(k => ({ ...groups[k], points: round1(groups[k].points) }))
    .sort((a, b) => b.points - a.points)

  let score = 0
  for (let i = 0; i < contributions.length; i++) score += contributions[i].points
  score = round1(score)

  let level: ReviewLevel = score >= 8 ? 'ELEVATED' : score >= 4 ? 'MODERATE' : score >= 1 ? 'LOW' : 'NONE'
  const substantive = contributions.filter(c => c.strength === 'STRONG' || c.strength === 'MODERATE').length
  // Aggregate evidence: one kind of observation, however repeated, never
  // reaches the top level on its own.
  if (level === 'ELEVATED' && substantive < 2) level = 'MODERATE'

  return { name: 'PROCTORING_REVIEW_SIGNAL', level, score, contributions }
}
```

Run: `npx vitest run tests/proctoring-review-signal.test.ts`
Expected: PASS. Sanity-check two cases by hand: 40 × LOOKING_DOWN caps at 2 → LOW, and 10 × MULTIPLE_FACES caps at 9 but is a single group → MODERATE.

- [ ] **Step 3: Attach it to the read model**

In `src/lib/proctoring/admin.ts`: import `{ computeReviewSignal, type ProctoringReviewSignal } from './review-signal'`, add `reviewSignal: ProctoringReviewSignal | null` to `AdminEvidence`, return `{ session: null, events: [], reviewSignal: null }` for a never-proctored attempt, and `{ session, events, reviewSignal: computeReviewSignal(events) }` otherwise.

In `tests/proctoring-admin-api.test.ts`, update `'returns a null session for a never-proctored attempt rather than throwing'` to expect `{ session: null, events: [], reviewSignal: null }`, and append inside `describe('getAdminEvidence')`:

```ts
  it('derives an admin-only review signal from the stored observations', async () => {
    const evidence = await getAdminEvidence(scheduledAttemptId, 'scheduled')
    expect(evidence.reviewSignal?.name).toBe('PROCTORING_REVIEW_SIGNAL')
    // One screen-share interruption (strong) and one glance (weak).
    expect(evidence.reviewSignal?.level).toBe('LOW')
    expect(evidence.reviewSignal?.contributions.map(c => c.group)).toContain('SCREEN_SHARE_INTERRUPTED')
  })
```

- [ ] **Step 4: Show it in `ProctoringPanel.tsx`**

Add `import type { ProctoringReviewSignal } from '@/lib/proctoring/review-signal'`. Add `reviewSignal: ProctoringReviewSignal | null` to the `Evidence` interface, and `missedHeartbeatCount: number` to its `session`. Add this component above the default export:

```tsx
const LEVEL_TEXT: Record<ProctoringReviewSignal['level'], string> = {
  NONE: 'No notable observations',
  LOW: 'Low - a few observations',
  MODERATE: 'Moderate - worth a closer look',
  ELEVATED: 'Elevated - review this attempt',
}

const GROUP_TEXT: Record<string, string> = {
  MULTIPLE_FACES: 'More than one face visible',
  SCREEN_SHARE_INTERRUPTED: 'Screen sharing interrupted',
  CAMERA_INTERRUPTED: 'Camera interrupted',
  FACE_MISSING_LONG: 'Face not visible for a long stretch',
  FACE_MISSING_BRIEF: 'Face briefly not visible',
  REPEATED_DOWNWARD_ATTENTION: 'Repeated downward attention',
  SUSTAINED_DOWNWARD_ATTENTION: 'Sustained downward attention',
  HEARTBEAT_MISSED: 'Proctoring connection gaps',
  MICROPHONE_INTERRUPTED: 'Microphone interrupted',
  TAB_HIDDEN: 'Assessment tab hidden',
  PAGE_HIDDEN: 'Page closed or navigated away',
  GAZE_MONITOR_UNAVAILABLE: 'Gaze analysis could not run',
  LOOKING_AWAY: 'Looking away from the screen',
  FULLSCREEN_EXITED: 'Left full screen',
  WINDOW_BLUR: 'Window lost focus',
}

function ReviewSignalCard({ signal }: { signal: ProctoringReviewSignal }) {
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3 text-sm">
      <p className="text-gray-700">
        <span className="font-medium">Review signal:</span> {LEVEL_TEXT[signal.level]}
      </p>
      {signal.contributions.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
          {signal.contributions.map(c => (
            <li key={c.group}>
              {GROUP_TEXT[c.group] ?? c.group.toLowerCase().replace(/_/g, ' ')} ×{c.count}
              <span className="text-gray-400"> ({c.strength.toLowerCase()})</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-gray-400 leading-relaxed">
        A prompt for where to look first, built from the observations below. It is not a
        finding of misconduct and is never used in scoring.
      </p>
    </div>
  )
}
```

In the session summary row, add `<span>Connection gaps <span className="text-gray-700">{evidence.session.missedHeartbeatCount}</span></span>`. Render `{evidence.reviewSignal && <ReviewSignalCard signal={evidence.reviewSignal} />}` directly above `<EventTimeline …/>`. Neutral styling only: no red, and no ranking across candidates.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: green.

```bash
git add -A
git commit -m "proctoring live-monitoring 14: admin-only PROCTORING_REVIEW_SIGNAL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: No-media guard, docs, security review, build, and the owner's manual test script

**Files:**
- Create: `tests/proctoring-no-media.test.ts`
- Modify: `plans/proctoring/README.md`, `plans/proctoring/PROGRESS.md`
- No product code changes, unless the security review in Step 4 finds a gap. Any fix gets its own commit, with a test.

- [ ] **Step 1: The guard test**

`tests/proctoring-no-media.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Enforces the phase's non-negotiables (spec N1/N2): no media capture,
 * encoding, upload or storage anywhere in proctoring, and no storage
 * dependency. Comments are stripped first, so explaining what we do not do
 * does not trip it.
 */

const ROOTS = [
  'src/lib/proctoring',
  'src/components/proctoring',
  'src/app/api/student/proctoring',
  'src/app/api/admin/proctoring',
]

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bMediaRecorder\b/, 'MediaRecorder'],
  [/\.toBlob\s*\(/, 'canvas.toBlob'],
  [/\.toDataURL\s*\(/, 'canvas.toDataURL'],
  [/\bgetImageData\s*\(/, 'getImageData'],
  [/\bImageCapture\b/, 'ImageCapture'],
  [/@aws-sdk\//, 'AWS SDK'],
  [/\bR2_[A-Z_]+/, 'R2 configuration'],
  [/upload-url|asset-complete|download-url/, 'media upload endpoints'],
  [/\bcreateUploadUrl\b|\bputObject\b|\bgetStorage\b/, 'object storage calls'],
  [/\bproctoringAsset\b/, 'the dropped ProctoringAsset table'],
]

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).reduce<string[]>((acc, entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return acc.concat(walk(full))
    return /\.(ts|tsx)$/.test(entry.name) ? acc.concat(full) : acc
  }, [])
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('metadata-only proctoring', () => {
  it('has no media capture, encoding, upload or storage code', () => {
    const hits: string[] = []
    ROOTS.forEach(root => walk(root).forEach(file => {
      const code = stripComments(fs.readFileSync(file, 'utf8'))
      FORBIDDEN.forEach(([re, what]) => { if (re.test(code)) hits.push(`${file}: ${what}`) })
    }))
    expect(hits).toEqual([])
  })

  it('declares no storage SDK dependency', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> }
    expect(Object.keys(pkg.dependencies ?? {}).filter(d => d.indexOf('@aws-sdk/') === 0)).toEqual([])
  })

  it('ships no storage credentials or budget in .env.example', () => {
    const env = fs.readFileSync('.env.example', 'utf8')
    expect(env).not.toMatch(/^R2_/m)
    expect(env).not.toMatch(/PROCTORING_STORAGE|SAFETY_BYTES|BITS_PER_SECOND|SCREENSHOT_INTERVAL/)
  })

  it('has no media or storage routes on disk', () => {
    ['src/app/api/student/proctoring/upload-url', 'src/app/api/student/proctoring/asset-complete',
      'src/app/api/admin/proctoring/assets', 'src/app/api/admin/proctoring/usage',
    ].forEach(p => expect(fs.existsSync(p)).toBe(false))
  })
})
```

Run: `npx vitest run tests/proctoring-no-media.test.ts`
Expected: PASS. A hit means something from Tasks 1 or 11 survived. Delete it; do not weaken the pattern.

- [ ] **Step 2: Update `plans/proctoring/README.md`**

1. Replace the **Goal** paragraph with: "Optional, live proctoring for the SpeedTest assessment platform: in-browser MediaPipe detection, visible monitoring, warnings, tamper and interruption detection, and server-side logging of metadata events. No video, audio or screenshots are recorded, stored or uploaded, so no storage credentials are needed. The earlier media-recording design (Parts 2, 3, 5, 7, 10) was removed in the live-monitoring phase: `live-monitoring-plan.md`."
2. Delete finding 2 ("The 7 GB cap…") and the whole **Storage: one interface, two providers** section, including the R2 gotchas. Replace them with a section headed **Architecture (live monitoring)** containing this diagram and the limitations list:

```text
Camera + mic (getUserMedia)       Screen (getDisplayMedia)
        │ browser memory only             │ held only to detect its end
        ▼                                 ▼
MediaPipe Face Landmarker        IntegrityMonitor ◄── tracks: ended / mute / unmute
 (gaze-monitor.ts, ~6 FPS,          │                page: visibility, pagehide,
  rVFC → rAF, GPU → CPU)            │                fullscreen, blur / focus
        ▼                           │
extractFrameSignals  (face count, yaw/pitch/roll, iris X/Y, face size, quality)
        ▼                           │
BaselineCollector    (~3 s median personal baseline)
        ▼                           │
fuseSignals          (head + eyes agreement → direction + confidence)
        ▼                           │
TemporalEngine       (NORMAL → POSSIBLE → SUSTAINED → WARNING → COOLDOWN)
        ▼                           │
BehaviourTracker     (sustained / repeated downward attention)
        ▼                           ▼
  WarningGate → candidate banners      EventQueue (bounded, rate-capped, batched)
                                            ▼
          POST /events · /heartbeat (session-bound) → ProctoringEvent rows (metadata)
                                            ▼
                     admin: timeline + PROCTORING_REVIEW_SIGNAL (never scoring)
```

Limitations (state them to anyone relying on this):
- A phone held outside the camera's view cannot be detected. Downward attention is an observation, never proof of a phone.
- Gaze is an estimate from head pose and iris offset against a baseline taken in the first few seconds.
- Lighting, glasses, camera placement and a skewed baseline all degrade it.
- A blur or a hidden tab means only that focus left the page.
- The client is not trusted. A modified browser can fake heartbeats that report healthy devices, and it can read the detection thresholds from the JS bundle. What the server does guarantee: `/start` needs a live session; events and heartbeats bind to the caller's own session; heartbeat gaps are recorded server-side, including the trailing gap at submit; event volume is capped per session.

3. In **Global constraints**, delete the three storage bullets ("Object keys carry no PII", the R2 and storage-provider lines) and add: "No media capture, encoding, upload or storage anywhere. `tests/proctoring-no-media.test.ts` enforces it."
4. In the **Data model** block, delete the two asset enums and the asset idempotency key.

- [ ] **Step 3: Ledger entry in `plans/proctoring/PROGRESS.md`**

Append a notes section `### Live-monitoring phase — <date>` containing a table of Tasks 1–15 with their commit hashes, followed by these four lines:
- Parts 13 (Playwright E2E) and 14 (docs and local verification) were written for the media design. Their part files are stale and must be rewritten against `live-monitoring-plan.md` before they are run.
- Part 15 (release) is still blocked. It must apply **both** proctoring migrations to Supabase by hand, in order, and must no longer set up R2.
- The sign convention in `DETECTION_CONFIG.signs` is **unverified** until the owner completes the manual script in Step 6.
- Owner-local cleanup: `.env` may still hold `PROCTORING_STORAGE_PROVIDER`, `R2_*` and the gaze `*_MS` variables. They are now ignored and can be deleted.

- [ ] **Step 4: Security review (spec P28): verify each item and record the evidence**

Fill this table in the ledger entry, citing the test that proves each row. A row without a passing test is a gap: fix it, with a test, before marking this task done.

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Start without a valid proctoring session? | No: `/start` returns 409 `PROCTORING_REQUIRED` and the clock stays unset | `proctoring-start-gate.test.ts` |
| 2 | Disable the camera without an event? | No: track `ended`/`mute` emits `CAMERA_INTERRUPTED`; the heartbeat marks the session DEGRADED server-side; killing the script entirely leaves a server-side `HEARTBEAT_MISSED` (heartbeat gap, sweep, or trailing gap at submit) | `proctoring-integrity-monitor`, `proctoring-use-proctoring`, `proctoring-session-api` |
| 3 | Stop screen sharing undetected? | No: `SCREEN_SHARE_INTERRUPTED`, a persistent banner, DEGRADED on the next heartbeat; resume needs a click | same, plus `proctoring-candidate-ui` |
| 4 | Send fake events for another session? | No: 404 when `sessionId` is not the caller's own live session; nothing stored | `proctoring-student-routes` |
| 5 | Submit another candidate's session id? | No: the same 404, for events and heartbeat | `proctoring-student-routes` |
| 6 | Bypass the UI and call `/start`? | No: the gate is server-side and ignores the body | `proctoring-start-gate` (`proctoringActive: true` case) |
| 7 | Cause duplicate event spam? | Bounded: clientEventId dedup, 30 batches/min per student, 50 events per batch, 2000 events per session, 20 per type per minute client-side | `proctoring-events-api`, `proctoring-student-routes`, `proctoring-event-queue` |
| 8 | Cause an unbounded memory queue? | No: queue ≤ 200 with INFO-first eviction, behaviour tracker ≤ 50 per condition, baseline ≤ 200 samples, rate-limiter map ≤ 10k keys | `proctoring-event-queue`, `proctoring-behaviour-tracker` |
| 9 | Leave the camera running after submission? | No: `finalize` and unmount stop every track, cancel frame callbacks, clear timers, close the queue and reset the pipeline | `proctoring-use-proctoring` (cleanup), `proctoring-gaze-monitor` (stop) |
| 10 | Non-proctored exam affected? | No: hook inert (no prompt, no fetch), `/start` unchanged, no session created | `proctoring-use-proctoring` (regression), `proctoring-start-gate` (regression) |

Residual risk, recorded as accepted and not fixed: a modified client can report healthy devices in its heartbeat. Only a server-side media check could close that, and this phase forbids media.

- [ ] **Step 5: Full verification (ask the owner to stop the dev server first)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx vitest run`
Expected: every file passes. Record the exact file and test counts in the ledger.

Run: `npm run build`
Expected: exit 0.

Run: `grep -rl "Proctoring diagnostics\|diag-iris-x" .next/static`
Expected: no output. The dev-only panel is not in the production bundle.

Run: `grep -rlE "R2_|X-Amz|MediaRecorder" .next/static`
Expected: no output.

Report `npm run lint` as **unavailable** (no eslint configured, recorded in the Part 0 ledger notes). Do not claim it passed.

- [ ] **Step 6: Hand the owner the manual test script, and do not run it yourself**

Put this in the final report verbatim. The executor never starts the dev server or a browser.

**Setup (owner):**
1. Stop and restart the dev server after the migration: `npm run dev`. In `.env.local` set `NEXT_PUBLIC_PROCTORING_DIAGNOSTICS="true"`. In `.env` keep `PROCTORING_ENABLED="true"`.
2. In the admin UI, mark a test "Proctored", open a schedule window for it, and sign in as a student of that college in Chrome at `http://localhost:3001`. Sit about 60 cm from a laptop webcam in even light.
3. Click **Start Proctored Assessment**. Share the **entire screen**, then allow camera and microphone. Confirm that the setup screen showed the consent text, the four rules (phone rule included) and the data note, with no numbers anywhere.
4. In the exam, confirm: the top bar reads "● Proctoring active"; the bottom-right panel reads **PROCTORING ACTIVE**, **Camera ● Active** and **Screen Share ● Active**, under your mirrored self-view; the dark diagnostics panel is at the top right; and after about three seconds, *Baseline* stops reading "calibrating".

**Direction checks** (watch *Direction* and *Temporal state* in the diagnostics panel):

| Case | Do this | Expect |
|---|---|---|
| CENTER | Look at the question | Direction `CENTER`, Temporal `NORMAL`, no banner |
| LEFT | Turn head and eyes to **your** left, hold ~3 s | Direction `LEFT`; Temporal climbs to `WARNING`; banner "Please look at the assessment screen." |
| RIGHT | The same to your right | `RIGHT`, then the same banner |
| UP | Look at the ceiling edge, ~3 s | `UP` |
| DOWN | Look at your lap, ~4 s | `DOWN`, then the banner |
| LEFT + DOWN | Look down-left, ~4 s | Direction `LEFT + DOWN` |
| RIGHT + DOWN | Look down-right | Direction `RIGHT + DOWN` |
| Brief glance | Glance left for under a second, return | Only `POSSIBLE_DEVIATION`, back to `NORMAL`, no banner |

**If LEFT reads RIGHT** (or UP reads DOWN), the sign convention is inverted. Set `signs.yaw` (or `signs.pitch`) to `-1` in `src/lib/proctoring/client/detection-config.ts` and repeat. Do the same for `irisX`/`irisY` if the eyes-only readings disagree with the head. Report which signs you changed; the ledger records the validated convention.

**Behaviour and integrity checks:**

| Case | Do this | Expect |
|---|---|---|
| Repeated downward | Look down for ~3 s, four times within a few minutes | The fourth time, a banner mentioning that mobile phones are not permitted |
| SECOND PERSON | Have someone lean into frame for ~2 s | Face count `2`; banner "More than one face was detected…" |
| FACE REMOVED | Step out of frame for ~4 s, then return | Face count `0`; banner "Please position your face clearly…" |
| SCREEN SHARE STOPPED | Click Chrome's **Stop sharing** | Panel shows **Screen Share ● Stopped**; bottom-left notice "Screen sharing has stopped. Please resume screen sharing to continue the proctored assessment." with a **Resume screen sharing** button; clicking it re-prompts and returns to Active |
| CAMERA STOPPED | Revoke camera permission via the address-bar camera icon (or unplug a USB camera) | **Camera ● Stopped**; notice "Your camera connection was interrupted." with **Reconnect camera and microphone**; reconnect works |
| TAB SWITCH | Switch to another tab for ~5 s and back | The existing violation toast as before; the admin timeline later shows "Assessment tab hidden" and then "…visible again" |
| No media | DevTools → Network during all of the above | Only JSON POSTs to `/api/student/proctoring/{session,heartbeat,events,finalize}`, all small; no PUT, no large body, no third-party host |
| Submit | Submit the test | Camera light goes off within a second; Chrome's sharing bar disappears |
| Review | Admin → Results → the attempt → **Proctoring observations** | Timeline entries for the above with durations; a **Review signal** line; no recording or snapshot tabs |
| Regression | Sit a **non-proctored** test | No permission prompts, no panel, no proctoring requests in the Network tab; behaves exactly as before |

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "proctoring live-monitoring 15: no-media guard, docs, security review, ledger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (self-review)

| Spec | Task(s) |
|---|---|
| N1, N2, P1, P22 | 1 (server media removed), 11 (client capture removed), 15 (guard test) |
| N3, P13 | 5 (copy tests), 6 (thresholds out of the API), 9 (session response test), 11 (indicator), 12 (UI tests) |
| N7 | 5 (`DOWNWARD_ATTENTION` copy), 12 (setup rule) |
| P2, P23 | 11 (setup cancel stops streams, teardown, finalize), 6 (monitor stop) |
| P3 | 7 (mic ended/muted), 11 (mic health in heartbeat) |
| P4 | 7, 11 (resume from a gesture), 12 (banner copy) |
| P5, P6, P7 | 3 (extraction, null iris, yaw/pitch/roll, signs), 13 (debug view), 15 (manual validation) |
| P8 | 4 (median baseline), 3 (baseline deviation tests) |
| P9 | 3 (fusion and agreement) |
| P10 | 4 (temporal engine), 3 (central config) |
| P11 | 5 (behaviour tracker, no PHONE_DETECTED) |
| P12, P21 | 11 (indicator), 12 (panel, notices, setup copy) |
| P14 | 7 (page events), 2 (blur is INFO) |
| P15 | 10 (`/start` gate), 9 (resume) |
| P16, P17 | 2 (event shape), 5 (episodes), 8 (queue, dedup, rate cap), 9 (per-session cap) |
| P18, P19 | 9 (health heartbeat, missed and trailing gaps, sweep), 7, 11 |
| P20 | 14 |
| P24 | 6 (6 FPS gate, rVFC, single loop, busy guard, CPU fallback), 11 (generation guard, refs) |
| P25 | 11 (snapshot), 13 (panel, production-absent check in 15) |
| P26 | 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 |
| P27 | 15 (README limitations) |
| P28 | 15 (security table) |

