import { z } from 'zod'
import { CLIENT_EVENT_TYPES } from './event-types'

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
