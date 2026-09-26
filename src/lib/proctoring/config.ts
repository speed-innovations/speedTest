import { z } from 'zod'

/**
 * Proctoring configuration, read once and validated.
 *
 * Metadata-only: proctoring stores no media, so there is no storage provider,
 * no byte budget and no credential here - and a deployment with none of those
 * set runs proctoring normally. Every value has a default.
 *
 * Detection thresholds are not here. They are client tuning in
 * client/detection-config.ts, and must never appear in an API response.
 */

// Bumped: detection moved to fusion + temporal engine (live-monitoring phase).
export const PROCTORING_VERSION = '2'

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

  PROCTORING_SCREEN_REQUIRED: bool(true),
  PROCTORING_HEARTBEAT_INTERVAL_MS: int(20_000, 5_000, 120_000),
  // A session with no heartbeat for this long is treated as abandoned.
  PROCTORING_STALE_SESSION_MS: int(180_000, 60_000, 3_600_000),
})

export interface ProctoringConfig {
  enabled: boolean
  operational: boolean
  retentionHours: number
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
