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
