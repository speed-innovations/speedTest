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
  startedAt: string | Date
  endedAt?: string | Date | null
  elapsedMs: number | null
  durationMs: number | null
  confidence?: number | null
  severity: string
  metadata?: unknown
}

/** Plain descriptions of the observation. No judgement, no severity language. */
const DESCRIPTION: Record<string, string> = {
  FACE_MISSING: 'Face not visible',
  MULTIPLE_FACES: 'More than one face visible',
  LOOKING_LEFT: 'Looking left',
  LOOKING_RIGHT: 'Looking right',
  LOOKING_UP: 'Looking up',
  LOOKING_DOWN: 'Looking down',
  SUSTAINED_DOWNWARD_ATTENTION: 'Sustained downward attention',
  REPEATED_DOWNWARD_ATTENTION: 'Repeated downward attention',
  CAMERA_INTERRUPTED: 'Camera interrupted',
  CAMERA_RESTORED: 'Camera restored',
  MICROPHONE_INTERRUPTED: 'Microphone interrupted',
  MICROPHONE_RESTORED: 'Microphone restored',
  SCREEN_SHARE_STARTED: 'Screen sharing started',
  SCREEN_SHARE_INTERRUPTED: 'Screen sharing interrupted',
  SCREEN_SHARE_RESUMED: 'Screen sharing resumed',
  TAB_HIDDEN: 'Assessment tab hidden',
  TAB_VISIBLE: 'Assessment tab visible again',
  FULLSCREEN_EXITED: 'Left full screen',
  FULLSCREEN_ENTERED: 'Entered full screen',
  WINDOW_BLUR: 'Window lost focus',
  WINDOW_FOCUS: 'Window regained focus',
  PAGE_HIDDEN: 'Page closed or navigated away',
  GAZE_MONITOR_UNAVAILABLE: 'Gaze analysis could not run',
  PROCTORING_STARTED: 'Proctoring started',
  PROCTORING_ENDED: 'Proctoring ended',
  HEARTBEAT_MISSED: 'Proctoring connection gap',
  PROCTORING_RESUMED: 'Proctoring resumed',
}

function describeEvent(e: TimelineEvent): string {
  const base = DESCRIPTION[e.type] ?? e.type.toLowerCase().replace(/_/g, ' ')
  const meta = (e.metadata ?? null) as { horizontal?: unknown } | null
  if (e.type === 'LOOKING_DOWN' && meta && (meta.horizontal === 'LEFT' || meta.horizontal === 'RIGHT')) {
    return `${base} and ${String(meta.horizontal).toLowerCase()}`
  }
  return base
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

  // Ordered by elapsedMs - time since monitoring started - so the timeline
  // reads in exam order. Events with no elapsedMs fall back to the clock so
  // they still land in a sensible place.
  const ordered = events.slice().sort((a, b) => {
    const ae = a.elapsedMs
    const be = b.elapsedMs
    if (ae !== null && be !== null) return ae - be
    if (ae !== null) return -1
    if (be !== null) return 1
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
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
                {describeEvent(e)}
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
