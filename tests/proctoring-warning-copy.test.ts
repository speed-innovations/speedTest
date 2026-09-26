import { describe, it, expect } from 'vitest'
import { INTEGRITY_COPY, WARNING_COPY, WarningGate } from '@/lib/proctoring/client/warning-copy'

/**
 * Candidate-facing copy must say monitoring is active without teaching anyone
 * the thresholds (P13), and must never claim media is recorded or saved (N3).
 */
const ALL = Object.keys(WARNING_COPY).map(k => (WARNING_COPY as Record<string, string>)[k])
  .concat(Object.keys(INTEGRITY_COPY).map(k => (INTEGRITY_COPY as Record<string, string>)[k]))

describe('proctoring warning copy', () => {
  it('uses the ticket wording for the core warnings', () => {
    expect(WARNING_COPY.LOOK_AT_SCREEN).toBe('Please look at the assessment screen.')
    expect(WARNING_COPY.FACE_MISSING).toBe('Please position your face clearly in front of the camera.')
    expect(WARNING_COPY.MULTIPLE_FACES).toMatch(/^More than one face was detected\./)
    expect(INTEGRITY_COPY.SCREEN_SHARE_STOPPED).toBe(
      'Screen sharing has stopped. Please resume screen sharing to continue the proctored assessment.'
    )
    expect(INTEGRITY_COPY.CAMERA_INTERRUPTED).toBe('Your camera connection was interrupted.')
  })

  it('tells the candidate that phones are not permitted', () => {
    expect(WARNING_COPY.DOWNWARD_ATTENTION).toMatch(/mobile phones/i)
  })

  it('reveals no numbers, durations, angles or thresholds', () => {
    ALL.forEach(s => {
      expect(s).not.toMatch(/\d/)
      expect(s).not.toMatch(/second|minute|degree|°|threshold|cooldown|percent/i)
    })
  })

  it('never claims anything is recorded, saved or uploaded', () => {
    ALL.forEach(s => expect(s).not.toMatch(/record|saved|upload|stored/i))
  })
})

describe('WarningGate', () => {
  it('spaces transient warnings apart', () => {
    const g = new WarningGate(4000, 8000)
    expect(g.allow('LOOK_AT_SCREEN', 0)).toBe(true)
    expect(g.allow('FACE_MISSING', 1000)).toBe(false)
    expect(g.allow('FACE_MISSING', 4000)).toBe(true)
    expect(g.allow('LOOK_AT_SCREEN', 5000)).toBe(false) // same kind within 8 s
    expect(g.allow('LOOK_AT_SCREEN', 8000)).toBe(true)
  })

  it('lets a second face through the global gap, but not repeatedly', () => {
    const g = new WarningGate(4000, 8000)
    g.allow('LOOK_AT_SCREEN', 0)
    expect(g.allow('MULTIPLE_FACES', 500)).toBe(true)
    expect(g.allow('MULTIPLE_FACES', 1000)).toBe(false)
  })
})
