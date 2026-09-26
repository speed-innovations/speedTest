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

import type { ProctoringClientState } from '../types'

export type ProctoringEventName =
  | 'CHECK_DEVICES' | 'DEVICES_OK' | 'UNSUPPORTED'
  | 'START_REQUESTED' | 'PERMISSIONS_GRANTED' | 'PERMISSIONS_DENIED'
  | 'SESSION_STARTED' | 'PROCTORING_UNAVAILABLE'
  | 'SCREEN_SHARE_ENDED' | 'SCREEN_SHARE_RESUMED'
  | 'CAMERA_ENDED' | 'MICROPHONE_ENDED' | 'DEVICES_RECOVERED'
  | 'SESSION_LOST' | 'SESSION_RESUMED'
  | 'OFFLINE' | 'ONLINE' | 'EXPIRE' | 'FINALIZE' | 'FINALIZED'

type Table = {
  [S in ProctoringClientState]?: { [E in ProctoringEventName]?: ProctoringClientState }
}

/** From every live state, the server can report the session gone. */
const LOST = { SESSION_LOST: 'SESSION_INTERRUPTED' as const, EXPIRE: 'EXPIRED' as const }

const LIVE_STATES: ProctoringClientState[] = [
  'STARTING', 'ACTIVE', 'DEGRADED', 'SCREEN_SHARE_STOPPED', 'CAMERA_STOPPED',
  'MICROPHONE_STOPPED', 'NETWORK_OFFLINE', 'SESSION_INTERRUPTED',
]

const TABLE: Table = {
  IDLE: { CHECK_DEVICES: 'CHECKING_DEVICES', UNSUPPORTED: 'UNSUPPORTED_BROWSER' },
  CHECKING_DEVICES: { DEVICES_OK: 'READY', UNSUPPORTED: 'UNSUPPORTED_BROWSER' },
  READY: { START_REQUESTED: 'AWAITING_PERMISSION', UNSUPPORTED: 'UNSUPPORTED_BROWSER' },
  AWAITING_PERMISSION: { PERMISSIONS_GRANTED: 'STARTING', PERMISSIONS_DENIED: 'PERMISSION_DENIED' },
  // A retry goes back through the permission step: the gesture rule means
  // asking again, never assuming.
  PERMISSION_DENIED: { START_REQUESTED: 'AWAITING_PERMISSION' },
  PROCTORING_UNAVAILABLE: { START_REQUESTED: 'AWAITING_PERMISSION' },
  STARTING: {
    SESSION_STARTED: 'ACTIVE',
    PROCTORING_UNAVAILABLE: 'PROCTORING_UNAVAILABLE',
    PERMISSIONS_DENIED: 'PERMISSION_DENIED',
  },
  ACTIVE: {
    SCREEN_SHARE_ENDED: 'SCREEN_SHARE_STOPPED',
    CAMERA_ENDED: 'CAMERA_STOPPED',
    MICROPHONE_ENDED: 'MICROPHONE_STOPPED',
    OFFLINE: 'NETWORK_OFFLINE',
    ...LOST,
  },
  DEGRADED: { DEVICES_RECOVERED: 'ACTIVE', ...LOST },
  SCREEN_SHARE_STOPPED: { SCREEN_SHARE_RESUMED: 'ACTIVE', CAMERA_ENDED: 'CAMERA_STOPPED', ...LOST },
  CAMERA_STOPPED: { DEVICES_RECOVERED: 'ACTIVE', SCREEN_SHARE_ENDED: 'SCREEN_SHARE_STOPPED', ...LOST },
  MICROPHONE_STOPPED: { DEVICES_RECOVERED: 'ACTIVE', ...LOST },
  NETWORK_OFFLINE: { ONLINE: 'ACTIVE', ...LOST },
  SESSION_INTERRUPTED: { SESSION_RESUMED: 'ACTIVE', EXPIRE: 'EXPIRED' },
  FINALIZING: { FINALIZED: 'COMPLETED' },
}

/**
 * (state, event) -> state. Anything absent from the table leaves the state
 * unchanged, so a late event cannot reanimate a finished session. The UI does
 * not read device problems from this single state - several can be true at
 * once - but from the hook's `health`.
 */
export function nextState(current: ProctoringClientState, event: ProctoringEventName): ProctoringClientState {
  const target = TABLE[current]?.[event]
  if (target) return target
  // A candidate must always be able to submit, whatever proctoring is doing.
  if (event === 'FINALIZE' && LIVE_STATES.indexOf(current) !== -1) return 'FINALIZING'
  return current
}
