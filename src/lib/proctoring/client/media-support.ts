/**
 * Browser capability check and recorder format selection.
 *
 * Screen capture support varies enough that a partially-proctored assessment is
 * a real risk: the PRD requires refusing outright rather than starting something
 * that silently records nothing.
 */
export interface SupportReport {
  supported: boolean
  missing: string[]
}

export function checkBrowserSupport(): SupportReport {
  const missing: string[] = []
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) missing.push('MediaDevices')
  else {
    if (typeof navigator.mediaDevices.getUserMedia !== 'function') missing.push('getUserMedia')
    if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') missing.push('getDisplayMedia')
  }
  if (typeof MediaRecorder === 'undefined') missing.push('MediaRecorder')
  else if (!selectRecorderMimeType()) missing.push('a supported WebM recording format')
  return { supported: missing.length === 0, missing }
}

/**
 * Preference order, most to least desirable. VP8/Opus first: it is the most
 * widely supported combination and decodes everywhere the admin player runs.
 * Never hardcode a single type - isTypeSupported is the only reliable answer.
 */
const CANDIDATES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
  'video/mp4',
]

export function selectRecorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (let i = 0; i < CANDIDATES.length; i++) {
    // Guard the call itself: some environments define MediaRecorder without
    // the static helper, and an exception here would look like "unsupported
    // browser" for a browser that is merely unusual.
    try {
      if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(CANDIDATES[i])) {
        return CANDIDATES[i]
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null
}
