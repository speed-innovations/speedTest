import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/attempt-auth'
import { getStorage } from './storage'
import { webcamSegmentKey, screenshotKey } from './storage/keys'
import { getProctoringConfig } from './config'
import { WEBCAM_CONTENT_TYPES, SCREENSHOT_CONTENT_TYPES } from './schemas'

/**
 * Upload issuance and verification.
 *
 * The invariant: the server decides the object key, the allowed content type,
 * and the recorded size. The client supplies a sequence number and nothing else
 * that reaches storage.
 */

type AssetType = 'WEBCAM_SEGMENT' | 'SCREENSHOT'

function assertContentType(type: AssetType, contentType: string): void {
  const allowed: readonly string[] =
    type === 'WEBCAM_SEGMENT' ? WEBCAM_CONTENT_TYPES : SCREENSHOT_CONTENT_TYPES
  // Compare on the base type: browsers append codec parameters inconsistently.
  const base = contentType.split(';')[0].trim().toLowerCase()
  if (!allowed.some(a => a.split(';')[0] === base)) {
    throw new HttpError(400, `Content type not allowed for ${type}`)
  }
}

function keyFor(type: AssetType, sessionId: string, sequence: number, contentType: string): string {
  if (type === 'WEBCAM_SEGMENT') return webcamSegmentKey(sessionId, sequence)
  const ext = contentType.includes('jpeg') ? 'jpg' : 'webp'
  return screenshotKey(sessionId, sequence, ext)
}

export interface IssuedUpload {
  assetId: string
  uploadUrl: string
  objectKey: string
  expiresAt: Date
}

export async function issueUploadUrl(params: {
  sessionId: string
  type: AssetType
  sequence: number
  contentType: string
  capturedAt: Date
  elapsedMs?: number
  questionId?: string | null
  retentionExpiresAt: Date
}): Promise<IssuedUpload> {
  const cfg = getProctoringConfig()
  assertContentType(params.type, params.contentType)

  const session = await prisma.proctoringSession.findUniqueOrThrow({
    where: { id: params.sessionId },
    select: { storageReservedBytes: true, storageUsedBytes: true },
  })

  // Refuse before signing if this session has already blown past what it
  // reserved. Without this a looping client could upload indefinitely.
  if (session.storageUsedBytes > session.storageReservedBytes * 1.5) {
    throw new HttpError(409, 'PROCTORING_SESSION_STORAGE_EXCEEDED')
  }

  const objectKey = keyFor(params.type, params.sessionId, params.sequence, params.contentType)

  // Idempotent on (session, type, sequence): a retried request for the same
  // segment must reuse the row and re-sign, never create a second asset.
  const asset = await prisma.proctoringAsset.upsert({
    where: {
      proctoringSessionId_type_sequence: {
        proctoringSessionId: params.sessionId,
        type: params.type,
        sequence: params.sequence,
      },
    },
    create: {
      proctoringSessionId: params.sessionId,
      type: params.type,
      objectKey,
      contentType: params.contentType,
      sequence: params.sequence,
      capturedAt: params.capturedAt,
      expiresAt: params.retentionExpiresAt,
      elapsedMs: params.elapsedMs ?? null,
      questionId: params.questionId ?? null,
      status: 'PENDING',
    },
    // Only the fields a retry may legitimately change. Never reset status here:
    // a retry after a successful upload must not mark the asset PENDING again.
    update: { contentType: params.contentType },
    select: { id: true, objectKey: true, status: true },
  })

  if (asset.status === 'UPLOADED') throw new HttpError(409, 'Asset already uploaded')

  // Sign the STORED key, not the one just derived: on a retry that changed the
  // screenshot format the derived extension would differ from the object the
  // asset row already points at, and the two would drift apart.
  const uploadUrl = await getStorage().createUploadUrl(
    asset.objectKey,
    params.contentType,
    cfg.presignedUploadTtlSeconds
  )

  return {
    assetId: asset.id,
    uploadUrl,
    objectKey: asset.objectKey,
    expiresAt: new Date(Date.now() + cfg.presignedUploadTtlSeconds * 1000),
  }
}

export interface CompletedAsset {
  assetId: string
  byteSize: number
  status: 'UPLOADED' | 'FAILED'
}

/**
 * Confirm an upload landed, and record the size the store reports.
 *
 * The client's claimed size is never accepted - it is not asked for. An object
 * that exceeds policy is deleted rather than counted, because leaving it would
 * consume budget that the reservation did not cover.
 */
export async function completeAsset(assetId: string, sessionId: string): Promise<CompletedAsset> {
  const cfg = getProctoringConfig()
  const asset = await prisma.proctoringAsset.findFirst({
    where: { id: assetId, proctoringSessionId: sessionId },
  })
  if (!asset) throw new HttpError(404, 'Asset not found')

  // Idempotent: a duplicate completion returns the stored result.
  if (asset.status === 'UPLOADED') {
    return { assetId: asset.id, byteSize: asset.byteSize, status: 'UPLOADED' }
  }

  const storage = getStorage()
  const meta = await storage.getObjectMetadata(asset.objectKey)
  if (!meta) {
    await prisma.proctoringAsset.update({ where: { id: asset.id }, data: { status: 'FAILED' } })
    throw new HttpError(409, 'Upload not found in storage')
  }

  const limit = asset.type === 'SCREENSHOT' ? cfg.maxScreenshotBytes : cfg.maxVideoBytesPerAttempt
  if (meta.byteSize > limit) {
    await storage.deleteObject(asset.objectKey)
    await prisma.proctoringAsset.update({
      where: { id: asset.id },
      data: { status: 'FAILED', byteSize: 0 },
    })
    throw new HttpError(413, 'Asset exceeds the permitted size')
  }

  await prisma.$transaction([
    prisma.proctoringAsset.update({
      where: { id: asset.id },
      data: { status: 'UPLOADED', byteSize: meta.byteSize, uploadedAt: new Date() },
    }),
    prisma.proctoringSession.update({
      where: { id: sessionId },
      data: { storageUsedBytes: { increment: meta.byteSize } },
    }),
  ])

  return { assetId: asset.id, byteSize: meta.byteSize, status: 'UPLOADED' }
}

/**
 * Short-lived GET for admin review.
 *
 * Refuses past expiresAt even though R2's lifecycle rule may not have physically
 * deleted the object yet. The application's clock is what governs access.
 */
export async function issueDownloadUrl(assetId: string): Promise<string> {
  const cfg = getProctoringConfig()
  const asset = await prisma.proctoringAsset.findUnique({ where: { id: assetId } })
  if (!asset) throw new HttpError(404, 'Asset not found')

  if (asset.status !== 'UPLOADED') throw new HttpError(409, `Asset is ${asset.status.toLowerCase()}`)

  if (asset.expiresAt.getTime() <= Date.now()) {
    // Record what we observed, so the admin UI and the usage page agree.
    await prisma.proctoringAsset.update({ where: { id: asset.id }, data: { status: 'EXPIRED' } })
    throw new HttpError(410, 'Asset has passed its retention period')
  }

  return getStorage().createDownloadUrl(asset.objectKey, cfg.presignedDownloadTtlSeconds)
}
