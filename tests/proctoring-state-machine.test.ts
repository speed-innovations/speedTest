import { describe, it, expect } from 'vitest'
import { nextState } from '@/lib/proctoring/client/state-machine'

describe('proctoring client state machine', () => {
  it('walks the happy path to ACTIVE and on to COMPLETED', () => {
    let s = nextState('IDLE', 'CHECK_DEVICES')
    s = nextState(s, 'DEVICES_OK')
    s = nextState(s, 'START_REQUESTED')
    s = nextState(s, 'PERMISSIONS_GRANTED')
    s = nextState(s, 'SESSION_STARTED')
    expect(s).toBe('ACTIVE')
    expect(nextState(nextState(s, 'FINALIZE'), 'FINALIZED')).toBe('COMPLETED')
  })

  it('screen share stops and resumes', () => {
    expect(nextState('ACTIVE', 'SCREEN_SHARE_ENDED')).toBe('SCREEN_SHARE_STOPPED')
    expect(nextState('SCREEN_SHARE_STOPPED', 'SCREEN_SHARE_RESUMED')).toBe('ACTIVE')
  })

  it('camera stops and recovers', () => {
    expect(nextState('ACTIVE', 'CAMERA_ENDED')).toBe('CAMERA_STOPPED')
    expect(nextState('CAMERA_STOPPED', 'DEVICES_RECOVERED')).toBe('ACTIVE')
  })

  it('a lost session is interrupted from any live state and resumes to ACTIVE', () => {
    const live = ['ACTIVE', 'SCREEN_SHARE_STOPPED', 'CAMERA_STOPPED', 'MICROPHONE_STOPPED', 'NETWORK_OFFLINE'] as const
    live.forEach(s => expect(nextState(s, 'SESSION_LOST')).toBe('SESSION_INTERRUPTED'))
    expect(nextState('SESSION_INTERRUPTED', 'SESSION_RESUMED')).toBe('ACTIVE')
  })

  it('always allows FINALIZE from a live state', () => {
    const live = ['STARTING', 'ACTIVE', 'SCREEN_SHARE_STOPPED', 'CAMERA_STOPPED', 'SESSION_INTERRUPTED', 'NETWORK_OFFLINE'] as const
    live.forEach(s => expect(nextState(s, 'FINALIZE')).toBe('FINALIZING'))
  })

  it('lets a candidate retry after a denial or an unavailable service', () => {
    expect(nextState('PERMISSION_DENIED', 'START_REQUESTED')).toBe('AWAITING_PERMISSION')
    expect(nextState('PROCTORING_UNAVAILABLE', 'START_REQUESTED')).toBe('AWAITING_PERMISSION')
  })

  it('ignores events that do not apply, so nothing reanimates COMPLETED', () => {
    expect(nextState('COMPLETED', 'SESSION_STARTED')).toBe('COMPLETED')
    expect(nextState('COMPLETED', 'SESSION_RESUMED')).toBe('COMPLETED')
    expect(nextState('AWAITING_PERMISSION', 'SESSION_STARTED')).toBe('AWAITING_PERMISSION')
  })
})
