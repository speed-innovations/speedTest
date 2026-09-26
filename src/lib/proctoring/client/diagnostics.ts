import type { PipelineOutput, PipelinePhase } from './detection-pipeline'
import type { Baseline, FusedObservation } from './gaze-classify'
import type { TemporalState } from './gaze-state'

/**
 * Development-only diagnostics.
 *
 * Next inlines both variables at build time, so in any production build this
 * is the literal `false`: the hook never computes a snapshot and the panel
 * renders nothing. Enable locally with NEXT_PUBLIC_PROCTORING_DIAGNOSTICS=true
 * in .env.local while running `npm run dev`.
 */
export const DIAGNOSTICS_ENABLED =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_PROCTORING_DIAGNOSTICS === 'true'

export interface DiagnosticsSnapshot {
  faceCount: number
  yaw: number | null
  pitch: number | null
  roll: number | null
  irisX: number | null
  irisY: number | null
  quality: number
  faceWidth: number | null
  baseline: Baseline | null
  deviation: FusedObservation['deviation']
  direction: string
  confidence: number
  agreement: string
  phase: PipelinePhase
  temporalState: TemporalState
  condition: string | null
}

/** "LEFT + DOWN" for a diagonal, so a tester can check both axes at once. */
export function directionLabel(o: FusedObservation): string {
  if (o.direction === 'UNCERTAIN') return 'UNKNOWN'
  if ((o.direction === 'DOWN' || o.direction === 'LEFT' || o.direction === 'RIGHT' || o.direction === 'UP') &&
      o.horizontal && o.vertical) {
    return `${o.horizontal} + ${o.vertical}`
  }
  return o.direction
}

export function toDiagnosticsSnapshot(out: PipelineOutput): DiagnosticsSnapshot {
  const s = out.signals
  return {
    faceCount: s.faceCount,
    yaw: s.yaw, pitch: s.pitch, roll: s.roll,
    irisX: s.irisX, irisY: s.irisY,
    quality: s.quality, faceWidth: s.faceWidth,
    baseline: out.baseline,
    deviation: out.observation.deviation,
    direction: directionLabel(out.observation),
    confidence: out.observation.confidence,
    agreement: out.observation.agreement,
    phase: out.phase,
    temporalState: out.temporal.state,
    condition: out.temporal.condition,
  }
}
