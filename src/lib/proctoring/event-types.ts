/**
 * The proctoring event taxonomy, shared by browser and server. No server-only
 * imports, so client code can use it.
 *
 * Every name describes an observation, never a verdict: there is no
 * PHONE_DETECTED (a browser cannot know a phone exists) and nothing like
 * CHEATING. Must match the Prisma enum ProctoringEventType exactly -
 * tests/proctoring-event-types.test.ts enforces it.
 */

export const CLIENT_EVENT_TYPES = [
  'FACE_MISSING',
  'MULTIPLE_FACES',
  'LOOKING_LEFT',
  'LOOKING_RIGHT',
  'LOOKING_UP',
  'LOOKING_DOWN',
  'SUSTAINED_DOWNWARD_ATTENTION',
  'REPEATED_DOWNWARD_ATTENTION',
  'CAMERA_INTERRUPTED',
  'CAMERA_RESTORED',
  'MICROPHONE_INTERRUPTED',
  'MICROPHONE_RESTORED',
  'SCREEN_SHARE_STARTED',
  'SCREEN_SHARE_INTERRUPTED',
  'SCREEN_SHARE_RESUMED',
  'TAB_HIDDEN',
  'TAB_VISIBLE',
  'FULLSCREEN_EXITED',
  'FULLSCREEN_ENTERED',
  'WINDOW_BLUR',
  'WINDOW_FOCUS',
  'PAGE_HIDDEN',
  'GAZE_MONITOR_UNAVAILABLE',
  'PROCTORING_STARTED',
  'PROCTORING_ENDED',
] as const

/**
 * Written only by the server. A client cannot send these: a forged
 * HEARTBEAT_MISSED would be noise, and a suppressed one would hide a gap.
 */
export const SERVER_EVENT_TYPES = ['HEARTBEAT_MISSED', 'PROCTORING_RESUMED'] as const

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number]
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number]
export type ProctoringEventTypeName = ClientEventType | ServerEventType

export const ALL_EVENT_TYPES: ReadonlyArray<ProctoringEventTypeName> =
  (CLIENT_EVENT_TYPES as ReadonlyArray<ProctoringEventTypeName>).concat(SERVER_EVENT_TYPES)

export const LOOKING_TYPES: ReadonlyArray<ProctoringEventTypeName> = [
  'LOOKING_LEFT', 'LOOKING_RIGHT', 'LOOKING_UP', 'LOOKING_DOWN',
]

/**
 * Returns and focus changes are INFO. WINDOW_BLUR is INFO too: a blur is an
 * observation that only means something next to other signals.
 */
const INFO_TYPES: ReadonlyArray<ProctoringEventTypeName> = [
  'TAB_VISIBLE', 'WINDOW_BLUR', 'WINDOW_FOCUS', 'FULLSCREEN_ENTERED', 'FULLSCREEN_EXITED',
  'CAMERA_RESTORED', 'MICROPHONE_RESTORED', 'SCREEN_SHARE_STARTED', 'SCREEN_SHARE_RESUMED',
  'PROCTORING_STARTED', 'PROCTORING_ENDED', 'PROCTORING_RESUMED',
]

export function severityFor(type: ProctoringEventTypeName): 'INFO' | 'WARN' {
  return INFO_TYPES.indexOf(type) === -1 ? 'WARN' : 'INFO'
}
