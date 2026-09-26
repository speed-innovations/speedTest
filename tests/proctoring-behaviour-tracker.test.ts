import { describe, it, expect } from 'vitest'
import { BehaviourTracker } from '@/lib/proctoring/client/behaviour-tracker'
import { DETECTION_CONFIG } from '@/lib/proctoring/client/detection-config'
import type { Condition, Episode } from '@/lib/proctoring/client/gaze-state'

function ep(condition: Condition, startedAtMs: number, durationMs: number): Episode {
  return { condition, startedAtMs, endedAtMs: startedAtMs + durationMs, durationMs, confidence: 0.9, horizontal: null }
}
const tracker = () => new BehaviourTracker(DETECTION_CONFIG)
const types = (sigs: Array<{ type: string }>) => sigs.map(s => s.type)

describe('BehaviourTracker: phone-like behaviour, without ever claiming a phone', () => {
  it('a single ordinary downward episode is only counted', () => {
    const t = tracker()
    expect(t.record(ep('LOOKING_DOWN', 0, 2600))).toEqual([])
    expect(t.stats('LOOKING_DOWN').occurrences).toBe(1)
  })

  it('one long downward episode is SUSTAINED_DOWNWARD_ATTENTION', () => {
    const sigs = tracker().record(ep('LOOKING_DOWN', 0, 7000))
    expect(types(sigs)).toEqual(['SUSTAINED_DOWNWARD_ATTENTION'])
    expect(sigs[0].durationMs).toBe(7000)
  })

  it('repeated downward attention in the window becomes one stronger signal', () => {
    const t = tracker()
    const out: string[] = []
    for (let i = 0; i < 4; i++) out.push(...types(t.record(ep('LOOKING_DOWN', i * 30_000, 3000))))
    expect(out).toEqual(['REPEATED_DOWNWARD_ATTENTION'])
  })

  it('reports occurrences, total and max duration, and frequency', () => {
    const t = tracker()
    let last: ReturnType<BehaviourTracker['record']> = []
    const durations = [3000, 4000, 3500, 5000]
    durations.forEach((d, i) => { last = t.record(ep('LOOKING_DOWN', i * 30_000, d)) })
    const repeated = last.find(s => s.type === 'REPEATED_DOWNWARD_ATTENTION')!
    expect(repeated.metadata.occurrences).toBe(4)
    expect(repeated.metadata.totalDurationMs).toBe(15_500)
    expect(repeated.metadata.maxDurationMs).toBe(5000)
    expect(repeated.metadata.perMinute).toBeGreaterThan(0)
    const s = t.stats('LOOKING_DOWN')
    expect(s).toMatchObject({ occurrences: 4, totalDurationMs: 15_500, maxDurationMs: 5000, recentCount: 4 })
    expect(s.lastOccurrenceAtMs).toBe(90_000 + 5000)
  })

  it('does not re-fire on every later episode, only after another full set', () => {
    const t = tracker()
    const counts: number[] = []
    for (let i = 0; i < 8; i++) {
      counts.push(t.record(ep('LOOKING_DOWN', i * 20_000, 3000)).filter(s => s.type === 'REPEATED_DOWNWARD_ATTENTION').length)
    }
    expect(counts).toEqual([0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('episodes spread beyond the window never add up to repeated', () => {
    const t = tracker()
    const out: string[] = []
    for (let i = 0; i < 6; i++) out.push(...types(t.record(ep('LOOKING_DOWN', i * 400_000, 3000))))
    expect(out).toEqual([])
  })

  it('sideways episodes never produce downward signals', () => {
    const t = tracker()
    const out: string[] = []
    for (let i = 0; i < 6; i++) out.push(...types(t.record(ep('LOOKING_LEFT', i * 10_000, 9000))))
    expect(out).toEqual([])
  })

  it('keeps its memory bounded', () => {
    const t = tracker()
    for (let i = 0; i < 500; i++) t.record(ep('LOOKING_DOWN', i * 100, 50))
    expect(t.stats('LOOKING_DOWN').recentCount).toBeLessThanOrEqual(DETECTION_CONFIG.maxTrackedOccurrences)
    expect(t.stats('LOOKING_DOWN').occurrences).toBe(500)
  })

  it('reset forgets everything', () => {
    const t = tracker()
    t.record(ep('LOOKING_DOWN', 0, 3000))
    t.reset()
    expect(t.stats('LOOKING_DOWN').occurrences).toBe(0)
  })
})
