import { describe, it, expect } from 'vitest'
import { TemporalEngine, type TemporalOutput } from '@/lib/proctoring/client/gaze-state'
import { DETECTION_CONFIG } from '@/lib/proctoring/client/detection-config'
import type { FusedObservation } from '@/lib/proctoring/client/gaze-classify'
import type { GazeDirection } from '@/lib/proctoring/types'

/**
 * NORMAL -> POSSIBLE_DEVIATION -> SUSTAINED_DEVIATION -> WARNING -> COOLDOWN -> NORMAL.
 * The clock is passed in, so every case is exact. Frames arrive every 100 ms.
 */

function obs(direction: GazeDirection, confidence = 0.9): FusedObservation {
  const horizontal = direction === 'LEFT' || direction === 'RIGHT' ? direction : null
  const vertical = direction === 'UP' || direction === 'DOWN' ? direction : null
  return {
    direction, horizontal, vertical, confidence,
    agreement: 'HEAD_AND_EYES',
    deviation: { yaw: null, pitch: null, irisX: null, irisY: null },
  }
}

function feed(e: TemporalEngine, d: GazeDirection, from: number, to: number, conf = 0.9): TemporalOutput[] {
  const out: TemporalOutput[] = []
  for (let t = from; t <= to; t += 100) out.push(e.observe(obs(d, conf), t))
  return out
}

const warnings = (outs: TemporalOutput[]) => outs.filter(o => o.warning).map(o => o.warning)
const ended = (outs: TemporalOutput[]) => outs.filter(o => o.ended).map(o => o.ended!)
const engine = () => new TemporalEngine(DETECTION_CONFIG)

describe('TemporalEngine', () => {
  it('brief deviation: 300 ms of LEFT is ignored entirely', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 300).concat(feed(e, 'CENTER', 400, 1000))
    expect(outs[1].state).toBe('POSSIBLE_DEVIATION')
    expect(warnings(outs)).toEqual([])
    expect(ended(outs)).toEqual([])
    expect(e.state).toBe('NORMAL')
  })

  it('sustained deviation: warns once when the side-gaze window is reached', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 2000)
    expect(warnings(outs)).toEqual(['LOOKING_LEFT'])
    expect(outs.findIndex(o => o.warning) * 100).toBe(1800)
    expect(outs[outs.length - 1].state).toBe('WARNING')
  })

  it('recovery: ends the episode with its real duration, then cools down', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    const back = feed(e, 'CENTER', 2100, 2600)
    const eps = ended(back)
    expect(eps.length).toBe(1)
    expect(eps[0]).toMatchObject({ condition: 'LOOKING_LEFT', startedAtMs: 0, endedAtMs: 2000, durationMs: 2000 })
    expect(eps[0].confidence).toBeCloseTo(0.9)
    expect(back[back.length - 1].state).toBe('COOLDOWN')
  })

  it('cooldown: a second episode inside it is recorded but not warned', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    feed(e, 'CENTER', 2100, 2600)
    const second = feed(e, 'LEFT', 3000, 5000)
    expect(warnings(second)).toEqual([])
    expect(second[second.length - 1].state).toBe('SUSTAINED_DEVIATION')
    expect(ended(feed(e, 'CENTER', 5100, 5600)).length).toBe(1)
    // After the cooldown lapses it warns again.
    expect(warnings(feed(e, 'LEFT', 12_000, 14_000))).toEqual(['LOOKING_LEFT'])
  })

  it('repeats the warning during one very long episode, once per cooldown', () => {
    const outs = feed(engine(), 'LEFT', 0, 12_000)
    expect(outs.filter(o => o.warning).length).toBe(2)
  })

  it('tolerates a flicker back to centre without restarting the run', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 1000).concat(feed(e, 'CENTER', 1100, 1300), feed(e, 'LEFT', 1400, 2000))
    expect(warnings(outs)).toEqual(['LOOKING_LEFT'])
  })

  it('treats UNCERTAIN frames as neither deviation nor recovery', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 1000).concat(feed(e, 'UNCERTAIN', 1100, 1500), feed(e, 'LEFT', 1600, 1900))
    expect(warnings(outs)).toEqual(['LOOKING_LEFT'])
  })

  it('switching direction restarts the timer: 1 s LEFT + 1.4 s RIGHT is not a warning', () => {
    const e = engine()
    const outs = feed(e, 'LEFT', 0, 1000).concat(feed(e, 'RIGHT', 1100, 2500))
    expect(warnings(outs)).toEqual([])
    expect(ended(outs)).toEqual([]) // the LEFT run never confirmed
  })

  it('a weak (low-confidence) signal must persist longer', () => {
    const e = engine()
    expect(warnings(feed(e, 'LEFT', 0, 2600, 0.55))).toEqual([])
    expect(warnings(feed(e, 'LEFT', 2700, 2700, 0.55))).toEqual(['LOOKING_LEFT'])
  })

  it('downward attention uses its own, longer window', () => {
    const e = engine()
    expect(warnings(feed(e, 'DOWN', 0, 2400))).toEqual([])
    expect(warnings(feed(e, 'DOWN', 2500, 2500))).toEqual(['LOOKING_DOWN'])
  })

  it('face disappears, then returns: FACE_MISSING warning and episode', () => {
    const e = engine()
    const gone = feed(e, 'FACE_MISSING', 0, 2100)
    expect(warnings(gone)).toEqual(['FACE_MISSING'])
    const eps = ended(feed(e, 'CENTER', 2200, 2700))
    expect(eps[0]).toMatchObject({ condition: 'FACE_MISSING', durationMs: 2100 })
  })

  it('a second face is confirmed on a short window', () => {
    const e = engine()
    expect(warnings(feed(e, 'MULTIPLE_FACES', 0, 700))).toEqual([])
    expect(warnings(feed(e, 'MULTIPLE_FACES', 800, 800))).toEqual(['MULTIPLE_FACES'])
  })

  it('keeps cooldowns independent per condition', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    const outs = feed(e, 'FACE_MISSING', 2100, 4200)
    expect(ended(outs)[0].condition).toBe('LOOKING_LEFT')
    expect(warnings(outs)).toEqual(['FACE_MISSING'])
  })

  it('flush closes a confirmed episode in progress, and ignores an unconfirmed one', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    expect(e.flush(2100)).toMatchObject({ condition: 'LOOKING_LEFT', durationMs: 2000 })
    feed(e, 'RIGHT', 3000, 3500)
    expect(e.flush(3600)).toBeNull()
  })

  it('reset clears the run and every cooldown', () => {
    const e = engine()
    feed(e, 'LEFT', 0, 2000)
    e.reset()
    expect(e.state).toBe('NORMAL')
    expect(warnings(feed(e, 'LEFT', 3000, 5000))).toEqual(['LOOKING_LEFT'])
  })
})
