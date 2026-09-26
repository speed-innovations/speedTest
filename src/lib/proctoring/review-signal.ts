/**
 * PROCTORING_REVIEW_SIGNAL: an internal prompt for human review.
 *
 * Aggregates the observations recorded for one attempt into a coarse level
 * that tells a reviewer where to look first. It is not a finding of
 * misconduct, it is never shown to the candidate, and it is never an input to
 * scoring - grading.ts does not know it exists.
 *
 * Built so that no single signal decides anything:
 *  - each observation group is capped, so one noisy type cannot dominate;
 *  - ELEVATED needs at least two different substantive kinds of observation;
 *  - focus changes are negligible on their own.
 */

export type ReviewLevel = 'NONE' | 'LOW' | 'MODERATE' | 'ELEVATED'
export type ObservationStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NEGLIGIBLE'

export interface ReviewContribution {
  group: string
  count: number
  points: number
  strength: ObservationStrength
}

export interface ProctoringReviewSignal {
  name: 'PROCTORING_REVIEW_SIGNAL'
  level: ReviewLevel
  score: number
  contributions: ReviewContribution[]
}

export const LONG_FACE_ABSENCE_MS = 10_000

const CAP: Record<ObservationStrength, number> = { STRONG: 9, MODERATE: 5, WEAK: 2, NEGLIGIBLE: 0.5 }

function classify(e: { type: string; durationMs: number | null }):
  { group: string; strength: ObservationStrength; points: number } | null {
  switch (e.type) {
    case 'MULTIPLE_FACES':
    case 'SCREEN_SHARE_INTERRUPTED':
    case 'CAMERA_INTERRUPTED':
      return { group: e.type, strength: 'STRONG', points: 3 }
    case 'FACE_MISSING':
      return (e.durationMs ?? 0) >= LONG_FACE_ABSENCE_MS
        ? { group: 'FACE_MISSING_LONG', strength: 'STRONG', points: 3 }
        : { group: 'FACE_MISSING_BRIEF', strength: 'WEAK', points: 0.5 }
    case 'REPEATED_DOWNWARD_ATTENTION':
      return { group: e.type, strength: 'MODERATE', points: 2 }
    case 'SUSTAINED_DOWNWARD_ATTENTION':
    case 'HEARTBEAT_MISSED':
    case 'MICROPHONE_INTERRUPTED':
      return { group: e.type, strength: 'MODERATE', points: 1.5 }
    case 'TAB_HIDDEN':
    case 'PAGE_HIDDEN':
    case 'GAZE_MONITOR_UNAVAILABLE':
      return { group: e.type, strength: 'MODERATE', points: 1 }
    case 'LOOKING_LEFT':
    case 'LOOKING_RIGHT':
    case 'LOOKING_UP':
    case 'LOOKING_DOWN':
      return { group: 'LOOKING_AWAY', strength: 'WEAK', points: 0.25 }
    case 'FULLSCREEN_EXITED':
      return { group: e.type, strength: 'WEAK', points: 0.25 }
    case 'WINDOW_BLUR':
      return { group: e.type, strength: 'NEGLIGIBLE', points: 0.1 }
    default:
      return null
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function computeReviewSignal(
  events: ReadonlyArray<{ type: string; durationMs: number | null }>
): ProctoringReviewSignal {
  const groups: { [group: string]: ReviewContribution } = {}
  for (let i = 0; i < events.length; i++) {
    const c = classify(events[i])
    if (!c) continue
    const g = groups[c.group] ?? (groups[c.group] = { group: c.group, count: 0, points: 0, strength: c.strength })
    g.count++
    g.points = Math.min(CAP[c.strength], g.points + c.points)
  }

  const contributions = Object.keys(groups)
    .map(k => ({ ...groups[k], points: round1(groups[k].points) }))
    .sort((a, b) => b.points - a.points)

  let score = 0
  for (let i = 0; i < contributions.length; i++) score += contributions[i].points
  score = round1(score)

  let level: ReviewLevel = score >= 8 ? 'ELEVATED' : score >= 4 ? 'MODERATE' : score >= 1 ? 'LOW' : 'NONE'
  const substantive = contributions.filter(c => c.strength === 'STRONG' || c.strength === 'MODERATE').length
  // Aggregate evidence: one kind of observation, however repeated, never
  // reaches the top level on its own.
  if (level === 'ELEVATED' && substantive < 2) level = 'MODERATE'

  return { name: 'PROCTORING_REVIEW_SIGNAL', level, score, contributions }
}
