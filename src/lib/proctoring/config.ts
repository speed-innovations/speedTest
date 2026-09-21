import { z } from 'zod'

/**
 * Proctoring configuration, read once and validated.
 *
 * Every value has a default, so a deployment that sets nothing still boots with
 * the PRD's intended behaviour. What must not be defaulted is R2 credentials -
 * see getR2Config, which throws rather than silently falling back to mock.
 */

export const PROCTORING_VERSION = '1'

/**
 * Coerce "true"/"1" to true; anything else uses the default.
 *
 * An empty string counts as unset: .env.example ships several of these with
 * `VAR=""` placeholders, and dotenv loads that as '' rather than leaving the
 * key absent.
 */
const bool = (dflt: boolean) =>
  z.string().optional().transform(v => (v === undefined || v === '' ? dflt : v === 'true' || v === '1'))

const int = (dflt: number, min: number, max: number) =>
  z.string().optional().transform(v => (v === undefined || v === '' ? dflt : Number(v)))
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
  // Unset and "" both mean "derive it from the account id". .env.example ships
  // R2_ENDPOINT="" as a placeholder, and dotenv loads that as an empty string,
  // which would otherwise fail the URL check for a deployment that never
  // intended to set it.
  R2_ENDPOINT: z.union([z.string().url(), z.literal('')]).optional(),
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
    endpoint: e.R2_ENDPOINT ? e.R2_ENDPOINT : `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  }
}
