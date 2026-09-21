# Part 5 — Upload APIs

**Delivers:** presigned upload URL issuance, upload completion with server-side
size verification, admin download URLs, and the rate limiter. This is where the
"never trust the client" rules become real.

**Files**
- Create: `src/lib/proctoring/rate-limit.ts`
- Create: `src/lib/proctoring/upload.ts` (service)
- Create: `src/app/api/student/proctoring/upload-url/route.ts`
- Create: `src/app/api/student/proctoring/asset-complete/route.ts`
- Create: `src/app/api/admin/proctoring/assets/[id]/download-url/route.ts`
- Modify: `src/lib/proctoring/schemas.ts`
- Create: `tests/proctoring-upload-api.test.ts`
- Create: `tests/proctoring-rate-limit.test.ts`

**Interfaces — Consumes**
Part 2 `getStorage()`, `webcamSegmentKey`, `screenshotKey`.
Part 3 config. Part 4 `resolveOwnedAttempt`, `activeSessionFor`, `parseBody`,
`requireAdmin`.

**Interfaces — Produces**

```ts
export function rateLimit(key: string, limit: number, windowMs: number): boolean
export async function issueUploadUrl(...): Promise<{ assetId, uploadUrl, objectKey, expiresAt }>
export async function completeAsset(...): Promise<{ assetId, byteSize, status }>
export async function issueDownloadUrl(assetId: string): Promise<string>
```

---

## The five checks before a URL is signed

PRD §40 lists them; they are easy to half-implement. All five, every time:

1. The attempt belongs to the authenticated student (`resolveOwnedAttempt`).
2. A live session exists for it (`activeSessionFor`).
3. The sequence is a positive integer within bounds.
4. The content type is on the allow-list for the asset type.
5. The session's reservation has not already been exceeded.

And after the upload: **`HeadObject` decides the size, not the client.** A client
that claims 40 KB and uploads 400 MB must be caught here, and the oversized
object deleted rather than counted.

---

## The rate limiter is in-process and that is a real limitation

Render's free plan runs one instance, so an in-memory limiter is effective today.
It is **not** effective across instances, and it resets on every deploy and on
cold start after the free tier spins down. Say so in the code rather than
implying a guarantee that does not hold. It raises the cost of abuse; it does not
eliminate it.

---

## Steps

- [ ] **Step 1: Write `src/lib/proctoring/rate-limit.ts`**

```ts
/**
 * Fixed-window, in-process rate limiting.
 *
 * Scope and honesty about it: this runs in one Node process. Render's free plan
 * is single-instance so it is effective there, but it does not coordinate across
 * instances and its state is lost on deploy and on cold start. It raises the
 * cost of hammering an endpoint; it is not an authorization control, and nothing
 * downstream may rely on it for correctness.
 *
 * Fixed window rather than sliding: a sliding log would retain a timestamp per
 * request per key, which is unbounded memory for an endpoint a hostile client
 * controls. The window boundary lets through at most 2x the limit in a burst,
 * which is an acceptable trade for O(1) memory per key.
 */

interface Window { count: number; resetAt: number }

const windows = new Map<string, Window>()
/** Bound the map so a client cycling keys cannot exhaust memory. */
const MAX_KEYS = 10_000

/** True when the call is allowed; false when it should be refused. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const existing = windows.get(key)

  if (!existing || now >= existing.resetAt) {
    if (windows.size >= MAX_KEYS) evictExpired(now)
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (existing.count >= limit) return false
  existing.count++
  return true
}

function evictExpired(now: number): void {
  for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k)
  // Still full of live windows: drop the oldest rather than grow without bound.
  if (windows.size >= MAX_KEYS) {
    const oldest = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt).slice(0, MAX_KEYS / 2)
    for (const [k] of oldest) windows.delete(k)
  }
}

export function resetRateLimitsForTests(): void { windows.clear() }
```

- [ ] **Step 2: Write `tests/proctoring-rate-limit.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, resetRateLimitsForTests } from '@/lib/proctoring/rate-limit'

describe('rateLimit', () => {
  beforeEach(() => resetRateLimitsForTests())

  it('allows up to the limit then refuses', () => {
    for (let i = 0; i < 5; i++) expect(rateLimit('k', 5, 1000, 0)).toBe(true)
    expect(rateLimit('k', 5, 1000, 0)).toBe(false)
  })

  it('opens a fresh window once the old one expires', () => {
    for (let i = 0; i < 5; i++) rateLimit('k', 5, 1000, 0)
    expect(rateLimit('k', 5, 1000, 999)).toBe(false)
    expect(rateLimit('k', 5, 1000, 1000)).toBe(true)
  })

  it('keys are independent', () => {
    for (let i = 0; i < 5; i++) rateLimit('a', 5, 1000, 0)
    expect(rateLimit('a', 5, 1000, 0)).toBe(false)
    expect(rateLimit('b', 5, 1000, 0)).toBe(true)
  })
})
```

- [ ] **Step 3: Extend `src/lib/proctoring/schemas.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/lib/proctoring/upload.ts`**

```ts
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
```

- [ ] **Step 5: Write the upload-url route**

`src/app/api/student/proctoring/upload-url/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse, HttpError } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { uploadUrlSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor } from '@/lib/proctoring/session'
import { issueUploadUrl } from '@/lib/proctoring/upload'
import { rateLimit } from '@/lib/proctoring/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()

    // Generous relative to legitimate use - one segment per 5 minutes plus one
    // screenshot per minute is well under 20/min even with retries.
    if (!rateLimit(`upload-url:${student.studentId}`, 40, 60_000)) {
      throw new HttpError(429, 'Too many upload requests. Please wait a moment.')
    }

    const body = await parseBody(req, uploadUrlSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    if (!session) throw new HttpError(409, 'No active proctoring session')

    // Question correlation is client-supplied, so validate membership in the
    // assigned set exactly as violation/route.ts does. Never trust it blind.
    const questionId =
      body.questionId && attempt.questionIds.includes(body.questionId) ? body.questionId : null

    const issued = await issueUploadUrl({
      sessionId: session.id,
      type: body.type,
      sequence: body.sequence,
      contentType: body.contentType,
      capturedAt: new Date(body.capturedAt),
      elapsedMs: body.elapsedMs,
      questionId,
      retentionExpiresAt: session.retentionExpiresAt,
    })

    return NextResponse.json({
      assetId: issued.assetId,
      uploadUrl: issued.uploadUrl,
      expiresAt: issued.expiresAt,
    })
  } catch (err) {
    return errorResponse(err, 'Proctoring upload-url error', 'Could not prepare the upload.')
  }
}
```

Note the response does **not** include `objectKey`. The client has no use for it
and exposing the key surface serves no purpose.

- [ ] **Step 6: Write the asset-complete route**

`src/app/api/student/proctoring/asset-complete/route.ts` — same skeleton:
`requireStudent` → rate limit → `parseBody(assetCompleteSchema)` →
`resolveOwnedAttempt` → `activeSessionFor` → `completeAsset(body.assetId, session.id)`
→ `NextResponse.json({ ok: true, byteSize, status })`, all inside the
`errorResponse` funnel.

- [ ] **Step 7: Write the admin download-url route**

`src/app/api/admin/proctoring/assets/[id]/download-url/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { issueDownloadUrl } from '@/lib/proctoring/upload'

/**
 * Admin-only. The returned URL is a bearer token for the object: short-lived,
 * never logged, never persisted, and never handed to a candidate.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    const url = await issueDownloadUrl(params.id)
    return NextResponse.json({ url })
  } catch (err) {
    return errorResponse(err, 'Proctoring download-url error', 'Could not prepare the download.')
  }
}
```

- [ ] **Step 8: Write `tests/proctoring-upload-api.test.ts`**

Against `MockStorage`. Cover:

```
issueUploadUrl
  - signs a URL and creates a PENDING asset
  - is idempotent on (session, type, sequence) - no duplicate asset
  - refuses a content type outside the allow-list, per asset type
  - refuses re-issuing for an already UPLOADED asset (409)
  - refuses when the session is far past its reservation (409)

completeAsset
  - records the size HeadObject reports, not any client claim
  - increments the session's storageUsedBytes by that size
  - is idempotent: a second completion returns the stored result, does not double-count
  - marks FAILED and throws when the object is absent from storage
  - deletes the object and throws 413 when it exceeds the size limit

issueDownloadUrl
  - returns a URL for an UPLOADED, unexpired asset
  - throws 410 for an asset past expiresAt, AND flips its status to EXPIRED
  - throws 409 for a PENDING asset
```

The oversize case is the important one — write it so it would fail if the size
check used a client-supplied number:

```ts
it('records the size storage reports, not the one a client might claim', async () => {
  storage.putForTest(objectKey, 400_000_000, 'image/webp') // client "claimed" 40 KB
  await expect(completeAsset(assetId, sessionId)).rejects.toMatchObject({ status: 413 })
  expect(storage.has(objectKey)).toBe(false) // deleted, not merely rejected
})
```

- [ ] **Step 9: Run the tests**

```bash
npx vitest run tests/proctoring-upload-api.test.ts tests/proctoring-rate-limit.test.ts
```

- [ ] **Step 10: Typecheck and full suite**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "proctoring part 5: presigned upload and download APIs with size enforcement"
```

Do not push.

- [ ] **Step 12: Update `PROGRESS.md`.**

---

## Done when

- All five pre-sign checks are implemented and individually tested.
- Size comes from `HeadObject`; an oversize object is deleted, not counted.
- Completion is idempotent and does not double-count bytes.
- An expired asset is refused a URL **and** flipped to `EXPIRED`.
- The rate limiter's single-instance limitation is documented in the code.
