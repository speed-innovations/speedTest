'use client'
import type { UseProctoringResult } from '@/lib/proctoring/client/use-proctoring'
import CameraPreview from './CameraPreview'
import ProctoringDiagnostics from './ProctoringDiagnostics'
import ProctoringIntegrityBanner from './ProctoringIntegrityBanner'
import ProctoringStatusIndicator from './ProctoringStatusIndicator'
import ProctoringWarning from './ProctoringWarning'

/**
 * Everything proctoring puts on screen during the exam, in one element, so
 * the two near-identical candidate pages each render exactly one line of it.
 *
 * The self-view and the status panel sit together so the candidate can see,
 * at all times, that the camera is live and monitoring is active.
 */
export default function ProctoringExamOverlay({ proctoring }: { proctoring: UseProctoringResult }) {
  return (
    <>
      <ProctoringWarning warning={proctoring.warning} />
      <ProctoringIntegrityBanner proctoring={proctoring} />
      <div className="fixed bottom-4 right-4 z-30 w-48 space-y-2">
        <CameraPreview videoRef={proctoring.videoRef} live={proctoring.capture.cameraLive} size="small" />
        <ProctoringStatusIndicator variant="panel" state={proctoring.state} health={proctoring.health} />
      </div>
      <ProctoringDiagnostics snapshot={proctoring.diagnostics} state={proctoring.state} health={proctoring.health} />
    </>
  )
}
