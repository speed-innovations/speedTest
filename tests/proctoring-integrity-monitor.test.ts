// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IntegrityMonitor, type IntegrityEvent } from '@/lib/proctoring/client/integrity-monitor'

interface FakeTrack {
  readyState: string
  muted: boolean
  listeners: Record<string, Array<() => void>>
  addEventListener: (e: string, cb: () => void) => void
  removeEventListener: (e: string, cb: () => void) => void
  fire: (e: string) => void
}

function fakeTrack(): FakeTrack {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    readyState: 'live',
    muted: false,
    listeners,
    addEventListener(e, cb) { listeners[e] = (listeners[e] || []).concat(cb) },
    removeEventListener(e, cb) { listeners[e] = (listeners[e] || []).filter(x => x !== cb) },
    fire(e) { (listeners[e] || []).slice().forEach(cb => cb()) },
  }
}

let now: number
let events: IntegrityEvent[]
let monitor: IntegrityMonitor

function make() {
  events = []
  return new IntegrityMonitor({ onEvent: e => events.push(e), now: () => now, blurDebounceMs: 300 })
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

const types = () => events.map(e => e.type)

beforeEach(() => {
  now = 1000
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  monitor = make()
})

afterEach(() => {
  monitor.detach()
  vi.useRealTimers()
})

describe('IntegrityMonitor: devices', () => {
  it('reports a watched live track as ACTIVE', () => {
    monitor.watchTrack('camera', fakeTrack() as unknown as MediaStreamTrack)
    expect(monitor.getHealth().camera).toBe('ACTIVE')
  })

  it('camera stopped: CAMERA_INTERRUPTED and ENDED', () => {
    const t = fakeTrack()
    monitor.watchTrack('camera', t as unknown as MediaStreamTrack)
    t.fire('ended')
    expect(types()).toEqual(['CAMERA_INTERRUPTED'])
    expect(events[0].metadata).toEqual({ reason: 'ended' })
    expect(monitor.getHealth().camera).toBe('ENDED')
  })

  it('microphone stopped: MICROPHONE_INTERRUPTED', () => {
    const t = fakeTrack()
    monitor.watchTrack('microphone', t as unknown as MediaStreamTrack)
    t.fire('ended')
    expect(types()).toEqual(['MICROPHONE_INTERRUPTED'])
  })

  it('microphone muted then unmuted: interrupted, then restored with a duration', () => {
    const t = fakeTrack()
    monitor.watchTrack('microphone', t as unknown as MediaStreamTrack)
    t.fire('mute')
    expect(monitor.getHealth().microphone).toBe('MUTED')
    now += 2500
    t.fire('unmute')
    expect(types()).toEqual(['MICROPHONE_INTERRUPTED', 'MICROPHONE_RESTORED'])
    expect(events[1].durationMs).toBe(2500)
    expect(monitor.getHealth().microphone).toBe('ACTIVE')
  })

  it('screen sharing stopped: SCREEN_SHARE_INTERRUPTED, never assumed still active', () => {
    const t = fakeTrack()
    monitor.watchTrack('screen', t as unknown as MediaStreamTrack)
    t.fire('ended')
    expect(types()).toEqual(['SCREEN_SHARE_INTERRUPTED'])
    expect(monitor.getHealth().screen).toBe('ENDED')
  })

  it('screen sharing resumed: watching a new track makes it ACTIVE again', () => {
    const old = fakeTrack()
    monitor.watchTrack('screen', old as unknown as MediaStreamTrack)
    old.fire('ended')
    monitor.watchTrack('screen', fakeTrack() as unknown as MediaStreamTrack)
    expect(monitor.getHealth().screen).toBe('ACTIVE')
    // The old track's listeners are gone, so a late event from it is ignored.
    old.fire('ended')
    expect(types()).toEqual(['SCREEN_SHARE_INTERRUPTED'])
  })

  it('a missing track is UNAVAILABLE, not ACTIVE', () => {
    monitor.watchTrack('camera', undefined)
    expect(monitor.getHealth().camera).toBe('UNAVAILABLE')
  })

  it('a track that is already ended when watched is ENDED', () => {
    const t = fakeTrack()
    t.readyState = 'ended'
    monitor.watchTrack('camera', t as unknown as MediaStreamTrack)
    expect(monitor.getHealth().camera).toBe('ENDED')
  })

  it('notifies health changes', () => {
    const seen: string[] = []
    monitor.detach()
    monitor = new IntegrityMonitor({ onEvent: () => undefined, onHealthChange: h => seen.push(h.camera), now: () => now })
    const t = fakeTrack()
    monitor.watchTrack('camera', t as unknown as MediaStreamTrack)
    t.fire('ended')
    expect(seen).toEqual(['ACTIVE', 'ENDED'])
  })
})

describe('IntegrityMonitor: page', () => {
  beforeEach(() => monitor.attachPage())

  it('tab hidden, then visible with how long it was hidden', () => {
    setVisibility('hidden')
    now += 4000
    setVisibility('visible')
    expect(types()).toEqual(['TAB_HIDDEN', 'TAB_VISIBLE'])
    expect(events[1].durationMs).toBe(4000)
  })

  it('fullscreen exit is reported only after an entry', () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(types()).toEqual([])
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.body })
    document.dispatchEvent(new Event('fullscreenchange'))
    now += 1000
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(types()).toEqual(['FULLSCREEN_ENTERED', 'FULLSCREEN_EXITED'])
  })

  it('a blur that is immediately refocused is flicker, not an event', () => {
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(1000)
    expect(types()).toEqual([])
  })

  it('a held blur is WINDOW_BLUR, stamped at the blur, then WINDOW_FOCUS', () => {
    const blurAt = now
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(500)
    now += 3000
    window.dispatchEvent(new Event('focus'))
    expect(types()).toEqual(['WINDOW_BLUR', 'WINDOW_FOCUS'])
    expect(events[0].atMs).toBe(blurAt)
    expect(events[1].durationMs).toBe(3000)
  })

  it('pagehide is recorded and hands off for a final flush', () => {
    const onPageHide = vi.fn()
    monitor.detach()
    events = []
    monitor = new IntegrityMonitor({ onEvent: e => events.push(e), onPageHide, now: () => now })
    monitor.attachPage()
    window.dispatchEvent(new Event('pagehide'))
    expect(types()).toEqual(['PAGE_HIDDEN'])
    expect(onPageHide).toHaveBeenCalledTimes(1)
  })

  it('detach removes every listener', () => {
    const t = fakeTrack()
    monitor.watchTrack('camera', t as unknown as MediaStreamTrack)
    monitor.detach()
    t.fire('ended')
    setVisibility('hidden')
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(1000)
    expect(types()).toEqual([])
  })
})
