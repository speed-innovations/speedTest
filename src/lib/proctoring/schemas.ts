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
