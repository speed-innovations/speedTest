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
