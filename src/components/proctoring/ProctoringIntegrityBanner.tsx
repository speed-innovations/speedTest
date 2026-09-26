'use client'
import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { INTEGRITY_COPY } from '@/lib/proctoring/client/warning-copy'
import type { UseProctoringResult } from '@/lib/proctoring/client/use-proctoring'

/**
 * Persistent integrity notices, one per live problem, read from device health
 * rather than the single state name, since several can be true at once.
 *
 * Non-blocking: the candidate keeps answering. Screen sharing and the camera
 * can only be re-acquired from a user gesture, hence the buttons.
 */

interface Notice {
  key: string
  message: string
  action?: { label: string; run: () => Promise<boolean> }
}

export default function ProctoringIntegrityBanner({ proctoring }: { proctoring: UseProctoringResult }) {
  const [busy, setBusy] = useState<string | null>(null)
  const { health, state, startError } = proctoring
  const notices: Notice[] = []

  if (state === 'SESSION_INTERRUPTED') {
    const closed = startError?.code === 'PROCTORING_SESSION_CLOSED'
    notices.push({
      key: 'session',
      message: closed ? INTEGRITY_COPY.SESSION_CLOSED : INTEGRITY_COPY.SESSION_INTERRUPTED,
      action: closed ? undefined : { label: 'Resume proctoring', run: proctoring.resumeSession },
    })
  }
  if (health.screen === 'ENDED') {
    notices.push({
      key: 'screen',
      message: INTEGRITY_COPY.SCREEN_SHARE_STOPPED,
      action: { label: 'Resume screen sharing', run: proctoring.resumeScreenShare },
    })
  } else if (health.screen === 'MUTED') {
    notices.push({ key: 'screen-paused', message: INTEGRITY_COPY.SCREEN_SHARE_PAUSED })
  }
  if (health.camera === 'ENDED' || health.microphone === 'ENDED') {
    notices.push({
      key: 'camera',
      message: health.camera === 'ENDED' ? INTEGRITY_COPY.CAMERA_INTERRUPTED : INTEGRITY_COPY.MICROPHONE_INTERRUPTED,
      action: { label: 'Reconnect camera and microphone', run: proctoring.resumeCamera },
    })
  } else if (health.camera === 'MUTED') {
    notices.push({ key: 'camera-muted', message: INTEGRITY_COPY.CAMERA_INTERRUPTED })
  } else if (health.microphone === 'MUTED') {
    notices.push({ key: 'mic-muted', message: INTEGRITY_COPY.MICROPHONE_INTERRUPTED })
  }
  if (health.connection === 'LOST') {
    notices.push({ key: 'connection', message: INTEGRITY_COPY.CONNECTION_LOST })
  }

  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 left-4 z-30 max-w-sm space-y-2">
      {notices.map(n => (
        <div key={n.key} data-testid={`integrity-${n.key}`} className="bg-white border border-amber-300 rounded-lg shadow-lg p-4">
          <p className="text-sm text-amber-800 flex items-start gap-2 leading-relaxed">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{n.message}</span>
          </p>
          {n.action && (
            <button
              onClick={async () => {
                const action = n.action
                if (!action) return
                setBusy(n.key)
                try {
                  await action.run()
                } finally {
                  setBusy(null)
                }
              }}
              disabled={busy !== null}
              className="btn-primary text-sm py-2 w-full justify-center mt-3 disabled:opacity-60"
            >
              {busy === n.key ? <><Loader2 size={14} className="animate-spin" /> Working…</> : n.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
