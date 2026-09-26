'use client'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Mic,
  MonitorUp,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import type { RefObject } from 'react'
import type { DeviceStatus } from '@/lib/proctoring/client/use-proctoring'
import type { SupportReport } from '@/lib/proctoring/client/media-support'
import type { ProctoringClientState } from '@/lib/proctoring/types'
import CameraPreview from './CameraPreview'

/**
 * The pre-check the candidate sees before a proctored assessment begins.
 *
 * Two rules shape it. First, the consent copy is verbatim from the PRD and
 * neutral in tone - a candidate is being told what happens, not warned. Second,
 * status is never colour-only: every row pairs an icon and a word, so it reads
 * without colour vision and in a screenshot.
 */

/** Verbatim from the PRD. Do not reword without the product owner. */
export const CONSENT_COPY =
  'This assessment uses your camera, microphone, and periodic screen snapshots to ' +
  'help verify assessment integrity. Camera-based gaze analysis runs locally in ' +
  'your browser and those frames are never uploaded. Recorded media is stored ' +
  'temporarily and is automatically deleted after about three days.'

const ROW_LABEL: Record<DeviceStatus['state'], string> = {
  IDLE: 'Not checked yet',
  CHECKING: 'Checking…',
  READY: 'Ready',
  DENIED: 'Permission denied',
  FAILED: 'Failed',
  NOT_REQUIRED: 'Not required',
}

function StatusIcon({ state }: { state: DeviceStatus['state'] }) {
  if (state === 'READY') return <CheckCircle2 size={16} className="text-green-600" />
  if (state === 'CHECKING') return <Loader2 size={16} className="text-brand-purple animate-spin" />
  if (state === 'DENIED') return <XCircle size={16} className="text-red-600" />
  if (state === 'FAILED') return <AlertTriangle size={16} className="text-amber-600" />
  return <span className="w-4 h-4 rounded-full border border-gray-300 inline-block" />
}

function DeviceRow({
  icon,
  name,
  status,
}: {
  icon: React.ReactNode
  name: string
  status: DeviceStatus
}) {
  return (
    <div className="py-2.5 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-gray-700">
          {icon}
          {name}
        </span>
        <span className="flex items-center gap-1.5 text-sm text-gray-600">
          <StatusIcon state={status.state} />
          {ROW_LABEL[status.state]}
        </span>
      </div>
      {status.message && (
        <p className="text-xs text-gray-500 mt-1.5 pl-6 leading-relaxed">{status.message}</p>
      )}
    </div>
  )
}

export default function ProctoringSetup({
  support,
  devices,
  state,
  startError,
  starting,
  cameraLive,
  videoRef,
  onStart,
}: {
  support: SupportReport
  devices: { camera: DeviceStatus; microphone: DeviceStatus; screen: DeviceStatus }
  state: ProctoringClientState
  startError: { message: string; code?: string } | null
  starting: boolean
  cameraLive: boolean
  videoRef: RefObject<HTMLVideoElement>
  onStart: () => void
}) {
  // An unsupported browser refuses outright. Starting a partially proctored
  // assessment would produce evidence a reviewer cannot rely on, which is worse
  // than not starting - the candidate can switch browser and lose nothing.
  if (!support.supported) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-sm font-semibold text-red-700 flex items-center gap-2 mb-2">
          <XCircle size={16} /> This browser cannot run a proctored assessment
        </p>
        <p className="text-sm text-red-700 leading-relaxed">
          Your browser is missing {support.missing.join(', ')}. Please open this assessment in an
          up-to-date version of Google Chrome, Microsoft Edge, or Firefox on a desktop or laptop
          computer.
        </p>
      </div>
    )
  }

  const denied = state === 'PERMISSION_DENIED'
  const unavailable = state === 'PROCTORING_UNAVAILABLE'

  return (
    <div className="space-y-4">
      <div className="bg-brand-purple/5 border border-brand-purple/20 rounded-lg p-4">
        <p className="text-sm font-semibold text-brand-purple mb-2 flex items-center gap-2">
          <ShieldCheck size={16} /> This is a proctored assessment
        </p>
        <p className="text-sm text-gray-600 leading-relaxed">{CONSENT_COPY}</p>
      </div>

      <CameraPreview videoRef={videoRef} live={cameraLive} size="large" />

      <div className="border border-gray-200 rounded-lg px-4 py-1">
        <DeviceRow
          icon={<Camera size={15} className="text-gray-400" />}
          name="Camera"
          status={devices.camera}
        />
        <DeviceRow
          icon={<Mic size={15} className="text-gray-400" />}
          name="Microphone"
          status={devices.microphone}
        />
        <DeviceRow
          icon={<MonitorUp size={15} className="text-gray-400" />}
          name="Screen sharing"
          status={devices.screen}
        />
      </div>

      {/*
        The storage limit is a routine state at the configured budget, not a
        crash. It gets the calm sentence and no internal reason - the candidate
        can do nothing about a bucket being full, and a code would only alarm.
      */}
      {unavailable && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            Proctored assessment is temporarily unavailable. Please try again later.
          </p>
        </div>
      )}

      {denied && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-red-700 mb-1">
            Permission is required to continue
          </p>
          <p className="text-sm text-red-700 leading-relaxed">
            {devices.screen.message ||
              devices.camera.message ||
              'Camera, microphone, and screen sharing must all be allowed.'}
          </p>
        </div>
      )}

      {startError && !unavailable && !denied && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700 leading-relaxed">{startError.message}</p>
        </div>
      )}

      {/*
        One button, and getDisplayMedia is called from this click. Moving the
        request into an effect would fail: the browser requires a user gesture,
        and there is none on a render.
      */}
      <button
        onClick={onStart}
        disabled={starting}
        className={`${denied || startError ? 'btn-secondary' : 'btn-primary'} w-full justify-center py-3 text-base disabled:opacity-60`}
      >
        {starting ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Setting up…
          </>
        ) : denied || startError ? (
          'Try Again'
        ) : (
          'Start Proctored Assessment'
        )}
      </button>

      <p className="text-xs text-gray-400 text-center leading-relaxed">
        Your assessment timer starts only after all three checks pass.
      </p>
    </div>
  )
}
