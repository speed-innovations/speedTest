'use client'
import { Camera, MonitorUp, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ProctoringHealth } from '@/lib/proctoring/client/use-proctoring'
import type { DeviceHealth } from '@/lib/proctoring/client/integrity-monitor'
import type { ProctoringClientState } from '@/lib/proctoring/types'

/**
 * "Proctoring active" - and only when it is true. Everything shown is read
 * from live device health. Nothing mentions recording or saving, because
 * nothing is recorded or saved. Status is never colour-only: every row pairs
 * a dot with a word.
 */

const HIDDEN: ProctoringClientState[] = [
  'IDLE', 'CHECKING_DEVICES', 'READY', 'AWAITING_PERMISSION', 'PERMISSION_DENIED',
  'UNSUPPORTED_BROWSER', 'PROCTORING_UNAVAILABLE', 'COMPLETED',
]

const LABEL: Record<DeviceHealth, string> = {
  ACTIVE: 'Active',
  MUTED: 'Interrupted',
  ENDED: 'Stopped',
  UNAVAILABLE: 'Unavailable',
}

export function needsAttention(state: ProctoringClientState, h: ProctoringHealth): boolean {
  return (
    h.camera !== 'ACTIVE' || h.microphone !== 'ACTIVE' || h.screen !== 'ACTIVE' ||
    h.connection === 'LOST' || state === 'SESSION_INTERRUPTED'
  )
}

function Dot({ ok }: { ok: boolean }) {
  return <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-amber-500'}`} />
}

function Row({ icon, name, health }: { icon: React.ReactNode; name: string; health: DeviceHealth }) {
  const ok = health === 'ACTIVE'
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="flex items-center gap-1.5 text-gray-600">{icon}{name}</span>
      <span className={`flex items-center gap-1.5 ${ok ? 'text-gray-700' : 'text-amber-700 font-medium'}`}>
        <Dot ok={ok} /> {LABEL[health]}
      </span>
    </div>
  )
}

export default function ProctoringStatusIndicator({
  state,
  health,
  variant = 'chip',
}: {
  state: ProctoringClientState
  health: ProctoringHealth
  variant?: 'chip' | 'panel'
}) {
  if (HIDDEN.indexOf(state) !== -1) return null
  const attention = needsAttention(state, health)
  const headline = attention ? 'Proctoring: attention needed' : 'Proctoring active'

  if (variant === 'chip') {
    return (
      <span
        aria-label="Proctoring status"
        data-testid="proctoring-chip"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs ${
          attention ? 'bg-amber-500/25 text-amber-100' : 'bg-white/10 text-white/90'
        }`}
      >
        <Dot ok={!attention} /> {headline}
      </span>
    )
  }

  return (
    <div
      aria-label="Proctoring status"
      data-testid="proctoring-panel"
      className="rounded-lg bg-white border border-gray-200 shadow-lg px-3 py-2 text-xs w-full"
    >
      <p className="flex items-center gap-1.5 font-semibold text-gray-800 uppercase tracking-wide mb-1.5">
        {attention ? <ShieldAlert size={13} className="text-amber-600" /> : <ShieldCheck size={13} className="text-green-600" />}
        {headline}
      </p>
      <Row icon={<Camera size={12} />} name="Camera" health={health.camera} />
      <Row icon={<MonitorUp size={12} />} name="Screen Share" health={health.screen} />
    </div>
  )
}
