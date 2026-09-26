import { describe, it, expect } from 'vitest'
import { DetectionPipeline, type PipelineOutput } from '@/lib/proctoring/client/detection-pipeline'
import type { FrameSignals } from '@/lib/proctoring/client/gaze-classify'

/**
 * End to end through the pure stages at ~6 FPS, with synthetic frames. This is
 * where the spec's face, gaze, temporal and phone-like scenarios are pinned.
 */

const STEP = 167
const centre = (): FrameSignals =>
  ({ faceCount: 1, yaw: 3, pitch: -2, roll: 0, irisX: 0.01, irisY: 0.02, faceWidth: 0.2, quality: 1 })
const noFace = (): FrameSignals =>
  ({ faceCount: 0, yaw: null, pitch: null, roll: null, irisX: null, irisY: null, faceWidth: null, quality: 0 })
const twoFaces = (): FrameSignals => ({ ...noFace(), faceCount: 2, quality: 1 })
const down = (): FrameSignals => ({ ...centre(), pitch: -22, irisY: 0.2 })
const left = (): FrameSignals => ({ ...centre(), yaw: -20, irisX: -0.2 })

class Clock {
  t = 0
  outs: PipelineOutput[] = []
  constructor(readonly p = new DetectionPipeline()) {}
  run(make: () => FrameSignals, ms: number): PipelineOutput[] {
    const start = this.outs.length
    for (let end = this.t + ms; this.t < end; this.t += STEP) this.outs.push(this.p.process(make(), this.t))
    return this.outs.slice(start)
  }
}

const events = (outs: PipelineOutput[]) => outs.reduce<string[]>((a, o) => a.concat(o.events.map(e => e.type)), [])
const warnings = (outs: PipelineOutput[]) => outs.reduce<string[]>((a, o) => a.concat(o.warnings), [])

function calibrated(): Clock {
  const c = new Clock()
  c.run(centre, 3300)
  return c
}

describe('DetectionPipeline', () => {
  it('calibrates first, then monitors', () => {
    const c = new Clock()
    expect(c.run(centre, 500)[0].phase).toBe('CALIBRATING')
    c.run(centre, 3000)
    expect(c.outs[c.outs.length - 1].phase).toBe('MONITORING')
    expect(c.p.baseline).toMatchObject({ yaw: 3, pitch: -2 })
  })

  it('1 face looking at the screen produces nothing', () => {
    const c = calibrated()
    const outs = c.run(centre, 30_000)
    expect(events(outs)).toEqual([])
    expect(warnings(outs)).toEqual([])
  })

  it('face disappears then returns: one FACE_MISSING event with its duration', () => {
    const c = calibrated()
    const gone = c.run(noFace, 3000)
    expect(warnings(gone)).toContain('FACE_MISSING')
    const back = c.run(centre, 1000)
    const e = back.reduce<PipelineOutput['events']>((a, o) => a.concat(o.events), [])
    expect(e.map(x => x.type)).toEqual(['FACE_MISSING'])
    expect(e[0].durationMs).toBeGreaterThan(2500)
    expect(e[0].durationMs).toBeLessThanOrEqual(3000)
  })

  it('detects a missing face even during calibration', () => {
    const c = new Clock()
    expect(warnings(c.run(noFace, 2500))).toContain('FACE_MISSING')
  })

  it('2 faces: MULTIPLE_FACES warning, and an event once cleared', () => {
    const c = calibrated()
    expect(warnings(c.run(twoFaces, 1500))).toContain('MULTIPLE_FACES')
    expect(events(c.run(centre, 1000))).toEqual(['MULTIPLE_FACES'])
  })

  it('sustained LEFT is one LOOKING_LEFT event, not one per frame', () => {
    const c = calibrated()
    const outs = c.run(left, 3000).concat(c.run(centre, 1000))
    expect(events(outs)).toEqual(['LOOKING_LEFT'])
    expect(warnings(outs)).toEqual(['LOOK_AT_SCREEN'])
  })

  it('brief downward glance: nothing at all', () => {
    const c = calibrated()
    const outs = c.run(down, 1000).concat(c.run(centre, 2000))
    expect(events(outs)).toEqual([])
    expect(warnings(outs)).toEqual([])
  })

  it('long downward glance: LOOKING_DOWN plus SUSTAINED_DOWNWARD_ATTENTION', () => {
    const c = calibrated()
    const outs = c.run(down, 7000).concat(c.run(centre, 1000))
    expect(events(outs)).toEqual(['LOOKING_DOWN', 'SUSTAINED_DOWNWARD_ATTENTION'])
    expect(warnings(outs)).toContain('DOWNWARD_ATTENTION')
  })

  it('repeated downward attention escalates on the fourth episode', () => {
    const c = calibrated()
    const all: PipelineOutput[] = []
    for (let i = 0; i < 4; i++) {
      all.push(...c.run(down, 3000))
      all.push(...c.run(centre, 15_000))
    }
    const e = events(all)
    expect(e.filter(t => t === 'LOOKING_DOWN').length).toBe(4)
    expect(e.filter(t => t === 'REPEATED_DOWNWARD_ATTENTION').length).toBe(1)
  })

  it('carries the horizontal part of a down-left look as metadata', () => {
    const c = calibrated()
    c.run(() => ({ ...down(), yaw: -20, irisX: -0.2 }), 3000)
    const out = c.run(centre, 1000).reduce<PipelineOutput['events']>((a, o) => a.concat(o.events), [])
    expect(out[0]).toMatchObject({ type: 'LOOKING_DOWN', direction: 'DOWN', metadata: { horizontal: 'LEFT' } })
  })

  it('flush returns an episode still in progress', () => {
    const c = calibrated()
    c.run(noFace, 3000)
    expect(c.p.flush(c.t).map(e => e.type)).toEqual(['FACE_MISSING'])
  })

  it('reset clears calibration and behaviour state', () => {
    const c = calibrated()
    c.p.reset()
    expect(c.p.baseline).toBeNull()
  })
})
