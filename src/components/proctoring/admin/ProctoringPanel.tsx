'use client'
import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import EventTimeline, { type TimelineEvent } from './EventTimeline'
import type { ProctoringReviewSignal } from '@/lib/proctoring/review-signal'

/**
 * The proctoring section of the results detail modal. Collapsed by default and
 * fetching nothing until opened, so score review is unchanged for reviewers who
 * never expand it. Metadata only: there is no recording to play.
 */

interface Evidence {
  session: {
    id: string
    status: string
    version: string
    startedAt: string | null
    endedAt: string | null
    lastHeartbeatAt: string | null
    screenShareStarted: boolean
    gazeWarningCount: number
    missedHeartbeatCount: number
  } | null
  events: TimelineEvent[]
  reviewSignal: ProctoringReviewSignal | null
}

const LEVEL_TEXT: Record<ProctoringReviewSignal['level'], string> = {
  NONE: 'No notable observations',
  LOW: 'Low - a few observations',
  MODERATE: 'Moderate - worth a closer look',
  ELEVATED: 'Elevated - review this attempt',
}

const GROUP_TEXT: Record<string, string> = {
  MULTIPLE_FACES: 'More than one face visible',
  SCREEN_SHARE_INTERRUPTED: 'Screen sharing interrupted',
  CAMERA_INTERRUPTED: 'Camera interrupted',
  FACE_MISSING_LONG: 'Face not visible for a long stretch',
  FACE_MISSING_BRIEF: 'Face briefly not visible',
  REPEATED_DOWNWARD_ATTENTION: 'Repeated downward attention',
  SUSTAINED_DOWNWARD_ATTENTION: 'Sustained downward attention',
  HEARTBEAT_MISSED: 'Proctoring connection gaps',
  MICROPHONE_INTERRUPTED: 'Microphone interrupted',
  TAB_HIDDEN: 'Assessment tab hidden',
  PAGE_HIDDEN: 'Page closed or navigated away',
  GAZE_MONITOR_UNAVAILABLE: 'Gaze analysis could not run',
  LOOKING_AWAY: 'Looking away from the screen',
  FULLSCREEN_EXITED: 'Left full screen',
  WINDOW_BLUR: 'Window lost focus',
}

function ReviewSignalCard({ signal }: { signal: ProctoringReviewSignal }) {
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3 text-sm">
      <p className="text-gray-700">
        <span className="font-medium">Review signal:</span> {LEVEL_TEXT[signal.level]}
      </p>
      {signal.contributions.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
          {signal.contributions.map(c => (
            <li key={c.group}>
              {GROUP_TEXT[c.group] ?? c.group.toLowerCase().replace(/_/g, ' ')} ×{c.count}
              <span className="text-gray-400"> ({c.strength.toLowerCase()})</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-gray-400 leading-relaxed">
        A prompt for where to look first, built from the observations below. It is not a
        finding of misconduct and is never used in scoring.
      </p>
    </div>
  )
}

export default function ProctoringPanel({
  attemptId,
  type,
}: {
  attemptId: string
  type: 'scheduled' | 'walkin'
  questionOrder?: string[]
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<Evidence | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/proctoring/${attemptId}?type=${type}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Could not load proctoring observations.')
        return
      }
      setEvidence(data as Evidence)
    } catch {
      setError('Could not load proctoring observations.')
    } finally {
      setLoading(false)
    }
  }, [attemptId, type])

  useEffect(() => {
    if (open && !evidence && !loading && !error) void load()
  }, [open, evidence, loading, error, load])

  return (
    <div className="border-b border-gray-100">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-6 py-3 flex items-center gap-2 text-sm text-gray-700 hover:bg-gray-50"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <ShieldCheck size={15} className="text-brand-purple" />
        <span className="font-medium">Proctoring observations</span>
        <span className="text-xs text-gray-400 ml-auto">{open ? 'Hide' : 'Review monitoring events'}</span>
      </button>

      {open && (
        <div className="px-6 pb-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          )}
          {error && !loading && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
          )}
          {!loading && !error && evidence && !evidence.session && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
              <ShieldOff size={22} className="text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 font-medium">This attempt was not proctored</p>
            </div>
          )}
          {!loading && !error && evidence?.session && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
                <span>Session <span className="text-gray-700">{evidence.session.status.toLowerCase()}</span></span>
                <span>Detection version <span className="text-gray-700">{evidence.session.version}</span></span>
                <span>Screen sharing <span className="text-gray-700">{evidence.session.screenShareStarted ? 'started' : 'never started'}</span></span>
                <span>Connection gaps <span className="text-gray-700">{evidence.session.missedHeartbeatCount}</span></span>
              </div>
              {evidence.reviewSignal && <ReviewSignalCard signal={evidence.reviewSignal} />}
              <EventTimeline events={evidence.events} />
              <p className="text-xs text-gray-400 leading-relaxed">
                Observations describe what the browser detected, not what it means. No video, audio
                or screenshots were stored. Gaze analysis is an estimate and cannot distinguish
                thinking from looking away.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
