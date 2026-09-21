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
