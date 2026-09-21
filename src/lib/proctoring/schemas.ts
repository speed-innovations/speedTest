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

export const assetTypeSchema = z.enum(['WEBCAM_SEGMENT', 'SCREENSHOT'])

/** Allow-list per asset type. A signed URL is bound to one of these. */
export const WEBCAM_CONTENT_TYPES = ['video/webm', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/mp4'] as const
export const SCREENSHOT_CONTENT_TYPES = ['image/webp', 'image/jpeg'] as const

export const uploadUrlSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  parentId: idSchema,
  type: assetTypeSchema,
  sequence: z.number().int().min(1).max(999_999),
  contentType: z.string().min(1).max(128),
  capturedAt: z.string().datetime(),
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
  questionId: idSchema.optional(),
})

export const assetCompleteSchema = z.object({
  attemptId: idSchema,
  kind: attemptKindSchema,
  parentId: idSchema,
  assetId: idSchema,
})

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
