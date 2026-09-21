'use client'
import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import RecordingPlayer, { type PlayableSegment } from './RecordingPlayer'
import ScreenshotGallery, { type GalleryShot } from './ScreenshotGallery'
import EventTimeline, { type TimelineEvent } from './EventTimeline'

/**
 * The proctoring section of the results detail modal.
 *
 * Collapsed by default and fetching nothing until opened, so the score review
 * flow is byte-for-byte unchanged for anyone not looking at proctoring - which
 * is most reviewers, most of the time, since most attempts are not proctored.
 *
 * Mounted beneath the existing tab-switch violations strip, which stays. Those
 * violations and these events come from different mechanisms measuring
 * different things; merging them into one count would misrepresent both.
 */

interface Evidence {
  session: {
    id: string
    status: string
    version: string
    startedAt: string | null
    endedAt: string | null
    retentionExpiresAt: string
    recordingStarted: boolean
    screenShareStarted: boolean
    storageUsedBytes: number
    uploadFailureCount: number
    gazeWarningCount: number
  } | null
  assets: Array<PlayableSegment & GalleryShot & { type: string }>
  events: TimelineEvent[]
}

type Tab = 'recording' | 'screenshots' | 'timeline'

function formatMB(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const mb = bytes / 1_000_000
  return mb < 1 ? `${Math.round(bytes / 1000)} KB` : `${mb.toFixed(1)} MB`
}

export default function ProctoringPanel({
  attemptId,
  type,
  questionOrder,
}: {
  attemptId: string
  type: 'scheduled' | 'walkin'
  questionOrder?: string[]
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [tab, setTab] = useState<Tab>('recording')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/proctoring/${attemptId}?type=${type}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Could not load proctoring evidence.')
        return
      }
      setEvidence(data as Evidence)
    } catch {
      setError('Could not load proctoring evidence.')
    } finally {
      setLoading(false)
    }
  }, [attemptId, type])

  useEffect(() => {
    // Only on first open: nothing is fetched for a reviewer who never expands
    // this, which is the point of it being collapsed.
    if (open && !evidence && !loading && !error) void load()
  }, [open, evidence, loading, error, load])

  const segments = (evidence?.assets ?? []).filter(a => a.type === 'WEBCAM_SEGMENT')
  const shots = (evidence?.assets ?? []).filter(a => a.type === 'SCREENSHOT')

  return (
    <div className="border-b border-gray-100">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-6 py-3 flex items-center gap-2 text-sm text-gray-700 hover:bg-gray-50"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <ShieldCheck size={15} className="text-brand-purple" />
        <span className="font-medium">Proctoring evidence</span>
        <span className="text-xs text-gray-400 ml-auto">
          {open ? 'Hide' : 'Review recording, snapshots and observations'}
        </span>
      </button>

      {open && (
        <div className="px-6 pb-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <Loader2 size={15} className="animate-spin" /> Loading evidence…
            </div>
          )}

          {error && !loading && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && evidence && !evidence.session && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
              <ShieldOff size={22} className="text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 font-medium">This attempt was not proctored</p>
              <p className="text-xs text-gray-500 mt-1">
                Proctoring was not enabled on this assessment, so no recording, snapshots or
                observations exist.
              </p>
            </div>
          )}

          {!loading && !error && evidence?.session && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
                <span>Session <span className="text-gray-700">{evidence.session.status.toLowerCase()}</span></span>
                <span>Detection version <span className="text-gray-700">{evidence.session.version}</span></span>
                <span>Recording <span className="text-gray-700">{evidence.session.recordingStarted ? 'started' : 'never started'}</span></span>
                <span>Screen sharing <span className="text-gray-700">{evidence.session.screenShareStarted ? 'started' : 'never started'}</span></span>
                <span>Stored <span className="text-gray-700">{formatMB(evidence.session.storageUsedBytes)}</span></span>
                <span>
                  Evidence available until{' '}
                  <span className="text-gray-700">
                    {new Date(evidence.session.retentionExpiresAt).toLocaleString()}
                  </span>
                </span>
              </div>

              <div className="flex gap-1 border-b border-gray-200">
                {([
                  ['recording', `Recording (${segments.length})`],
                  ['screenshots', `Screen snapshots (${shots.length})`],
                  ['timeline', `Observations (${evidence.events.length})`],
                ] as Array<[Tab, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                      tab === key
                        ? 'border-brand-purple text-brand-purple font-medium'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'recording' && <RecordingPlayer segments={segments} />}
              {tab === 'screenshots' && (
                <ScreenshotGallery shots={shots} questionOrder={questionOrder} />
              )}
              {tab === 'timeline' && <EventTimeline events={evidence.events} />}

              <p className="text-xs text-gray-400 leading-relaxed">
                Observations describe what the browser detected, not what it means. Gaze analysis
                is a heuristic and cannot distinguish thinking from looking away — read the
                recording alongside the timeline before drawing any conclusion.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
