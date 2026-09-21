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
