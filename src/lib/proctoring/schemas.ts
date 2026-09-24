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
  screenSharing: z.boolean(),
  cameraLive: z.boolean(),
  micLive: z.boolean(),
  clientVersion: z.string().max(32).optional(),
})

export const finalizeSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  parentId: idSchema,
})

export const eventTypeSchema = z.enum([
  'GAZE_LEFT', 'GAZE_RIGHT', 'GAZE_UP', 'GAZE_DOWN',
  'FACE_NOT_DETECTED', 'MULTIPLE_FACES_DETECTED',
  'SCREEN_SHARE_STOPPED', 'SCREEN_SHARE_RESUMED',
  'CAMERA_STOPPED', 'MICROPHONE_STOPPED',
  'TAB_HIDDEN', 'WINDOW_BLURRED',
  'PROCTORING_STARTED', 'PROCTORING_ENDED',
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
