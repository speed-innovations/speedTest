'use client'

/**
 * The observation timeline.
 *
 * Every label here describes what was observed and nothing about what it means.
 * "Looking left for 2.1s" - never "cheating detected", never a risk score,
 * never a red SUSPICIOUS badge, and no ranking of candidates by warning count.
 * A reviewer draws the conclusion; this supplies the observation.
 *
 * That is a correctness requirement, not a tone preference. Gaze classification
 * is a heuristic over head pose and iris offset with a baseline taken from the
 * first few seconds of the session - it cannot distinguish thinking from
 * looking at a phone, and a score computed from it would read as authoritative
 * while being nothing of the kind.
 */

export interface TimelineEvent {
  id: string
  type: string
  direction: string | null
  occurredAt: string | Date
  elapsedMs: number | null
  durationMs: number | null
  severity: string
}

/** Plain descriptions of the observation. No judgement, no severity language. */
const DESCRIPTION: Record<string, string> = {
  GAZE_LEFT: 'Looking left',
  GAZE_RIGHT: 'Looking right',
  GAZE_UP: 'Looking up',
  GAZE_DOWN: 'Looking down',
  FACE_NOT_DETECTED: 'Face not detected',
  MULTIPLE_FACES_DETECTED: 'Second face detected',
  SCREEN_SHARE_STOPPED: 'Screen sharing stopped',
  SCREEN_SHARE_RESUMED: 'Screen sharing resumed',
  CAMERA_STOPPED: 'Camera stopped',
  MICROPHONE_STOPPED: 'Microphone stopped',
  TAB_HIDDEN: 'Browser tab hidden',
  WINDOW_BLURRED: 'Window lost focus',
  PROCTORING_STARTED: 'Proctoring started',
  PROCTORING_ENDED: 'Proctoring ended',
  UPLOAD_FAILURE: 'Evidence upload failed',
  UPLOAD_RECOVERED: 'Evidence upload recovered',
}

function formatElapsed(ms: number | null): string {
  if (ms === null) return '--:--:--'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

function formatDuration(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null
  return `${(ms / 1000).toFixed(1)}s`
}

export default function EventTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
        <p className="text-sm text-gray-500">No proctoring observations were recorded for this attempt.</p>
      </div>
    )
  }

  // Ordered by elapsedMs so the timeline lines up with the segments and
  // screenshots, which are indexed on the same axis. Events with no elapsedMs
  // fall back to the clock so they still land in a sensible place.
  const ordered = events.slice().sort((a, b) => {
    const ae = a.elapsedMs
    const be = b.elapsedMs
    if (ae !== null && be !== null) return ae - be
    if (ae !== null) return -1
    if (be !== null) return 1
    return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  })

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
        {ordered.map(e => {
          const duration = formatDuration(e.durationMs)
          return (
            <div key={e.id} className="flex items-baseline gap-3 px-4 py-2 text-sm hover:bg-gray-50">
              <span className="font-mono text-xs text-gray-400 flex-shrink-0 w-[4.5rem]">
                {formatElapsed(e.elapsedMs)}
              </span>
              <span className="text-gray-700 flex-1 min-w-0">
                {DESCRIPTION[e.type] ?? e.type.toLowerCase().replace(/_/g, ' ')}
              </span>
              {duration && (
                <span className="font-mono text-xs text-gray-500 flex-shrink-0">{duration}</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
        {/*
          A count, deliberately not a rate, a percentile or a grade. It says how
          much there is to read, not how bad it is.
        */}
        {ordered.length} observation{ordered.length === 1 ? '' : 's'} recorded. Times are relative
        to the start of the attempt.
      </div>
    </div>
  )
}
