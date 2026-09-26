import type { DetectionConfig } from './detection-config'
import type { Condition, Episode } from './gaze-state'

/**
 * Remembers patterns across episodes, in memory only.
 *
 * Four separate downward glances in a few minutes say more than any one of
 * them. That can go with looking at something off-screen, but the browser
 * cannot know what, so the signals are named for the behaviour - never
 * PHONE_DETECTED.
 */

export type BehaviourType = 'SUSTAINED_DOWNWARD_ATTENTION' | 'REPEATED_DOWNWARD_ATTENTION'

export interface BehaviourSignal {
  type: BehaviourType
  startedAtMs: number
  endedAtMs: number
  /** Sustained: the episode's duration. Repeated: summed duration in the window. */
  durationMs: number
  confidence: number
  metadata: Record<string, number>
}

export interface PatternStats {
  occurrences: number
  totalDurationMs: number
  maxDurationMs: number
  lastOccurrenceAtMs: number | null
  /** Occurrences still inside the repetition window. */
  recentCount: number
  perMinute: number
}

type Options = Pick<DetectionConfig, 'sustainedDownwardMs' | 'repeatedDownward' | 'maxTrackedOccurrences'>

interface Recent { start: number; end: number; duration: number }

interface Track {
  occurrences: number
  totalDurationMs: number
  maxDurationMs: number
  lastOccurrenceAtMs: number | null
  recent: Recent[]
  sinceRepeated: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export class BehaviourTracker {
  private tracks: { [condition: string]: Track } = {}

  constructor(private readonly opts: Options) {}

  record(ep: Episode): BehaviourSignal[] {
    const t = this.track(ep.condition)
    t.occurrences++
    t.totalDurationMs += ep.durationMs
    t.maxDurationMs = Math.max(t.maxDurationMs, ep.durationMs)
    t.lastOccurrenceAtMs = ep.endedAtMs
    t.recent.push({ start: ep.startedAtMs, end: ep.endedAtMs, duration: ep.durationMs })
    t.sinceRepeated++
    this.prune(t, ep.endedAtMs)

    if (ep.condition !== 'LOOKING_DOWN') return []

    const out: BehaviourSignal[] = []
    if (ep.durationMs >= this.opts.sustainedDownwardMs) {
      out.push({
        type: 'SUSTAINED_DOWNWARD_ATTENTION',
        startedAtMs: ep.startedAtMs,
        endedAtMs: ep.endedAtMs,
        durationMs: ep.durationMs,
        confidence: ep.confidence,
        metadata: { durationMs: ep.durationMs },
      })
    }

    const need = this.opts.repeatedDownward.minOccurrences
    if (t.recent.length >= need && t.sinceRepeated >= need) {
      // Needs another full set before firing again, so one habit does not
      // become a row per glance.
      t.sinceRepeated = 0
      let total = 0
      let max = 0
      for (let i = 0; i < t.recent.length; i++) {
        total += t.recent[i].duration
        if (t.recent[i].duration > max) max = t.recent[i].duration
      }
      const first = t.recent[0]
      const spanMinutes = Math.max(1, (ep.endedAtMs - first.start) / 60_000)
      out.push({
        type: 'REPEATED_DOWNWARD_ATTENTION',
        startedAtMs: first.start,
        endedAtMs: ep.endedAtMs,
        durationMs: total,
        confidence: round2(Math.min(0.95, 0.6 + 0.05 * t.recent.length)),
        metadata: {
          occurrences: t.recent.length,
          totalDurationMs: total,
          maxDurationMs: max,
          perMinute: round2(t.recent.length / spanMinutes),
        },
      })
    }
    return out
  }

  stats(condition: Condition): PatternStats {
    const t = this.tracks[condition]
    if (!t) {
      return { occurrences: 0, totalDurationMs: 0, maxDurationMs: 0, lastOccurrenceAtMs: null, recentCount: 0, perMinute: 0 }
    }
    const first = t.recent.length > 0 ? t.recent[0].start : null
    const spanMinutes = first !== null && t.lastOccurrenceAtMs !== null
      ? Math.max(1, (t.lastOccurrenceAtMs - first) / 60_000)
      : 1
    return {
      occurrences: t.occurrences,
      totalDurationMs: t.totalDurationMs,
      maxDurationMs: t.maxDurationMs,
      lastOccurrenceAtMs: t.lastOccurrenceAtMs,
      recentCount: t.recent.length,
      perMinute: round2(t.recent.length / spanMinutes),
    }
  }

  reset(): void {
    this.tracks = {}
  }

  private track(condition: Condition): Track {
    let t = this.tracks[condition]
    if (!t) {
      t = { occurrences: 0, totalDurationMs: 0, maxDurationMs: 0, lastOccurrenceAtMs: null, recent: [], sinceRepeated: 0 }
      this.tracks[condition] = t
    }
    return t
  }

  /** Drop what fell out of the window, and cap memory regardless. */
  private prune(t: Track, now: number): void {
    const cutoff = now - this.opts.repeatedDownward.windowMs
    while (t.recent.length > 0 && t.recent[0].end < cutoff) t.recent.shift()
    while (t.recent.length > this.opts.maxTrackedOccurrences) t.recent.shift()
  }
}
