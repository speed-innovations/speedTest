# Part 2 — Storage abstraction

**Delivers:** one `ObjectStorage` interface with an R2 implementation and an
in-memory mock, plus the object-key builder. No routes yet — this is the layer
Part 5 signs URLs through.

**Files**
- Create: `src/lib/proctoring/storage/types.ts`
- Create: `src/lib/proctoring/storage/keys.ts`
- Create: `src/lib/proctoring/storage/r2.ts`
- Create: `src/lib/proctoring/storage/mock.ts`
- Create: `src/lib/proctoring/storage/index.ts`
- Create: `tests/proctoring-storage-keys.test.ts`
- Create: `tests/proctoring-storage-mock.test.ts`

**Interfaces — Consumes** (Part 1)
`getProctoringConfig()`, `getR2Config()` from `@/lib/proctoring/config`.

**Interfaces — Produces**

```ts
export interface ObjectMetadata { byteSize: number; contentType: string }
export interface ObjectStorage {
  createUploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<string>
  createDownloadUrl(key: string, ttlSeconds: number): Promise<string>
  getObjectMetadata(key: string): Promise<ObjectMetadata | null>
  deleteObject(key: string): Promise<void>
}
export function getStorage(): ObjectStorage        // memoised, provider from config
export function resetStorageForTests(): void

// keys.ts
export function webcamSegmentKey(sessionId: string, sequence: number): string
export function screenshotKey(sessionId: string, sequence: number, ext: 'webp' | 'jpg'): string
export function isProctoringKey(key: string): boolean
export const PROCTORING_PREFIX = 'assessment-proctoring/'
```

---

## Two things that will cost hours if missed

**1. The AWS SDK checksum default breaks R2 presigned PUTs.** SDK v3 ≥ 3.729
defaults `requestChecksumCalculation` to `WHEN_SUPPORTED`, which adds an
`x-amz-checksum-crc32` header. R2 rejects the signed request. The `S3Client` must
set `requestChecksumCalculation: 'WHEN_REQUIRED'`. The symptom is a 400 or 403
from R2 with an opaque message, long after the signing code looks correct.

**2. Never sign `ContentLength`.** Including it in the `PutObjectCommand` forces
the browser to send exactly that many bytes or the upload fails. The size is not
known precisely before encoding finishes, and more importantly, trusting a
client-declared size is what PRD §40 forbids. Sign `Bucket`/`Key`/`ContentType`
only; Part 5 enforces the real size with `HeadObject` after the upload lands.

---

## Steps

- [ ] **Step 1: Install the SDK**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Server-only. Confirm after Part 9 that neither appears in the client bundle.

- [ ] **Step 2: Write `src/lib/proctoring/storage/types.ts`**

```ts
/**
 * Provider-agnostic object storage.
 *
 * R2-specific code lives only in r2.ts. Everything else - routes, services,
 * cleanup - talks to this interface, so tests can run against MockStorage with
 * no credentials and no network.
 */
export interface ObjectMetadata {
  byteSize: number
  contentType: string
}

export interface ObjectStorage {
  /** Presigned PUT for exactly one object, one operation, short TTL. */
  createUploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<string>
  /** Presigned GET. Treat the result as a bearer token: never log it, never persist it. */
  createDownloadUrl(key: string, ttlSeconds: number): Promise<string>
  /** Null when the object does not exist. Used to verify a claimed upload. */
  getObjectMetadata(key: string): Promise<ObjectMetadata | null>
  /** Idempotent: deleting an absent object is not an error. */
  deleteObject(key: string): Promise<void>
}
```

- [ ] **Step 3: Write the failing key test** — `tests/proctoring-storage-keys.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { webcamSegmentKey, screenshotKey, isProctoringKey, PROCTORING_PREFIX } from '@/lib/proctoring/storage/keys'

/**
 * Object keys are security surface, not cosmetics. They must carry no personal
 * data, and they must be impossible to steer out of the proctoring prefix - a
 * caller-supplied "../" or an absolute path would otherwise let a crafted
 * request sign a URL for an unrelated object.
 */
describe('object keys', () => {
  it('zero-pads the sequence so lexical order matches capture order', () => {
    expect(webcamSegmentKey('sess1', 1)).toBe('assessment-proctoring/sess1/webcam/000001.webm')
    expect(webcamSegmentKey('sess1', 42)).toBe('assessment-proctoring/sess1/webcam/000042.webm')
  })

  it('orders 2 before 10 lexically', () => {
    const keys = [webcamSegmentKey('s', 10), webcamSegmentKey('s', 2)].sort()
    expect(keys[0]).toContain('000002')
  })

  it('builds screenshot keys with the chosen extension', () => {
    expect(screenshotKey('sess1', 3, 'webp')).toBe('assessment-proctoring/sess1/screen/000003.webp')
    expect(screenshotKey('sess1', 3, 'jpg')).toBe('assessment-proctoring/sess1/screen/000003.jpg')
  })

  it('rejects a session id that could escape the prefix', () => {
    expect(() => webcamSegmentKey('../../etc/passwd', 1)).toThrow(/session id/i)
    expect(() => webcamSegmentKey('a/b', 1)).toThrow(/session id/i)
    expect(() => webcamSegmentKey('', 1)).toThrow(/session id/i)
  })

  it('rejects a sequence that is not a positive integer', () => {
    expect(() => webcamSegmentKey('sess1', 0)).toThrow(/sequence/i)
    expect(() => webcamSegmentKey('sess1', -1)).toThrow(/sequence/i)
    expect(() => webcamSegmentKey('sess1', 1.5)).toThrow(/sequence/i)
    expect(() => webcamSegmentKey('sess1', 1_000_000)).toThrow(/sequence/i)
  })

  it('recognises only keys inside the proctoring prefix', () => {
    expect(isProctoringKey(webcamSegmentKey('s', 1))).toBe(true)
    expect(isProctoringKey('other/thing.webm')).toBe(false)
    expect(isProctoringKey('/assessment-proctoring/s/webcam/000001.webm')).toBe(false)
  })

  it('exposes the prefix used by the R2 lifecycle rule', () => {
    // The lifecycle rule is configured against this literal string. If it
    // changes, the rule stops matching and objects are never deleted.
    expect(PROCTORING_PREFIX).toBe('assessment-proctoring/')
  })
})
```

```bash
npx vitest run tests/proctoring-storage-keys.test.ts
```

Expected: fails, module not found.

- [ ] **Step 4: Write `src/lib/proctoring/storage/keys.ts`**

```ts
/**
 * Object key construction.
 *
 * Keys contain internal ids only - never a candidate name, email or phone.
 * A key is also the only thing a presigned URL is scoped to, so a caller that
 * could influence its shape could reach objects it has no right to. Both inputs
 * are therefore validated rather than interpolated.
 */

export const PROCTORING_PREFIX = 'assessment-proctoring/'

/** cuid-shaped: letters and digits only. Notably excludes "/" and ".". */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_SEQUENCE = 999_999

function assertSessionId(sessionId: string): string {
  if (!SAFE_ID.test(sessionId)) {
    throw new Error(`Invalid proctoring session id for object key: ${JSON.stringify(sessionId)}`)
  }
  return sessionId
}

function pad(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new Error(`Invalid sequence for object key: ${sequence}`)
  }
  // Zero-padded so lexical order matches capture order, which is what makes a
  // plain sorted listing a correct playlist.
  return String(sequence).padStart(6, '0')
}

export function webcamSegmentKey(sessionId: string, sequence: number): string {
  return `${PROCTORING_PREFIX}${assertSessionId(sessionId)}/webcam/${pad(sequence)}.webm`
}

export function screenshotKey(sessionId: string, sequence: number, ext: 'webp' | 'jpg'): string {
  return `${PROCTORING_PREFIX}${assertSessionId(sessionId)}/screen/${pad(sequence)}.${ext}`
}

/** Guard before any delete or sign: never touch an object outside our prefix. */
export function isProctoringKey(key: string): boolean {
  return key.startsWith(PROCTORING_PREFIX) && !key.includes('..')
}
```

- [ ] **Step 5: Run the key test — expect pass**

```bash
npx vitest run tests/proctoring-storage-keys.test.ts
```

- [ ] **Step 6: Write `src/lib/proctoring/storage/mock.ts`**

```ts
import type { ObjectStorage, ObjectMetadata } from './types'
import { isProctoringKey } from './keys'

interface MockObject { byteSize: number; contentType: string }

/**
 * In-memory storage for tests and for local work without R2 credentials.
 *
 * It is deliberately not a faithful R2: uploads are recorded by calling
 * putForTest, because nothing in a unit test actually performs the HTTP PUT.
 * What it does faithfully model is the contract the routes depend on - a
 * missing object reads as null, deletes are idempotent, and keys outside the
 * proctoring prefix are refused.
 */
export class MockStorage implements ObjectStorage {
  private objects = new Map<string, MockObject>()
  /** Every signed URL handed out, for assertions. */
  readonly signedUploads: Array<{ key: string; contentType: string; ttlSeconds: number }> = []
  readonly signedDownloads: Array<{ key: string; ttlSeconds: number }> = []

  async createUploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<string> {
    this.assertKey(key)
    this.signedUploads.push({ key, contentType, ttlSeconds })
    return `https://mock.invalid/upload/${encodeURIComponent(key)}?ct=${encodeURIComponent(contentType)}&ttl=${ttlSeconds}`
  }

  async createDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    this.assertKey(key)
    this.signedDownloads.push({ key, ttlSeconds })
    return `https://mock.invalid/download/${encodeURIComponent(key)}?ttl=${ttlSeconds}`
  }

  async getObjectMetadata(key: string): Promise<ObjectMetadata | null> {
    this.assertKey(key)
    const o = this.objects.get(key)
    return o ? { byteSize: o.byteSize, contentType: o.contentType } : null
  }

  async deleteObject(key: string): Promise<void> {
    this.assertKey(key)
    this.objects.delete(key)
  }

  /** Test helper: stand in for the browser's PUT having succeeded. */
  putForTest(key: string, byteSize: number, contentType: string): void {
    this.objects.set(key, { byteSize, contentType })
  }

  has(key: string): boolean { return this.objects.has(key) }
  get size(): number { return this.objects.size }
  clear(): void {
    this.objects.clear()
    this.signedUploads.length = 0
    this.signedDownloads.length = 0
  }

  private assertKey(key: string): void {
    if (!isProctoringKey(key)) throw new Error(`Refusing to operate on non-proctoring key: ${key}`)
  }
}
```

- [ ] **Step 7: Write `src/lib/proctoring/storage/r2.ts`**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ObjectStorage, ObjectMetadata } from './types'
import { isProctoringKey } from './keys'
import { getR2Config } from '../config'

/**
 * Cloudflare R2 via the S3-compatible API.
 *
 * The bucket is private and stays private. Every read and write goes through a
 * short-lived presigned URL generated here, server-side; credentials never leave
 * this module and never reach the browser.
 */
export class CloudflareR2Storage implements ObjectStorage {
  private client: S3Client
  private bucket: string

  constructor() {
    const cfg = getR2Config()
    this.bucket = cfg.bucket
    this.client = new S3Client({
      region: 'auto',
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      // AWS SDK v3 >= 3.729 defaults this to WHEN_SUPPORTED, which adds an
      // x-amz-checksum-crc32 header that R2 rejects on presigned PUTs. Without
      // this line uploads fail with an opaque 400/403 that looks like a signing
      // bug. Do not remove.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
  }

  async createUploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<string> {
    this.assertKey(key)
    // ContentType is signed so a client cannot upload something else under this
    // URL. ContentLength deliberately is NOT: signing it would force the browser
    // to send exactly that many bytes, and a client-declared size is not
    // trustworthy anyway. The real size is verified with HeadObject afterwards.
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType })
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds })
  }

  async createDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    this.assertKey(key)
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key })
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds })
  }

  async getObjectMetadata(key: string): Promise<ObjectMetadata | null> {
    this.assertKey(key)
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return {
        byteSize: Number(r.ContentLength ?? 0),
        contentType: r.ContentType ?? 'application/octet-stream',
      }
    } catch (err) {
      const name = (err as { name?: string }).name
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) return null
      throw err
    }
  }

  async deleteObject(key: string): Promise<void> {
    this.assertKey(key)
    // S3/R2 DELETE is already idempotent - an absent key returns 204.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  private assertKey(key: string): void {
    if (!isProctoringKey(key)) throw new Error(`Refusing to operate on non-proctoring key: ${key}`)
  }
}
```

- [ ] **Step 8: Write `src/lib/proctoring/storage/index.ts`**

```ts
import type { ObjectStorage } from './types'
import { MockStorage } from './mock'
import { CloudflareR2Storage } from './r2'
import { getProctoringConfig } from '../config'

export type { ObjectStorage, ObjectMetadata } from './types'
export { MockStorage } from './mock'

let cached: ObjectStorage | null = null

/**
 * The configured storage provider.
 *
 * There is no fallback from r2 to mock. If R2 is selected and misconfigured this
 * throws, because the alternative - accepting evidence, reporting it stored, and
 * dropping it into a Map that dies with the process - is far worse than a loud
 * failure at the first upload.
 */
export function getStorage(): ObjectStorage {
  if (cached) return cached
  cached = getProctoringConfig().storageProvider === 'r2'
    ? new CloudflareR2Storage()
    : new MockStorage()
  return cached
}

export function resetStorageForTests(): void { cached = null }
```

- [ ] **Step 9: Write `tests/proctoring-storage-mock.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MockStorage } from '@/lib/proctoring/storage/mock'
import { webcamSegmentKey, screenshotKey } from '@/lib/proctoring/storage/keys'

/**
 * MockStorage is what every backend test runs against, so its contract has to
 * match the one the routes rely on: absent reads as null, deletes are
 * idempotent, and nothing outside the proctoring prefix can be touched.
 */
describe('MockStorage', () => {
  let s: MockStorage
  const key = webcamSegmentKey('sess1', 1)
  beforeEach(() => { s = new MockStorage() })

  it('returns null for an object that was never uploaded', async () => {
    expect(await s.getObjectMetadata(key)).toBeNull()
  })

  it('returns the recorded size and type once uploaded', async () => {
    s.putForTest(key, 1234, 'video/webm')
    expect(await s.getObjectMetadata(key)).toEqual({ byteSize: 1234, contentType: 'video/webm' })
  })

  it('records what was signed, including the TTL', async () => {
    await s.createUploadUrl(key, 'video/webm', 300)
    expect(s.signedUploads).toEqual([{ key, contentType: 'video/webm', ttlSeconds: 300 }])
  })

  it('deletes idempotently - a second delete is not an error', async () => {
    s.putForTest(key, 10, 'video/webm')
    await s.deleteObject(key)
    await s.deleteObject(key)
    expect(s.has(key)).toBe(false)
  })

  it('refuses any key outside the proctoring prefix', async () => {
    await expect(s.createUploadUrl('elsewhere/x.webm', 'video/webm', 60)).rejects.toThrow(/non-proctoring key/)
    await expect(s.deleteObject('../secrets')).rejects.toThrow(/non-proctoring key/)
  })

  it('keeps webcam and screenshot sequences in separate namespaces', async () => {
    expect(webcamSegmentKey('s', 1)).not.toBe(screenshotKey('s', 1, 'webp'))
  })
})
```

- [ ] **Step 10: Run both storage tests — expect pass**

```bash
npx vitest run tests/proctoring-storage-keys.test.ts tests/proctoring-storage-mock.test.ts
```

- [ ] **Step 11: Typecheck and full suite**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "proctoring part 2: storage abstraction with R2 and mock providers"
```

Do not push.

- [ ] **Step 13: Update `PROGRESS.md`.**

---

## Done when

- Keys are validated, zero-padded, and cannot escape the prefix.
- `CloudflareR2Storage` sets `requestChecksumCalculation: 'WHEN_REQUIRED'` and
  does not sign `ContentLength`.
- `getStorage()` throws rather than falling back when R2 is selected but unset.
- Typecheck clean, full suite green, committed locally.

**Not verified here:** that R2 actually accepts these presigned URLs. That needs
real credentials and a browser PUT, and it happens in Part 14's manual test.
Do not claim R2 works until then.
