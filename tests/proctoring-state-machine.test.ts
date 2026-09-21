import { describe, it, expect } from 'vitest'
import { nextState } from '@/lib/proctoring/client/state-machine'

/**
 * The state machine exists to make contradictory states unrepresentable - a
 * session cannot be both COMPLETED and recording, and a denied permission must
 * not fall through into ACTIVE.
 */
describe('nextState', () => {
  it('walks the happy path', () => {
    let s = nextState('IDLE', 'CHECK_DEVICES')
    expect(s).toBe('CHECKING_DEVICES')
    s = nextState(s, 'DEVICES_OK')
    expect(s).toBe('READY')
    s = nextState(s, 'START_REQUESTED')
    expect(s).toBe('AWAITING_PERMISSION')
    s = nextState(s, 'PERMISSIONS_GRANTED')
    expect(s).toBe('STARTING')
    s = nextState(s, 'SESSION_STARTED')
    expect(s).toBe('ACTIVE')
  })

  it('routes a denied permission to PERMISSION_DENIED, never onward', () => {
    expect(nextState('AWAITING_PERMISSION', 'PERMISSIONS_DENIED')).toBe('PERMISSION_DENIED')
    // And a retry returns to the permission step rather than skipping it.
    expect(nextState('PERMISSION_DENIED', 'START_REQUESTED')).toBe('AWAITING_PERMISSION')
  })

  it('degrades and recovers without leaving ACTIVE permanently', () => {
    expect(nextState('ACTIVE', 'UPLOADS_BACKLOGGED')).toBe('UPLOAD_DEGRADED')
    expect(nextState('UPLOAD_DEGRADED', 'UPLOADS_RECOVERED')).toBe('ACTIVE')
  })

  it('treats a stopped screen share as interrupting, and resumable', () => {
    expect(nextState('ACTIVE', 'SCREEN_SHARE_ENDED')).toBe('SCREEN_SHARE_STOPPED')
    expect(nextState('SCREEN_SHARE_STOPPED', 'SCREEN_SHARE_RESUMED')).toBe('ACTIVE')
  })

  it('ignores events that do not apply to the current state', () => {
    // A late SESSION_STARTED after completion must not reanimate the session.
    expect(nextState('COMPLETED', 'SESSION_STARTED')).toBe('COMPLETED')
    expect(nextState('COMPLETED', 'UPLOADS_BACKLOGGED')).toBe('COMPLETED')
  })

  it('always allows finalization from any live state', () => {
    for (const s of ['ACTIVE', 'DEGRADED', 'UPLOAD_DEGRADED', 'SCREEN_SHARE_STOPPED'] as const) {
      expect(nextState(s, 'FINALIZE')).toBe('FINALIZING')
    }
    expect(nextState('FINALIZING', 'FINALIZED')).toBe('COMPLETED')
  })

  it('refuses to leave an unsupported browser state', () => {
    expect(nextState('UNSUPPORTED_BROWSER', 'START_REQUESTED')).toBe('UNSUPPORTED_BROWSER')
  })

  it('treats camera and microphone loss as interrupting, and recoverable', () => {
    expect(nextState('ACTIVE', 'CAMERA_ENDED')).toBe('CAMERA_STOPPED')
    expect(nextState('ACTIVE', 'MICROPHONE_ENDED')).toBe('MICROPHONE_STOPPED')
    expect(nextState('CAMERA_STOPPED', 'DEVICES_RECOVERED')).toBe('ACTIVE')
    expect(nextState('MICROPHONE_STOPPED', 'DEVICES_RECOVERED')).toBe('ACTIVE')
  })

  it('lets a quota refusal reach a terminal, explainable state', () => {
    // The candidate must be told "no capacity", not left spinning in STARTING.
    expect(nextState('STARTING', 'STORAGE_UNAVAILABLE')).toBe('STORAGE_UNAVAILABLE')
    expect(nextState('STORAGE_UNAVAILABLE', 'SESSION_STARTED')).toBe('STORAGE_UNAVAILABLE')
  })

  it('is terminal at COMPLETED - no event escapes it', () => {
    const events = [
      'CHECK_DEVICES', 'DEVICES_OK', 'START_REQUESTED', 'PERMISSIONS_GRANTED',
      'PERMISSIONS_DENIED', 'SESSION_STARTED', 'UPLOADS_BACKLOGGED',
      'UPLOADS_RECOVERED', 'SCREEN_SHARE_ENDED', 'SCREEN_SHARE_RESUMED',
      'CAMERA_ENDED', 'MICROPHONE_ENDED', 'DEVICES_RECOVERED', 'FINALIZE',
      'FINALIZED', 'STORAGE_UNAVAILABLE', 'UNSUPPORTED', 'EXPIRE', 'OFFLINE', 'ONLINE',
    ] as const
    for (const e of events) expect(nextState('COMPLETED', e)).toBe('COMPLETED')
  })
})
