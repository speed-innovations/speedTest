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
