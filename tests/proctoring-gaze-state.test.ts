import { describe, it, expect, beforeEach } from 'vitest'
import { GazeStateMachine } from '@/lib/proctoring/client/gaze-state'

/**
 * These are the acceptance cases from the PRD, stated as tests. A warning must
 * require sustained deviation, must not repeat inside the cooldown, and must
 * reset when the candidate looks back.
 */
const opts = { gazeWarningMs: 1500, cooldownMs: 10_000, faceMissingMs: 3000, multipleFacesMs: 3000 }

describe('GazeStateMachine', () => {
  let m: GazeStateMachine
  beforeEach(() => { m = new GazeStateMachine(opts) })

  it('CENTER never warns', () => {
    for (let t = 0; t <= 30_000; t += 200) expect(m.observe('CENTER', t)).toBeNull()
  })

  it('LEFT for 500ms does not warn', () => {
    expect(m.observe('LEFT', 0)).toBeNull()
    expect(m.observe('LEFT', 500)).toBeNull()
  })

  it('LEFT for 1500ms warns exactly once', () => {
    m.observe('LEFT', 0)
    expect(m.observe('LEFT', 1400)).toBeNull()
    const w = m.observe('LEFT', 1500)
    expect(w).toMatchObject({ type: 'GAZE_LEFT', direction: 'LEFT' })
    // Still deviating, but already warned.
    expect(m.observe('LEFT', 1700)).toBeNull()
  })

  it('does not warn again inside the cooldown', () => {
    m.observe('LEFT', 0)
    expect(m.observe('LEFT', 1500)).not.toBeNull()
    expect(m.observe('LEFT', 2500)).toBeNull()
    expect(m.observe('LEFT', 9000)).toBeNull()
  })

  it('warns again once the cooldown has elapsed and deviation is sustained', () => {
    m.observe('LEFT', 0)
    m.observe('LEFT', 1500)          // first warning at t=1500
    m.observe('CENTER', 2000)        // look back
    m.observe('LEFT', 11_000)        // deviate again, after the cooldown
    expect(m.observe('LEFT', 12_500)).not.toBeNull()
  })

  it('returning to CENTER resets the sustained timer', () => {
    m.observe('LEFT', 0)
    m.observe('CENTER', 1000)
    m.observe('LEFT', 1200)
    // Only 300ms of the new deviation has elapsed - no warning.
    expect(m.observe('LEFT', 1500)).toBeNull()
  })

  it('RIGHT for 1500ms warns, independently of an earlier LEFT', () => {
    m.observe('LEFT', 0)
    m.observe('LEFT', 1500)
    m.observe('CENTER', 2000)
    m.observe('RIGHT', 20_000)
    expect(m.observe('RIGHT', 21_500)).toMatchObject({ type: 'GAZE_RIGHT' })
  })

  it('a missing face warns on its own, longer threshold', () => {
    m.observe('FACE_NOT_DETECTED', 0)
    expect(m.observe('FACE_NOT_DETECTED', 2000)).toBeNull()
    expect(m.observe('FACE_NOT_DETECTED', 3000)).toMatchObject({ type: 'FACE_NOT_DETECTED' })
  })

  it('recovers automatically when the face comes back', () => {
    m.observe('FACE_NOT_DETECTED', 0)
    m.observe('FACE_NOT_DETECTED', 3000)
    expect(m.observe('CENTER', 3200)).toBeNull()
    m.observe('FACE_NOT_DETECTED', 3400)
    // Fresh 3s window, not a continuation of the old one.
    expect(m.observe('FACE_NOT_DETECTED', 5000)).toBeNull()
  })

  it('multiple faces warn on their own threshold', () => {
    m.observe('MULTIPLE_FACES', 0)
    expect(m.observe('MULTIPLE_FACES', 3000)).toMatchObject({ type: 'MULTIPLE_FACES_DETECTED' })
  })

  it('UNCERTAIN neither warns nor resets a run in progress', () => {
    m.observe('LEFT', 0)
    m.observe('UNCERTAIN', 700)     // a dropped frame must not look like recovery
    expect(m.observe('LEFT', 1500)).not.toBeNull()
  })

  it('reports the duration of the deviation in the warning', () => {
    m.observe('LEFT', 0)
    const w = m.observe('LEFT', 2100)
    expect(w?.durationMs).toBe(2100)
  })

  it('keeps cooldowns independent per warning type', () => {
    // A gaze warning must not suppress a face-missing warning; they are
    // different observations and a reviewer needs both.
    m.observe('LEFT', 0)
    expect(m.observe('LEFT', 1500)).not.toBeNull()
    m.observe('FACE_NOT_DETECTED', 2000)
    expect(m.observe('FACE_NOT_DETECTED', 5000)).toMatchObject({ type: 'FACE_NOT_DETECTED' })
  })

  it('switching direction restarts the sustained timer', () => {
    m.observe('LEFT', 0)
    m.observe('RIGHT', 1000)
    // 500ms of RIGHT, not 1500ms of "deviating".
    expect(m.observe('RIGHT', 1500)).toBeNull()
    expect(m.observe('RIGHT', 2500)).toMatchObject({ type: 'GAZE_RIGHT' })
  })

  it('reset() clears both the run and the cooldowns', () => {
    m.observe('LEFT', 0)
    expect(m.observe('LEFT', 1500)).not.toBeNull()
    m.reset()
    m.observe('LEFT', 1600)
    // A fresh run, and no lingering cooldown from before the reset.
    expect(m.observe('LEFT', 3100)).toMatchObject({ type: 'GAZE_LEFT' })
  })

  it('warns for UP and DOWN with their own event types', () => {
    m.observe('UP', 0)
    expect(m.observe('UP', 1500)).toMatchObject({ type: 'GAZE_UP', direction: 'UP' })
    m.observe('CENTER', 2000)
    m.observe('DOWN', 20_000)
    expect(m.observe('DOWN', 21_500)).toMatchObject({ type: 'GAZE_DOWN', direction: 'DOWN' })
  })
})
