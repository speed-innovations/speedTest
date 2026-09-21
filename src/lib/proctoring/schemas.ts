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
