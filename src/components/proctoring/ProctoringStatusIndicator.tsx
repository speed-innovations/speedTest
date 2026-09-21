'use client'
import { CloudOff, UploadCloud, MonitorUp, Video, CheckCircle2, WifiOff } from 'lucide-react'
import type { CaptureState } from '@/lib/proctoring/client/use-proctoring'
import type { ProctoringClientState } from '@/lib/proctoring/types'

/**
 * The small proctoring chip in the exam top bar.
 *
 * It sits next to the existing violation chip and deliberately says as little
 * as possible - but what it says is true. "Evidence saved" appears only when
 * nothing is pending and nothing has failed; anything still queued reads as
 * pending, because telling a candidate their evidence is saved while it sits in
 * a retry loop is the one thing this component must never do.
 */

export default function ProctoringStatusIndicator({
  state,
  capture,
  uploads,
}: {
  state: ProctoringClientState
  capture: CaptureState
  uploads: { pending: number; failed: number; uploaded: number }
}) {
  if (state === 'IDLE' || state === 'CHECKING_DEVICES' || state === 'READY') return null

  const offline = state === 'NETWORK_OFFLINE'

  let uploadIcon = <CheckCircle2 size={12} />
  let uploadText = 'Evidence saved'
  if (uploads.failed > 0) {
    uploadIcon = <CloudOff size={12} />
    uploadText = 'Upload failed'
  } else if (uploads.pending > 0) {
    uploadIcon = <UploadCloud size={12} />
    uploadText = `Saving ${uploads.pending}`
  } else if (uploads.uploaded === 0) {
    // Nothing has been uploaded yet, so there is nothing to call saved. The
    // first segment only closes after a full segment interval.
    uploadIcon = <UploadCloud size={12} />
    uploadText = 'Recording'
  }

  return (
    <div className="flex items-center gap-2 text-xs" aria-label="Proctoring status">
      <span
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${
          capture.recording ? 'bg-red-500/20 text-red-100' : 'bg-white/10 text-white/60'
        }`}
      >
        <Video size={12} />
        {capture.recording ? 'Recording' : 'Not recording'}
      </span>

      <span
        className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${
          capture.screenSharing ? 'bg-white/10 text-white/80' : 'bg-amber-500/25 text-amber-100'
        }`}
      >
        <MonitorUp size={12} />
        {capture.screenSharing ? 'Screen sharing' : 'Screen share stopped'}
      </span>

      <span
        className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${
          uploads.failed > 0 || offline ? 'bg-amber-500/25 text-amber-100' : 'bg-white/10 text-white/70'
        }`}
      >
        {offline ? <WifiOff size={12} /> : uploadIcon}
        {offline ? 'Offline' : uploadText}
      </span>
    </div>
  )
}
