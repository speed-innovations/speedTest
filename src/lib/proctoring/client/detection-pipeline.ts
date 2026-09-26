import type { ClientEventType } from '../event-types'
import { DETECTION_CONFIG, type DetectionConfig } from './detection-config'
import { fuseSignals, type Baseline, type FrameSignals, type FusedObservation } from './gaze-classify'
import { BaselineCollector } from './baseline'
import { TemporalEngine, type Condition, type Episode, type TemporalOutput } from './gaze-state'
import { BehaviourTracker } from './behaviour-tracker'
import type { WarningKind } from './warning-copy'

/**
 * The pure detection chain, one frame at a time:
 *
 *   FrameSignals -> baseline -> fusion -> temporal engine -> behaviour tracker
 *                -> { warnings for the candidate, metadata events for the server }
 *
 * No MediaPipe, no DOM, no clock of its own - gaze-monitor.ts feeds it - so
 * every scenario in the spec is testable in the node runner.
 */

export type PipelinePhase = 'CALIBRATING' | 'MONITORING'

export interface DetectionEvent {
  type: ClientEventType
  startedAtMs: number
  endedAtMs: number
  durationMs: number
  confidence: number
  direction?: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
  metadata?: Record<string, string | number | boolean>
}

export interface PipelineOutput {
  phase: PipelinePhase
  signals: FrameSignals
  observation: FusedObservation
  baseline: Baseline | null
  temporal: TemporalOutput
  warnings: WarningKind[]
  events: DetectionEvent[]
}

/** Presence checks never read the baseline, so any value serves before calibration. */
const PRESENCE_ONLY: Baseline = { yaw: 0, pitch: 0, irisX: null, irisY: null }

const DIRECTION: { [c: string]: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' } = {
  LOOKING_LEFT: 'LEFT', LOOKING_RIGHT: 'RIGHT', LOOKING_UP: 'UP', LOOKING_DOWN: 'DOWN',
}

function warningFor(c: Condition): WarningKind {
  if (c === 'FACE_MISSING') return 'FACE_MISSING'
  if (c === 'MULTIPLE_FACES') return 'MULTIPLE_FACES'
  return 'LOOK_AT_SCREEN'
}

function centred(quality: number): FusedObservation {
  return {
    direction: 'CENTER', horizontal: null, vertical: null, confidence: quality, agreement: 'NONE',
    deviation: { yaw: null, pitch: null, irisX: null, irisY: null },
  }
}

export class DetectionPipeline {
  private readonly collector: BaselineCollector
  private readonly temporal: TemporalEngine
  private readonly behaviour: BehaviourTracker
  private current: Baseline | null = null
  private prev: FusedObservation | null = null

  constructor(private readonly cfg: DetectionConfig = DETECTION_CONFIG) {
    this.collector = new BaselineCollector(cfg.baseline, cfg.quality.minQuality)
    this.temporal = new TemporalEngine(cfg)
    this.behaviour = new BehaviourTracker(cfg)
  }

  process(s: FrameSignals, tMs: number): PipelineOutput {
    let observation: FusedObservation
    if (s.faceCount !== 1) {
      // Presence is judged even while calibrating.
      observation = fuseSignals(s, this.current ?? PRESENCE_ONLY, this.cfg, this.prev)
    } else if (!this.current) {
      const b = this.collector.add(s, tMs)
      if (b) this.current = b
      // Nothing to measure deviation against yet. A single face reads as
      // centred, which also closes a FACE_MISSING run when the face returns.
      observation = centred(s.quality)
    } else {
      observation = fuseSignals(s, this.current, this.cfg, this.prev)
    }
    this.prev = observation

    const temporal = this.temporal.observe(observation, tMs)
    const warnings: WarningKind[] = []
    const events: DetectionEvent[] = []
    if (temporal.warning) warnings.push(warningFor(temporal.warning))
    if (temporal.ended) this.handleEnded(temporal.ended, events, warnings)

    return {
      phase: this.current ? 'MONITORING' : 'CALIBRATING',
      signals: s,
      observation,
      baseline: this.current,
      temporal,
      warnings,
      events,
    }
  }

  /** Close whatever is in progress - on finalize, so the last episode is kept. */
  flush(tMs: number): DetectionEvent[] {
    const events: DetectionEvent[] = []
    const ep = this.temporal.flush(tMs)
    if (ep) this.handleEnded(ep, events, [])
    return events
  }

  reset(): void {
    this.collector.reset()
    this.temporal.reset()
    this.behaviour.reset()
    this.current = null
    this.prev = null
  }

  get baseline(): Baseline | null {
    return this.current
  }

  private handleEnded(ep: Episode, events: DetectionEvent[], warnings: WarningKind[]): void {
    const direction = DIRECTION[ep.condition]
    events.push({
      type: ep.condition,
      startedAtMs: ep.startedAtMs,
      endedAtMs: ep.endedAtMs,
      durationMs: ep.durationMs,
      confidence: ep.confidence,
      direction,
      metadata: ep.condition === 'LOOKING_DOWN' && ep.horizontal ? { horizontal: ep.horizontal } : undefined,
    })
    const signals = this.behaviour.record(ep)
    for (let i = 0; i < signals.length; i++) {
      const b = signals[i]
      events.push({
        type: b.type, startedAtMs: b.startedAtMs, endedAtMs: b.endedAtMs,
        durationMs: b.durationMs, confidence: b.confidence, metadata: b.metadata,
      })
      if (warnings.indexOf('DOWNWARD_ATTENTION') === -1) warnings.push('DOWNWARD_ATTENTION')
    }
  }
}
