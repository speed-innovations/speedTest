'use client'
import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import type { UseProctoringResult } from '@/lib/proctoring/client/use-proctoring'
import type { ProctoringDiagnosticsProps } from './ProctoringDiagnostics'
import CameraPreview from './CameraPreview'
import ProctoringIntegrityBanner from './ProctoringIntegrityBanner'
import ProctoringStatusIndicator from './ProctoringStatusIndicator'
import ProctoringWarning from './ProctoringWarning'

/**
 * The diagnostics panel is loaded here, not with a static import, and only
 * behind a literal `process.env` check written directly in this expression.
 * Webpack's own dead-branch elimination recognises that exact shape (it does
 * not evaluate an imported, already-computed boolean the same way) and drops
 * the `import()` before the module graph is built, so in a production build
 * `ProctoringDiagnostics.tsx` - and its dev-only strings - are never emitted
 * into any chunk, not merely left unreached at runtime.
 */
const ProctoringDiagnosticsPanel: ComponentType<ProctoringDiagnosticsProps> | null =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_PROCTORING_DIAGNOSTICS === 'true'
    ? dynamic(() => import('./ProctoringDiagnostics'))
    : null

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
      {ProctoringDiagnosticsPanel && (
        <ProctoringDiagnosticsPanel snapshot={proctoring.diagnostics} state={proctoring.state} health={proctoring.health} />
      )}
    </>
  )
}
