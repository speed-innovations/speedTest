# Part 1 — Schema, migration, and configuration

**Delivers:** the database foundation and the validated config module everything
else imports. Nothing user-visible changes.

**Files**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_proctoring/migration.sql`
- Create: `src/lib/proctoring/config.ts`
- Create: `src/lib/proctoring/types.ts`
- Modify: `.env.example`
- Create: `tests/proctoring-config.test.ts`

**Interfaces — Produces**

```ts
// src/lib/proctoring/config.ts
export interface ProctoringConfig {
  enabled: boolean
  operational: boolean
  storageProvider: 'r2' | 'mock'
  screenshotIntervalMs: number
  videoSegmentMs: number
  retentionHours: number
  maxDurationMinutes: number
  gazeWarningMs: number
  gazeWarningCooldownMs: number
  faceMissingWarningMs: number
  multipleFacesWarningMs: number
  screenRequired: boolean
  storageSafetyBytes: number
  maxScreenshotBytes: number
  maxVideoBytesPerAttempt: number
  estimatedScreenshotBytes: number
  videoBitsPerSecond: number
  audioBitsPerSecond: number
  safetyMultiplier: number
  presignedUploadTtlSeconds: number
  presignedDownloadTtlSeconds: number
  heartbeatIntervalMs: number
  staleSessionMs: number
  version: string
}
export function getProctoringConfig(): ProctoringConfig  // memoised
export function getR2Config(): R2Config                  // throws if provider is r2 and vars missing
export const PROCTORING_VERSION = '1'
```

Prisma client gains `prisma.proctoringSession`, `prisma.proctoringAsset`,
`prisma.proctoringEvent`, and `Test.proctoringEnabled`.

**Consumes:** nothing. This is the root part.

---

## Byte columns are `Int`, not `BigInt` — read this before changing them

Postgres `INTEGER` tops out at 2,147,483,647 (~2.1 GB). Per-row values here are
at most ~111 MB reserved / ~92 MB used, so there is ~19× headroom, and
`PROCTORING_MAX_VIDEO_BYTES_PER_ATTEMPT` caps the row value anyway.

`BigInt` would be "safer" and is the wrong call: Prisma maps it to JS `bigint`,
and `JSON.stringify` **throws** on a `bigint`. Every API response carrying a byte
count would need manual conversion, and the failure mode is a 500 in production
rather than a compile error. `Int` avoids that entire class of bug.

The one thing to confirm empirically: the **sum** across sessions can exceed 2^31
(the budget is 7e9). Postgres `SUM(int)` returns `bigint`, and how Prisma's pg
driver adapter surfaces that is not something to assume. **Part 3's first test
asserts it**, with a fixture deliberately over 2^31.

---

## Steps

- [ ] **Step 1: Stop the dev server**

On Windows a running server holds `node_modules/.prisma/client/query_engine-windows.dll.node`
open and `prisma generate` fails with `EPERM: operation not permitted, rename`.
The error names a temp file and gives no hint that a process is the cause.

- [ ] **Step 2: Confirm you are local, on the right branch, against local Postgres**

```bash
git branch --show-current
```

Must print `feat/proctoring`. Then:

```bash
node -e "const u=process.env.DATABASE_URL||require('fs').readFileSync('.env','utf8').match(/^DATABASE_URL=\"?([^\"\n]+)/m)?.[1]; console.log(u && u.includes('localhost') ? 'LOCAL OK' : 'NOT LOCAL: ' + u)"
```

Must print `LOCAL OK`. If it names `supabase.com`, **stop** — edit `.env` to the
local URLs and comment out `DATABASE_CA_CERT_B64` before going further.

- [ ] **Step 3: Install zod**

```bash
npm install zod
```

- [ ] **Step 4: Add `proctoringEnabled` to the `Test` model**

In `prisma/schema.prisma`, inside `model Test`, after `companyPptUrl`:

```prisma
  // Opt-in per test. Existing tests default to false and behave exactly as
  // before - no proctoring UI, no session row, no extra requests.
  proctoringEnabled Boolean @default(false)
```

That is the only change to `Test`. Do **not** add a `ProctoringSession[]`
back-relation here: sessions link to *attempts*, not to the test, and both
`requireScheduledAttempt` and `requireWalkInAttempt` already `include` the test
(`attempt-auth.ts:83,103`), so the flag is reachable with no extra query.

- [ ] **Step 5: Add the enums**

At the end of `prisma/schema.prisma`:

```prisma
enum ProctoringSessionStatus {
  PENDING
  ACTIVE
  DEGRADED
  COMPLETED
  INTERRUPTED
  EXPIRED
}

enum ProctoringAssetType {
  WEBCAM_SEGMENT
  SCREENSHOT
}

enum ProctoringAssetStatus {
  PENDING
  UPLOADED
  FAILED
  EXPIRED
  DELETED
}

enum ProctoringEventType {
  GAZE_LEFT
  GAZE_RIGHT
  GAZE_UP
  GAZE_DOWN
  FACE_NOT_DETECTED
  MULTIPLE_FACES_DETECTED
  SCREEN_SHARE_STOPPED
  SCREEN_SHARE_RESUMED
  CAMERA_STOPPED
  MICROPHONE_STOPPED
  TAB_HIDDEN
  WINDOW_BLURRED
  PROCTORING_STARTED
  PROCTORING_ENDED
  UPLOAD_FAILURE
  UPLOAD_RECOVERED
}
```

- [ ] **Step 6: Add the three models**

```prisma
/// One proctoring session per attempt.
///
/// There is no single attempt table in this schema - TestAttempt (scheduled) and
/// WalkInAttempt (walk-in) are parallel tables with no common parent. Rather than
/// a polymorphic (kind, id) pair, which would give up referential integrity and
/// cascade deletes, this carries both FKs with a CHECK enforcing exactly one.
/// The dual-ness stops here: assets and events reference only this table.
model ProctoringSession {
  id                   String   @id @default(cuid())

  testAttemptId        String?        @unique
  testAttempt          TestAttempt?   @relation(fields: [testAttemptId], references: [id], onDelete: Cascade)
  walkInAttemptId      String?        @unique
  walkInAttempt        WalkInAttempt? @relation(fields: [walkInAttemptId], references: [id], onDelete: Cascade)

  status               ProctoringSessionStatus @default(PENDING)
  /// Bumped when the detection algorithm changes, so old evidence stays interpretable.
  version              String   @default("1")

  startedAt            DateTime?
  endedAt              DateTime?
  lastHeartbeatAt      DateTime?
  /// startedAt + PROCTORING_RETENTION_HOURS. Assets inherit this.
  retentionExpiresAt   DateTime

  recordingStarted     Boolean  @default(false)
  screenShareStarted   Boolean  @default(false)

  /// Byte counters are Int, not BigInt - see the note in part-01. Per-row max is
  /// ~111 MB against a 2.1 GB ceiling; BigInt would break JSON.stringify.
  storageReservedBytes Int      @default(0)
  storageUsedBytes     Int      @default(0)
  uploadFailureCount   Int      @default(0)
  gazeWarningCount     Int      @default(0)

  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  assets               ProctoringAsset[]
  events               ProctoringEvent[]

  @@index([status])
  @@index([retentionExpiresAt])
  @@index([lastHeartbeatAt])
}

/// A stored media object. Never holds a URL - only the R2 object key, so access
/// always goes through a freshly signed, short-lived URL.
model ProctoringAsset {
  id                  String   @id @default(cuid())
  proctoringSessionId String
  session             ProctoringSession @relation(fields: [proctoringSessionId], references: [id], onDelete: Cascade)

  type                ProctoringAssetType
  /// R2 object key. Contains internal ids only - never a name, email or phone.
  objectKey           String   @unique
  contentType         String
  byteSize            Int      @default(0)
  /// Per type, starting at 1. Part of the idempotency key.
  sequence            Int

  capturedAt          DateTime
  uploadedAt          DateTime?
  /// Access is refused past this instant even if R2 has not yet deleted the object.
  expiresAt           DateTime
  status              ProctoringAssetStatus @default(PENDING)

  /// Milliseconds since the attempt started. The correlation axis for review.
  elapsedMs           Int?
  /// Validated against the attempt's assigned question set, else null.
  questionId          String?

  createdAt           DateTime @default(now())

  /// Idempotency: a retried completion must not create a second asset.
  @@unique([proctoringSessionId, type, sequence])
  @@index([proctoringSessionId, capturedAt])
  @@index([expiresAt, status])
}

/// A proctoring observation. Evidence for a human reviewer - never a verdict, and
/// never an input to scoring. Raw frames and face landmarks are never stored.
model ProctoringEvent {
  id                  String   @id @default(cuid())
  proctoringSessionId String
  session             ProctoringSession @relation(fields: [proctoringSessionId], references: [id], onDelete: Cascade)

  type                ProctoringEventType
  /// LEFT / RIGHT / UP / DOWN for gaze events, else null.
  direction           String?
  /// Client clock, for ordering within a batch.
  occurredAt          DateTime
  /// Server receipt time. Authoritative when the two disagree.
  receivedAt          DateTime @default(now())
  elapsedMs           Int?
  durationMs          Int?
  severity            String   @default("INFO")
  questionId          String?
  metadata            Json?

  /// Client-generated, for dedup across batch retries.
  clientEventId       String

  createdAt           DateTime @default(now())

  @@unique([proctoringSessionId, clientEventId])
  @@index([proctoringSessionId, occurredAt])
  @@index([type])
}
```

- [ ] **Step 7: Add back-relations to both attempt models**

In `model TestAttempt`, alongside `responses`:

```prisma
  proctoringSession ProctoringSession?
```

In `model WalkInAttempt`, alongside `responses`:

```prisma
  proctoringSession ProctoringSession?
```

- [ ] **Step 8: Generate the migration without applying it**

```bash
npx prisma migrate dev --name add_proctoring --create-only
```

- [ ] **Step 9: Hand-edit the migration to add the CHECK constraint**

Prisma cannot express a CHECK. Append to the generated `migration.sql`:

```sql
-- Exactly one attempt FK must be set. Without this a session could reference
-- both kinds, or neither, and every downstream query would have to defend
-- against a state the schema allowed.
ALTER TABLE "ProctoringSession"
  ADD CONSTRAINT "ProctoringSession_exactly_one_attempt"
  CHECK (
    ("testAttemptId" IS NOT NULL AND "walkInAttemptId" IS NULL)
    OR
    ("testAttemptId" IS NULL AND "walkInAttemptId" IS NOT NULL)
  );
```

- [ ] **Step 10: Apply to local Postgres and regenerate**

```bash
npx prisma migrate dev
```

```bash
npx prisma generate
```

- [ ] **Step 11: Prove the CHECK actually fires**

A schema that merely *declares* the invariant is worth nothing; confirm the
database enforces it. Run this and confirm it reports a rejection:

```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$executeRawUnsafe(\`INSERT INTO \\\"ProctoringSession\\\" (\\\"id\\\",\\\"retentionExpiresAt\\\",\\\"updatedAt\\\") VALUES ('chk1',NOW(),NOW())\`).then(()=>{console.log('FAIL: constraint did not fire');process.exit(1)}).catch(e=>{console.log('OK: rejected -',e.message.split('\n').pop());process.exit(0)})"
```

Expected: `OK: rejected - ...ProctoringSession_exactly_one_attempt...`

If it inserts, the CHECK did not apply — fix the migration before continuing.
Every downstream part assumes this invariant holds.

- [ ] **Step 12: Write `src/lib/proctoring/config.ts`**

Validated and coerced at module load with zod. The app has no env validation
today; this is the first. Defaults are the PRD's.

```ts
import { z } from 'zod'

/**
 * Proctoring configuration, read once and validated.
 *
 * Every value has a default, so a deployment that sets nothing still boots with
 * the PRD's intended behaviour. What must not be defaulted is R2 credentials -
 * see getR2Config, which throws rather than silently falling back to mock.
 */

export const PROCTORING_VERSION = '1'

/** Coerce "true"/"1" to true; anything else (including unset) uses the default. */
const bool = (dflt: boolean) =>
  z.string().optional().transform(v => (v === undefined ? dflt : v === 'true' || v === '1'))

const int = (dflt: number, min: number, max: number) =>
  z.string().optional().transform(v => (v === undefined ? dflt : Number(v)))
    .pipe(z.number().int().min(min).max(max))

const schema = z.object({
  PROCTORING_ENABLED: bool(false),
  PROCTORING_OPERATIONAL: bool(true),
  PROCTORING_STORAGE_PROVIDER: z.enum(['r2', 'mock']).default('mock'),

  PROCTORING_SCREENSHOT_INTERVAL_MS: int(60_000, 10_000, 600_000),
  PROCTORING_VIDEO_SEGMENT_MS: int(300_000, 30_000, 900_000),
  PROCTORING_RETENTION_HOURS: int(72, 1, 720),
  PROCTORING_MAX_DURATION_MINUTES: int(180, 5, 480),

  PROCTORING_GAZE_WARNING_MS: int(1_500, 200, 30_000),
  PROCTORING_GAZE_WARNING_COOLDOWN_MS: int(10_000, 1_000, 120_000),
  PROCTORING_FACE_MISSING_WARNING_MS: int(3_000, 500, 60_000),
  PROCTORING_MULTIPLE_FACES_WARNING_MS: int(3_000, 500, 60_000),

  PROCTORING_SCREEN_REQUIRED: bool(true),

  // 7 GB. Note this allows roughly 75 proctored attempts per rolling 3-day
  // window, because media is held for the full retention period - it does not
  // free up at submission. See README section 2 before changing.
  PROCTORING_STORAGE_SAFETY_BYTES: int(7_000_000_000, 100_000_000, 500_000_000_000),
  PROCTORING_MAX_SCREENSHOT_BYTES: int(250_000, 20_000, 5_000_000),
  PROCTORING_MAX_VIDEO_BYTES_PER_ATTEMPT: int(500_000_000, 10_000_000, 2_000_000_000),
  PROCTORING_ESTIMATED_SCREENSHOT_BYTES: int(100_000, 10_000, 1_000_000),

  PROCTORING_VIDEO_BITS_PER_SECOND: int(160_000, 32_000, 2_000_000),
  PROCTORING_AUDIO_BITS_PER_SECOND: int(32_000, 8_000, 256_000),
  // Reservation headroom over the raw estimate, as a percentage.
  PROCTORING_SAFETY_MULTIPLIER_PCT: int(120, 100, 300),

  PROCTORING_HEARTBEAT_INTERVAL_MS: int(20_000, 5_000, 120_000),
  // A session with no heartbeat for this long is treated as abandoned.
  PROCTORING_STALE_SESSION_MS: int(180_000, 60_000, 3_600_000),

  R2_PRESIGNED_UPLOAD_TTL_SECONDS: int(300, 60, 3_600),
  R2_PRESIGNED_DOWNLOAD_TTL_SECONDS: int(900, 60, 3_600),
})

export interface ProctoringConfig {
  enabled: boolean
  operational: boolean
  storageProvider: 'r2' | 'mock'
  screenshotIntervalMs: number
  videoSegmentMs: number
  retentionHours: number
  maxDurationMinutes: number
  gazeWarningMs: number
  gazeWarningCooldownMs: number
  faceMissingWarningMs: number
  multipleFacesWarningMs: number
  screenRequired: boolean
  storageSafetyBytes: number
  maxScreenshotBytes: number
  maxVideoBytesPerAttempt: number
  estimatedScreenshotBytes: number
  videoBitsPerSecond: number
  audioBitsPerSecond: number
  safetyMultiplier: number
  presignedUploadTtlSeconds: number
  presignedDownloadTtlSeconds: number
  heartbeatIntervalMs: number
  staleSessionMs: number
  version: string
}

let cached: ProctoringConfig | null = null

export function getProctoringConfig(): ProctoringConfig {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    // Fail loudly at boot rather than producing nonsense byte budgets at runtime.
    const detail = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid proctoring configuration: ${detail}`)
  }
  const e = parsed.data
  cached = {
    enabled: e.PROCTORING_ENABLED,
    operational: e.PROCTORING_OPERATIONAL,
    storageProvider: e.PROCTORING_STORAGE_PROVIDER,
    screenshotIntervalMs: e.PROCTORING_SCREENSHOT_INTERVAL_MS,
    videoSegmentMs: e.PROCTORING_VIDEO_SEGMENT_MS,
    retentionHours: e.PROCTORING_RETENTION_HOURS,
    maxDurationMinutes: e.PROCTORING_MAX_DURATION_MINUTES,
    gazeWarningMs: e.PROCTORING_GAZE_WARNING_MS,
    gazeWarningCooldownMs: e.PROCTORING_GAZE_WARNING_COOLDOWN_MS,
    faceMissingWarningMs: e.PROCTORING_FACE_MISSING_WARNING_MS,
    multipleFacesWarningMs: e.PROCTORING_MULTIPLE_FACES_WARNING_MS,
    screenRequired: e.PROCTORING_SCREEN_REQUIRED,
    storageSafetyBytes: e.PROCTORING_STORAGE_SAFETY_BYTES,
    maxScreenshotBytes: e.PROCTORING_MAX_SCREENSHOT_BYTES,
    maxVideoBytesPerAttempt: e.PROCTORING_MAX_VIDEO_BYTES_PER_ATTEMPT,
    estimatedScreenshotBytes: e.PROCTORING_ESTIMATED_SCREENSHOT_BYTES,
    videoBitsPerSecond: e.PROCTORING_VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: e.PROCTORING_AUDIO_BITS_PER_SECOND,
    safetyMultiplier: e.PROCTORING_SAFETY_MULTIPLIER_PCT / 100,
    presignedUploadTtlSeconds: e.R2_PRESIGNED_UPLOAD_TTL_SECONDS,
    presignedDownloadTtlSeconds: e.R2_PRESIGNED_DOWNLOAD_TTL_SECONDS,
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

export interface R2Config {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
}

const r2Schema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_ENDPOINT: z.string().url().optional(),
})

/**
 * R2 credentials. Throws when the provider is r2 and anything is missing.
 *
 * Deliberately not defaulted: silently falling back to mock storage in
 * production would mean evidence is accepted, reported as stored, and lost.
 */
export function getR2Config(): R2Config {
  const parsed = r2Schema.safeParse(process.env)
  if (!parsed.success) {
    const missing = parsed.error.issues.map(i => i.path.join('.')).join(', ')
    throw new Error(`R2 storage selected but not configured. Missing or invalid: ${missing}`)
  }
  const e = parsed.data
  return {
    accountId: e.R2_ACCOUNT_ID,
    bucket: e.R2_BUCKET_NAME,
    accessKeyId: e.R2_ACCESS_KEY_ID,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    endpoint: e.R2_ENDPOINT ?? `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  }
}
```

- [ ] **Step 13: Write `src/lib/proctoring/types.ts`**

Shared types used by both server and client. Keep it free of any server-only
import so the client can use it without dragging Prisma into the bundle.

```ts
export type AttemptKind = 'scheduled' | 'walkin'

export type GazeDirection =
  | 'CENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
  | 'FACE_NOT_DETECTED' | 'MULTIPLE_FACES' | 'UNCERTAIN'

export type ProctoringClientState =
  | 'IDLE' | 'CHECKING_DEVICES' | 'AWAITING_PERMISSION' | 'READY'
  | 'STARTING' | 'ACTIVE' | 'DEGRADED' | 'FINALIZING' | 'COMPLETED'
  | 'PERMISSION_DENIED' | 'SCREEN_SHARE_STOPPED' | 'CAMERA_STOPPED'
  | 'MICROPHONE_STOPPED' | 'UPLOAD_DEGRADED' | 'NETWORK_OFFLINE'
  | 'UNSUPPORTED_BROWSER' | 'STORAGE_UNAVAILABLE' | 'EXPIRED'

export type UploadState = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'EXPIRED'

/** Structured result from the quota gate. Never collapse this to a boolean. */
export interface StartEligibility {
  allowed: boolean
  reason:
    | 'OK'
    | 'PROCTORING_DISABLED'
    | 'PROCTORING_NOT_OPERATIONAL'
    | 'PROCTORING_STORAGE_NOT_CONFIGURED'
    | 'PROCTORING_STORAGE_LIMIT_REACHED'
    | 'PROCTORING_DURATION_INVALID'
  estimatedBytes: number
  remainingBudget: number
}
```

- [ ] **Step 14: Add the variables to `.env.example`**

Match the file's existing style — explain *why*, not just *what*. Append:

```bash
# ---------------------------------------------------------------------------
# Proctoring (optional feature, off by default)
#
# Proctoring is opt-in per test via Test.proctoringEnabled. With
# PROCTORING_ENABLED unset, no test can be proctored regardless of that column,
# so this is the global kill switch.
#
# Every value below has a sane default in src/lib/proctoring/config.ts - you
# only need to set what you want to change. R2 credentials are the exception:
# with PROCTORING_STORAGE_PROVIDER=r2 they are required and the app throws
# rather than silently falling back to mock storage and losing evidence.
PROCTORING_ENABLED="false"

# Set false to stop new proctored attempts without a deploy - existing ones
# still finalize. Use during an incident rather than hiding the outage.
PROCTORING_OPERATIONAL="true"

# r2 = real Cloudflare R2. mock = in-memory, for tests and local work without
# credentials. Never set mock in production.
PROCTORING_STORAGE_PROVIDER="mock"

# Storage safety budget, in bytes. 7 GB.
#
# IMPORTANT: this allows roughly 75 proctored attempts per rolling 3-day
# window, not 75 at a time. A reservation is released when an attempt
# finishes, but the media it produced is held for the full retention period,
# so storage does not free up at submission - it frees up 72 hours later.
# Staggering a large batch into waves does not help.
#
# At defaults one attempt stores ~92 MB (60 min of 160 kbps video + 32 kbps
# audio = 86.4 MB, plus 60 screenshots at ~100 KB = 6 MB).
#
# To buy headroom without raising this: lower
# PROCTORING_VIDEO_BITS_PER_SECOND, shorten PROCTORING_RETENTION_HOURS, or
# lengthen PROCTORING_SCREENSHOT_INTERVAL_MS.
PROCTORING_STORAGE_SAFETY_BYTES="7000000000"

# Capture cadence and recording shape.
PROCTORING_SCREENSHOT_INTERVAL_MS="60000"
PROCTORING_VIDEO_SEGMENT_MS="300000"
PROCTORING_VIDEO_BITS_PER_SECOND="160000"
PROCTORING_AUDIO_BITS_PER_SECOND="32000"

# Retention. The application refuses access at exactly this age; R2's own
# lifecycle rule deletes the bytes somewhat later. Both are needed - see the
# proctoring architecture doc.
PROCTORING_RETENTION_HOURS="72"

# Gaze and face thresholds. All sustained, never single-frame. A gaze event is
# evidence for a reviewer, never an automatic failure.
PROCTORING_GAZE_WARNING_MS="1500"
PROCTORING_GAZE_WARNING_COOLDOWN_MS="10000"
PROCTORING_FACE_MISSING_WARNING_MS="3000"
PROCTORING_MULTIPLE_FACES_WARNING_MS="3000"

# Per-asset ceilings, enforced server-side after upload via HeadObject. The
# browser's reported size is never trusted.
PROCTORING_MAX_SCREENSHOT_BYTES="250000"
PROCTORING_MAX_VIDEO_BYTES_PER_ATTEMPT="500000000"
PROCTORING_ESTIMATED_SCREENSHOT_BYTES="100000"

# Hard ceiling on a proctored attempt regardless of the test's own duration.
PROCTORING_MAX_DURATION_MINUTES="180"
PROCTORING_SCREEN_REQUIRED="true"
PROCTORING_HEARTBEAT_INTERVAL_MS="20000"
PROCTORING_STALE_SESSION_MS="180000"

# Cloudflare R2. Required only when PROCTORING_STORAGE_PROVIDER=r2.
# Create a token scoped to this one bucket with Object Read & Write - not an
# account-wide token. The bucket must stay private; access is always through a
# short-lived presigned URL.
# R2_ENDPOINT defaults to https://<account id>.r2.cloudflarestorage.com and
# only needs setting for a custom or jurisdiction-specific endpoint.
R2_ACCOUNT_ID=""
R2_BUCKET_NAME=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_ENDPOINT=""
R2_PRESIGNED_UPLOAD_TTL_SECONDS="300"
R2_PRESIGNED_DOWNLOAD_TTL_SECONDS="900"

# Shared secret for the retention cleanup endpoint, called by the scheduled
# GitHub workflow. Generate with: openssl rand -base64 32
CRON_SECRET=""
```

- [ ] **Step 15: Write the failing test**

`tests/proctoring-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getProctoringConfig, getR2Config, resetProctoringConfigForTests } from '@/lib/proctoring/config'

/**
 * Configuration is the first thing every other module reads. A silently wrong
 * byte budget or threshold would not surface until a candidate is mid-assessment,
 * so the coercion and the bounds are locked here.
 */

const saved = { ...process.env }

beforeEach(() => { resetProctoringConfigForTests() })
afterEach(() => { process.env = { ...saved }; resetProctoringConfigForTests() })

describe('getProctoringConfig', () => {
  it('defaults to disabled, mock storage, and the PRD thresholds', () => {
    delete process.env.PROCTORING_ENABLED
    delete process.env.PROCTORING_STORAGE_PROVIDER
    delete process.env.PROCTORING_GAZE_WARNING_MS
    const c = getProctoringConfig()
    expect(c.enabled).toBe(false)
    expect(c.storageProvider).toBe('mock')
    expect(c.gazeWarningMs).toBe(1500)
    expect(c.gazeWarningCooldownMs).toBe(10_000)
    expect(c.retentionHours).toBe(72)
    expect(c.storageSafetyBytes).toBe(7_000_000_000)
  })

  it('coerces numeric strings rather than leaving them as strings', () => {
    process.env.PROCTORING_GAZE_WARNING_MS = '2500'
    const c = getProctoringConfig()
    expect(c.gazeWarningMs).toBe(2500)
    expect(typeof c.gazeWarningMs).toBe('number')
  })

  it('converts the safety multiplier from percent to a factor', () => {
    process.env.PROCTORING_SAFETY_MULTIPLIER_PCT = '150'
    expect(getProctoringConfig().safetyMultiplier).toBe(1.5)
  })

  it('treats "true" and "1" as true and everything else as false', () => {
    process.env.PROCTORING_ENABLED = '1'
    expect(getProctoringConfig().enabled).toBe(true)
    resetProctoringConfigForTests()
    process.env.PROCTORING_ENABLED = 'no'
    expect(getProctoringConfig().enabled).toBe(false)
  })

  it('throws on an out-of-range value instead of using it', () => {
    // A 10ms gaze threshold would fire a warning on every frame.
    process.env.PROCTORING_GAZE_WARNING_MS = '10'
    expect(() => getProctoringConfig()).toThrow(/Invalid proctoring configuration/)
  })

  it('throws on a non-numeric value instead of coercing to NaN', () => {
    process.env.PROCTORING_RETENTION_HOURS = 'seventy-two'
    expect(() => getProctoringConfig()).toThrow(/Invalid proctoring configuration/)
  })
})

describe('getR2Config', () => {
  it('throws when credentials are missing, rather than falling back', () => {
    delete process.env.R2_ACCOUNT_ID
    delete process.env.R2_BUCKET_NAME
    delete process.env.R2_ACCESS_KEY_ID
    delete process.env.R2_SECRET_ACCESS_KEY
    expect(() => getR2Config()).toThrow(/not configured/)
  })

  it('derives the endpoint from the account id when none is given', () => {
    process.env.R2_ACCOUNT_ID = 'abc123'
    process.env.R2_BUCKET_NAME = 'bucket'
    process.env.R2_ACCESS_KEY_ID = 'key'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    delete process.env.R2_ENDPOINT
    expect(getR2Config().endpoint).toBe('https://abc123.r2.cloudflarestorage.com')
  })
})
```

- [ ] **Step 16: Run it**

```bash
npx vitest run tests/proctoring-config.test.ts
```

Expected: all pass. If `R2_ENDPOINT=""` in your local `.env` leaks in as an empty
string and fails the `.url()` check, that is a real finding — change the schema to
`z.string().url().optional().or(z.literal(''))` and treat empty as unset.

- [ ] **Step 17: Typecheck and run the whole suite**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

Both must be clean. The existing suite must still pass — this part adds columns
and models but changes no behaviour.

- [ ] **Step 18: Confirm nothing leaked into the client bundle**

```bash
grep -rn "R2_SECRET_ACCESS_KEY\|R2_ACCESS_KEY_ID" src/app src/components 2>/dev/null || echo "clean: no R2 credentials referenced in app or component code"
```

- [ ] **Step 19: Commit**

```bash
git add -A && git commit -m "proctoring part 1: schema, migration, and validated config"
```

Do not push.

- [ ] **Step 20: Update `PROGRESS.md`** — mark Part 1 done with the commit hash,
      and note anything surprising in Notes.

---

## Done when

- `npx prisma migrate status` reports the local database up to date.
- The CHECK constraint demonstrably rejects a session with neither FK set.
- `npx tsc --noEmit -p tsconfig.json` is clean.
- `npm test` passes in full.
- A local commit exists on `feat/proctoring`; nothing pushed.
