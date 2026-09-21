/**
 * Types shared by the proctoring server routes and the browser client.
 *
 * Deliberately free of any server-only import - no Prisma, no next/server - so
 * a client component can import from here without dragging either into the
 * bundle.
 */

export type AttemptKind = 'scheduled' | 'walkin'

export type GazeDirection =
  | 'CENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
  | 'FACE_NOT_DETECTED' | 'MULTIPLE_FACES' | 'UNCERTAIN'

export type ProctoringClientState =
  | 'IDLE' | 'CHECKING_DEVICES' | 'AWAITING_PERMISSION' | 'READY'
  | 'STARTING' | 'ACTIVE' | 'DEGRADED' | 'FINALIZING' | 'COMPLETED'
  | 'PERMISSION_DENIED' | 'SCREEN_SHARE_STOPPED' | 'CAMERA_STOPPED'
  | 'MICROPHONE_STOPPED' | 'UPLOAD_DEGRADED' | 'NETWORK_OFFLINE'
  | 'UNSUPPORTED_BROWSER' | 'STORAGE_UNAVAILABLE' | 'EXPIRED'

export type UploadState = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'EXPIRED'

/** Structured result from the quota gate. Never collapse this to a boolean. */
export interface StartEligibility {
  allowed: boolean
  reason:
    | 'OK'
    | 'PROCTORING_DISABLED'
    | 'PROCTORING_NOT_OPERATIONAL'
    | 'PROCTORING_STORAGE_NOT_CONFIGURED'
    | 'PROCTORING_STORAGE_LIMIT_REACHED'
    | 'PROCTORING_DURATION_INVALID'
  estimatedBytes: number
  remainingBudget: number
}
