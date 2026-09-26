import { describe, it, expect } from 'vitest'
import { $Enums } from '@prisma/client'
import {
  ALL_EVENT_TYPES, CLIENT_EVENT_TYPES, SERVER_EVENT_TYPES, severityFor,
} from '@/lib/proctoring/event-types'

describe('proctoring event taxonomy', () => {
  it('matches the database enum exactly, so a new type cannot be half-added', () => {
    const db = Object.values($Enums.ProctoringEventType).slice().sort()
    expect(ALL_EVENT_TYPES.slice().sort()).toEqual(db)
  })

  it('keeps server-only types out of what a client may send', () => {
    SERVER_EVENT_TYPES.forEach(t => {
      expect((CLIENT_EVENT_TYPES as ReadonlyArray<string>).indexOf(t)).toBe(-1)
    })
  })

  it('never names a phone or a verdict', () => {
    // Negative lookbehind so MICROPHONE_INTERRUPTED/RESTORED - legitimate
    // taxonomy entries - don't false-positive on the "PHONE" substring.
    expect(ALL_EVENT_TYPES.join(' ')).not.toMatch(/(?<!MICRO)PHONE|CHEAT|CONFIRMED|UPLOAD|RECORD|SCREENSHOT/)
  })

  it('treats returns and focus changes as INFO and interruptions as WARN', () => {
    expect(severityFor('WINDOW_BLUR')).toBe('INFO')
    expect(severityFor('TAB_VISIBLE')).toBe('INFO')
    expect(severityFor('SCREEN_SHARE_INTERRUPTED')).toBe('WARN')
    expect(severityFor('MULTIPLE_FACES')).toBe('WARN')
    expect(severityFor('HEARTBEAT_MISSED')).toBe('WARN')
  })
})
