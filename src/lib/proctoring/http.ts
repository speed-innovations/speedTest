import type { ZodType } from 'zod'
import { HttpError } from '@/lib/attempt-auth'

/**
 * Parse and validate a JSON body, or throw an HttpError the existing
 * errorResponse funnel already knows how to render.
 *
 * The zod message is included because these are client-integration errors, not
 * internal failures - a developer hitting the endpoint needs to know which field
 * was wrong. Nothing here touches the database or reveals server state.
 */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const raw = await req.json().catch(() => null)
  if (raw === null) throw new HttpError(400, 'Request body must be valid JSON')
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(i => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ')
    throw new HttpError(400, `Invalid request: ${detail}`)
  }
  return parsed.data
}
