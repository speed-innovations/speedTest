'use client'
import { DIAGNOSTICS_ENABLED, type DiagnosticsSnapshot } from '@/lib/proctoring/client/diagnostics'
import type { ProctoringHealth } from '@/lib/proctoring/client/use-proctoring'
import type { ProctoringClientState } from '@/lib/proctoring/types'

/**
 * Development-only live readout, for validating the sign convention and
 * thresholds against a real face (CENTER, LEFT, RIGHT, UP, DOWN, LEFT+DOWN,
 * RIGHT+DOWN).
 *
 * DIAGNOSTICS_ENABLED is the literal `false` in a production build, so this
 * renders nothing there. It also shows raw values that must never reach a
 * candidate.
 */

const fmt = (n: number | null | undefined, digits = 1): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(digits)

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-400">{label}</span>
      <span data-testid={testId} className="text-gray-100">{value}</span>
    </div>
  )
}

export default function ProctoringDiagnostics({
  snapshot,
  state,
  health,
  enabled = DIAGNOSTICS_ENABLED,
}: {
  snapshot: DiagnosticsSnapshot | null
  state: ProctoringClientState
  health: ProctoringHealth
  enabled?: boolean
}) {
  if (!enabled) return null
  const s = snapshot
  return (
    <div
      data-testid="proctoring-diagnostics"
      className="fixed top-16 right-4 z-50 w-64 rounded-lg bg-gray-900/90 text-[11px] font-mono p-3 space-y-0.5 pointer-events-none"
    >
      <p className="text-amber-300 font-semibold mb-1">Proctoring diagnostics (dev only)</p>
      <Row label="Face count" value={s ? String(s.faceCount) : '—'} />
      <Row label="Yaw" value={fmt(s?.yaw)} />
      <Row label="Pitch" value={fmt(s?.pitch)} />
      <Row label="Roll" value={fmt(s?.roll)} />
      <Row label="Iris X" value={fmt(s?.irisX, 3)} testId="diag-iris-x" />
      <Row label="Iris Y" value={fmt(s?.irisY, 3)} />
      <Row label="Quality" value={fmt(s?.quality, 2)} />
      <Row label="Face width" value={fmt(s?.faceWidth, 3)} />
      <Row
        label="Baseline"
        value={s?.baseline ? `${fmt(s.baseline.yaw)} / ${fmt(s.baseline.pitch)} / ${fmt(s.baseline.irisX, 3)}` : 'calibrating'}
      />
      <Row
        label="Deviation"
        value={s ? `${fmt(s.deviation.yaw)} / ${fmt(s.deviation.pitch)} / ${fmt(s.deviation.irisX, 3)} / ${fmt(s.deviation.irisY, 3)}` : '—'}
      />
      <Row label="Direction" value={s ? s.direction : '—'} />
      <Row label="Confidence" value={s ? `${fmt(s.confidence, 2)} (${s.agreement})` : '—'} />
      <Row label="Phase" value={s ? s.phase : '—'} />
      <Row label="Temporal state" value={s ? `${s.temporalState}${s.condition ? ` · ${s.condition}` : ''}` : '—'} />
      <Row label="Proctoring state" value={state} />
      <Row label="Camera" value={health.camera} />
      <Row label="Microphone" value={health.microphone} />
      <Row label="Screen share" value={health.screen} />
      <Row label="Gaze monitor" value={health.gaze} />
      <Row label="Connection" value={health.connection} />
    </div>
  )
}
