'use client'
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import type { DeviceStatus } from '@/lib/proctoring/client/use-proctoring'
import type { ProctoringClientState } from '@/lib/proctoring/types'

/**
 * Shown when a proctored attempt is already in progress but nothing is being
 * captured - almost always because the candidate reloaded the page.
 *
 * This screen is not a nicety. The page sets `testStarted` directly on reload,
 * with no user gesture anywhere on that path, and `getDisplayMedia()` requires
 * one. An explicit button is the only legal way back into capture, so a
 * proctored attempt that is started but has no live media must land here rather
 * than on the questions.
 *
 * It creates nothing. Resuming calls the same session endpoint the first start
 * did, which is idempotent by design - there is one proctoring session per
 * attempt and this reuses it.
 */

export default function ProctoringRecovery({
  state,
  startError,
  devices,
  resuming,
  timeLeftLabel,
  onResume,
}: {
  state: ProctoringClientState
  startError: { message: string; code?: string } | null
  devices: { camera: DeviceStatus; microphone: DeviceStatus; screen: DeviceStatus }
  resuming: boolean
  timeLeftLabel?: string
  onResume: () => void
}) {
  // A session that was swept as abandoned cannot be reopened - the unique index
  // on the attempt is per attempt, not per attempt-and-status. Say so plainly
  // instead of offering a button that will fail again.
  const closed = startError?.code === 'PROCTORING_SESSION_CLOSED'
  const denied = state === 'PERMISSION_DENIED'

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="card max-w-lg w-full">
        <div className="text-center mb-5">
          <div className="w-16 h-16 bg-brand-purple/10 rounded-full flex items-center justify-center mx-auto mb-3">
            <ShieldCheck size={30} className="text-brand-purple" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">Your assessment is still in progress</h1>
          <p className="text-gray-500 text-sm mt-2 leading-relaxed">
            Your answers and your remaining time are safe. Because the page was reloaded, your
            browser needs your permission again before proctoring can continue.
          </p>
          {timeLeftLabel && (
            <p className="text-sm text-gray-600 mt-3">
              Time remaining: <span className="font-mono font-semibold">{timeLeftLabel}</span>
            </p>
          )}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5">
          <p className="text-sm text-amber-800 leading-relaxed flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            The assessment clock is still running. Resume as soon as you can — your camera,
            microphone, and screen sharing must be allowed again to continue.
          </p>
        </div>

        {closed ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-red-700 mb-1">
              Proctoring could not be resumed
            </p>
            <p className="text-sm text-red-700 leading-relaxed">
              This attempt&apos;s proctoring session was closed after the connection was lost for
              too long, and it cannot be reopened. Please contact your invigilator or the
              assessment coordinator now — do not close this page.
            </p>
          </div>
        ) : (
          <>
            {denied && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-700 leading-relaxed">
                  {devices.screen.message ||
                    devices.camera.message ||
                    'Camera, microphone, and screen sharing must all be allowed.'}
                </p>
              </div>
            )}
            {startError && !denied && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-700 leading-relaxed">{startError.message}</p>
              </div>
            )}
            <button
              onClick={onResume}
              disabled={resuming}
              className="btn-primary w-full justify-center py-3 text-base disabled:opacity-60"
            >
              {resuming ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Resuming…
                </>
              ) : (
                <>
                  <RefreshCw size={16} /> Resume Proctored Assessment
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
