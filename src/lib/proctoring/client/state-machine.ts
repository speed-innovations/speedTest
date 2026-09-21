import type { ProctoringClientState } from '../types'

/**
 * The candidate-side proctoring state machine.
 *
 * Written as an explicit transition table rather than a pile of conditionals.
 * That is what makes "an event that does not apply is ignored" true by
 * construction: anything absent from the table returns the current state
 * unchanged, so a late SESSION_STARTED cannot reanimate a COMPLETED session and
 * a denied permission cannot fall through into ACTIVE.
 *
 * No React, no media handles, no I/O - just (state, event) -> state, so the
 * whole thing is testable in the node runner.
 */

export type ProctoringEventName =
  | 'CHECK_DEVICES'
  | 'DEVICES_OK'
  | 'UNSUPPORTED'
  | 'START_REQUESTED'
  | 'PERMISSIONS_GRANTED'
  | 'PERMISSIONS_DENIED'
  | 'SESSION_STARTED'
  | 'STORAGE_UNAVAILABLE'
  | 'UPLOADS_BACKLOGGED'
  | 'UPLOADS_RECOVERED'
  | 'SCREEN_SHARE_ENDED'
  | 'SCREEN_SHARE_RESUMED'
  | 'CAMERA_ENDED'
  | 'MICROPHONE_ENDED'
  | 'DEVICES_RECOVERED'
  | 'OFFLINE'
  | 'ONLINE'
  | 'EXPIRE'
  | 'FINALIZE'
  | 'FINALIZED'

type Table = {
  [S in ProctoringClientState]?: { [E in ProctoringEventName]?: ProctoringClientState }
}

/** States from which finalization is always permitted. */
const LIVE_STATES: ProctoringClientState[] = [
  'ACTIVE',
  'DEGRADED',
  'UPLOAD_DEGRADED',
  'SCREEN_SHARE_STOPPED',
  'CAMERA_STOPPED',
  'MICROPHONE_STOPPED',
  'NETWORK_OFFLINE',
  'STARTING',
]

const TABLE: Table = {
  IDLE: {
    CHECK_DEVICES: 'CHECKING_DEVICES',
    UNSUPPORTED: 'UNSUPPORTED_BROWSER',
  },
  CHECKING_DEVICES: {
    DEVICES_OK: 'READY',
    UNSUPPORTED: 'UNSUPPORTED_BROWSER',
  },
  READY: {
    START_REQUESTED: 'AWAITING_PERMISSION',
    UNSUPPORTED: 'UNSUPPORTED_BROWSER',
  },
  AWAITING_PERMISSION: {
    PERMISSIONS_GRANTED: 'STARTING',
    PERMISSIONS_DENIED: 'PERMISSION_DENIED',
  },
  // A retry returns to the permission step rather than skipping it: the browser
  // gesture requirement means we must ask again, not assume.
  PERMISSION_DENIED: {
    START_REQUESTED: 'AWAITING_PERMISSION',
  },
  STARTING: {
    SESSION_STARTED: 'ACTIVE',
    STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
    PERMISSIONS_DENIED: 'PERMISSION_DENIED',
    FINALIZE: 'FINALIZING',
  },
  ACTIVE: {
    UPLOADS_BACKLOGGED: 'UPLOAD_DEGRADED',
    SCREEN_SHARE_ENDED: 'SCREEN_SHARE_STOPPED',
    CAMERA_ENDED: 'CAMERA_STOPPED',
    MICROPHONE_ENDED: 'MICROPHONE_STOPPED',
    OFFLINE: 'NETWORK_OFFLINE',
    EXPIRE: 'EXPIRED',
    FINALIZE: 'FINALIZING',
  },
  DEGRADED: {
    UPLOADS_RECOVERED: 'ACTIVE',
    DEVICES_RECOVERED: 'ACTIVE',
    EXPIRE: 'EXPIRED',
    FINALIZE: 'FINALIZING',
  },
  UPLOAD_DEGRADED: {
    UPLOADS_RECOVERED: 'ACTIVE',
    SCREEN_SHARE_ENDED: 'SCREEN_SHARE_STOPPED',
    CAMERA_ENDED: 'CAMERA_STOPPED',
    MICROPHONE_ENDED: 'MICROPHONE_STOPPED',
    OFFLINE: 'NETWORK_OFFLINE',
    EXPIRE: 'EXPIRED',
    FINALIZE: 'FINALIZING',
  },
  SCREEN_SHARE_STOPPED: {
    SCREEN_SHARE_RESUMED: 'ACTIVE',
    DEVICES_RECOVERED: 'ACTIVE',
    EXPIRE: 'EXPIRED',
    FINALIZE: 'FINALIZING',
  },
  CAMERA_STOPPED: {
    DEVICES_RECOVERED: 'ACTIVE',
    EXPIRE: 'EXPIRED',
    FINALIZE: 'FINALIZING',
  },
  MICROPHONE_STOPPED: {
    DEVICES_RECOVERED: 'ACTIVE',
    EXPIRE: 'EXPIRED',
    FINALIZE: 'FINALIZING',
  },
  NETWORK_OFFLINE: {
    ONLINE: 'ACTIVE',
    EXPIRE: 'EXPIRED',
    FINALIZE: 'FINALIZING',
  },
  FINALIZING: {
    FINALIZED: 'COMPLETED',
  },
  // COMPLETED, PERMISSION_DENIED's terminal siblings, UNSUPPORTED_BROWSER,
  // STORAGE_UNAVAILABLE and EXPIRED have no outgoing edges beyond those above.
  // Their absence from the table is what makes them terminal.
}

export function nextState(
  current: ProctoringClientState,
  event: ProctoringEventName
): ProctoringClientState {
  const target = TABLE[current]?.[event]
  if (target) return target
  // FINALIZE is permitted from every live state, including any added later -
  // a candidate must always be able to submit, whatever the proctoring state.
  if (event === 'FINALIZE' && LIVE_STATES.indexOf(current) !== -1) return 'FINALIZING'
  return current
}
