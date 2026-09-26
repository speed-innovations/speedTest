/**
 * Browser capability check. Live monitoring needs a camera + microphone and
 * screen capture - nothing else. There is no recorder, so no recording format.
 */
export interface SupportReport {
  supported: boolean
  missing: string[]
}

export function checkBrowserSupport(): SupportReport {
  const missing: string[] = []
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    missing.push('MediaDevices')
  } else {
    if (typeof navigator.mediaDevices.getUserMedia !== 'function') missing.push('getUserMedia')
    if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') missing.push('getDisplayMedia')
  }
  return { supported: missing.length === 0, missing }
}
