/**
 * Everything proctoring says to a candidate while they sit the assessment.
 *
 * Two rules, both pinned by tests/proctoring-warning-copy.test.ts:
 *  - no digit, duration, angle or threshold: say monitoring is active, never
 *    how to stay under it;
 *  - no claim that anything is recorded, saved or uploaded, because nothing is.
 */

/** Transient, non-blocking banners raised by detection. */
export type WarningKind = 'LOOK_AT_SCREEN' | 'FACE_MISSING' | 'MULTIPLE_FACES' | 'DOWNWARD_ATTENTION'

export const WARNING_COPY: Record<WarningKind, string> = {
  LOOK_AT_SCREEN: 'Please look at the assessment screen.',
  FACE_MISSING: 'Please position your face clearly in front of the camera.',
  MULTIPLE_FACES: 'More than one face was detected. Only you should be visible during the assessment.',
  DOWNWARD_ATTENTION:
    'Please keep your attention on the assessment screen. Mobile phones and other devices are not permitted.',
}

/** Persistent notices that stay while an integrity problem lasts. */
export type IntegrityNotice =
  | 'SCREEN_SHARE_STOPPED' | 'SCREEN_SHARE_PAUSED'
  | 'CAMERA_INTERRUPTED' | 'MICROPHONE_INTERRUPTED'
  | 'CONNECTION_LOST' | 'SESSION_INTERRUPTED' | 'SESSION_CLOSED'

export const INTEGRITY_COPY: Record<IntegrityNotice, string> = {
  SCREEN_SHARE_STOPPED:
    'Screen sharing has stopped. Please resume screen sharing to continue the proctored assessment.',
  SCREEN_SHARE_PAUSED: 'Screen sharing appears to be paused. Please make sure your screen is still being shared.',
  CAMERA_INTERRUPTED: 'Your camera connection was interrupted.',
  MICROPHONE_INTERRUPTED: 'Your microphone connection was interrupted.',
  CONNECTION_LOST: 'Proctoring cannot reach the server. Please check your internet connection.',
  SESSION_INTERRUPTED: 'Proctoring was interrupted. Please resume proctoring to continue the assessment.',
  SESSION_CLOSED:
    'Proctoring for this attempt has been closed and cannot be resumed. Please contact your invigilator now and do not close this page.',
}

/**
 * Keeps transient banners readable: one at a time, and the same one not
 * repeated back-to-back. A second face skips the global gap - it is the one
 * warning a candidate must not miss because another was just shown.
 */
export class WarningGate {
  private lastShownAt: { [kind: string]: number } = {}
  private lastAnyAt = -Infinity

  constructor(private readonly minGapMs = 4000, private readonly sameKindGapMs = 8000) {}

  allow(kind: WarningKind, tMs: number): boolean {
    const last = this.lastShownAt[kind]
    if (last !== undefined && tMs - last < this.sameKindGapMs) return false
    if (kind !== 'MULTIPLE_FACES' && tMs - this.lastAnyAt < this.minGapMs) return false
    this.lastShownAt[kind] = tMs
    this.lastAnyAt = tMs
    return true
  }

  reset(): void {
    this.lastShownAt = {}
    this.lastAnyAt = -Infinity
  }
}
