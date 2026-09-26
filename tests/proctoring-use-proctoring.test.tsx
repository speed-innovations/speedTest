// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { useProctoring } from '@/lib/proctoring/client/use-proctoring'

/**
 * The hook's own behaviour, without any markup.
 *
 * The first case is the one that protects every existing assessment: proctoring
 * must be completely inert when it is switched off. The rest cover the three
 * things the part file calls out as most likely to be wrong - recovery after a
 * reload, teardown on unmount, and a screen share that ends mid-assessment.
 */

vi.mock('@/lib/proctoring/client/gaze-monitor', () => ({
  GazeMonitor: {
    create: vi.fn(() => Promise.resolve({ start: vi.fn(), stop: vi.fn(), hasBaseline: false })),
  },
}))

const SESSION_URL = '/api/student/proctoring/session'
const EVENTS_URL = '/api/student/proctoring/events'

const SESSION_CONFIG = {
  screenshotIntervalMs: 60_000,
  videoSegmentMs: 300_000,
  videoBitsPerSecond: 160_000,
  audioBitsPerSecond: 32_000,
  maxScreenshotBytes: 250_000,
  heartbeatIntervalMs: 20_000,
  screenRequired: true,
}

interface FakeTrack {
  kind: string
  stop: ReturnType<typeof vi.fn>
  listeners: Record<string, Array<() => void>>
  addEventListener: (e: string, cb: () => void) => void
  removeEventListener: (e: string, cb: () => void) => void
  fire: (e: string) => void
}

function fakeTrack(kind: string): FakeTrack {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    kind,
    stop: vi.fn(),
    listeners,
    addEventListener(e, cb) {
      listeners[e] = (listeners[e] || []).concat(cb)
    },
    removeEventListener(e, cb) {
      listeners[e] = (listeners[e] || []).filter(x => x !== cb)
    },
    fire(e) {
      ;(listeners[e] || []).forEach(cb => cb())
    },
  }
}

function fakeStream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
  } as unknown as MediaStream
}

let cameraTracks: FakeTrack[]
let screenTracks: FakeTrack[]
let fetchMock: ReturnType<typeof vi.fn>

const OPTIONS = {
  enabled: true,
  attemptId: 'attempt1',
  kind: 'scheduled' as const,
  parentId: 'sched1',
  currentQuestionId: 'q1',
  alreadyStarted: false,
}

function installMediaRecorder(): void {
  class FakeRecorder {
    state = 'recording'
    ondataavailable: unknown = null
    onstop: (() => void) | null = null
    onerror: unknown = null
    start = vi.fn()
    stop = vi.fn(() => {
      this.state = 'inactive'
      this.onstop?.()
    })
    static isTypeSupported = (t: string) => t.indexOf('webm') !== -1
  }
  ;(globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as { body?: string } | undefined
  return init?.body ? JSON.parse(init.body) : {}
}

beforeEach(() => {
  cameraTracks = [fakeTrack('video'), fakeTrack('audio')]
  screenTracks = [fakeTrack('video')]

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => Promise.resolve(fakeStream(cameraTracks))),
      getDisplayMedia: vi.fn(() => Promise.resolve(fakeStream(screenTracks))),
    },
  })
  installMediaRecorder()

  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never
  HTMLCanvasElement.prototype.toBlob = vi.fn((cb: (b: Blob | null) => void) =>
    cb(new Blob(['x'], { type: 'image/webp' }))) as never
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 })
  HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve())

  fetchMock = vi.fn((url: string) => {
    if (String(url).indexOf(SESSION_URL) === 0) {
      return Promise.resolve(new Response(
        JSON.stringify({
          sessionId: 's1', status: 'ACTIVE', version: '1',
          retentionExpiresAt: new Date().toISOString(), config: SESSION_CONFIG,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ))
    }
    return Promise.resolve(new Response(
      JSON.stringify({ ok: true, accepted: 1, duplicates: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useProctoring', () => {
  it('does nothing whatsoever when proctoring is disabled', () => {
    const getUserMedia = vi.fn()
    const getDisplayMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, getDisplayMedia },
    })
    const disabledFetch = vi.fn()
    vi.stubGlobal('fetch', disabledFetch)

    const { result } = renderHook(() => useProctoring({ ...OPTIONS, enabled: false }))

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(disabledFetch).not.toHaveBeenCalled()
    // Still IDLE: not even the capability check has moved the state, so a
    // non-proctored assessment renders exactly as it did before.
    expect(result.current.state).toBe('IDLE')
    expect(result.current.needsRecovery).toBe(false)
  })

  it('reports needsRecovery for a proctored attempt that is already started', () => {
    const { result } = renderHook(() =>
      useProctoring({ ...OPTIONS, alreadyStarted: true }))

    expect(result.current.needsRecovery).toBe(true)
  })

  it('clears needsRecovery once capture is live again, and never asks for a second session', async () => {
    const { result } = renderHook(() =>
      useProctoring({ ...OPTIONS, alreadyStarted: true }))

    expect(result.current.needsRecovery).toBe(true)

    await act(async () => {
      await result.current.requestPermissionsAndStart()
    })

    expect(result.current.needsRecovery).toBe(false)
    expect(result.current.state).toBe('ACTIVE')
    // Recovery reuses the attempt's session: one POST, and the endpoint is
    // idempotent on the server side.
    const posts = fetchMock.mock.calls.filter(c => String(c[0]).indexOf(SESSION_URL) === 0)
    expect(posts.length).toBe(1)
  })

  it('stops every track on unmount', async () => {
    const { result, unmount } = renderHook(() => useProctoring(OPTIONS))

    await act(async () => {
      await result.current.requestPermissionsAndStart()
    })
    cameraTracks.concat(screenTracks).forEach(t => expect(t.stop).not.toHaveBeenCalled())

    unmount()

    // Camera, microphone, and the display track. A light left on after the
    // candidate navigates away is the most visible possible breach of trust.
    cameraTracks.concat(screenTracks).forEach(t => expect(t.stop).toHaveBeenCalled())
  })

  it('moves to SCREEN_SHARE_STOPPED and emits an event when the screen track ends', async () => {
    const { result } = renderHook(() => useProctoring(OPTIONS))

    await act(async () => {
      await result.current.requestPermissionsAndStart()
    })
    expect(result.current.state).toBe('ACTIVE')
    expect(result.current.capture.screenSharing).toBe(true)

    await act(async () => {
      screenTracks[0].fire('ended')
    })

    expect(result.current.state).toBe('SCREEN_SHARE_STOPPED')
    expect(result.current.capture.screenSharing).toBe(false)

    // The event is queued, then batched out. finalize() forces the flush
    // rather than waiting on the 5s interval.
    await act(async () => {
      await result.current.finalize()
    })

    const eventPosts = fetchMock.mock.calls.filter(c => String(c[0]).indexOf(EVENTS_URL) === 0)
    expect(eventPosts.length).toBeGreaterThan(0)
    const types: string[] = []
    eventPosts.forEach(call => {
      const events = bodyOf(call).events as Array<{ type: string }> | undefined
      ;(events || []).forEach(e => types.push(e.type))
    })
    expect(types).toContain('SCREEN_SHARE_STOPPED')
  })

  it('stops the camera on finalize and closes the session', async () => {
    const { result } = renderHook(() => useProctoring(OPTIONS))

    await act(async () => {
      await result.current.requestPermissionsAndStart()
    })
    await act(async () => {
      await result.current.finalize()
    })

    cameraTracks.forEach(t => expect(t.stop).toHaveBeenCalled())
    expect(result.current.state).toBe('COMPLETED')
    const finalizeCalls = fetchMock.mock.calls.filter(
      c => String(c[0]).indexOf('/api/student/proctoring/finalize') === 0)
    expect(finalizeCalls.length).toBe(1)
  })

  it('surfaces the storage code so recovery can tell a closed session apart', async () => {
    fetchMock = vi.fn((url: string) => {
      if (String(url).indexOf(SESSION_URL) === 0) {
        return Promise.resolve(new Response(
          JSON.stringify({ error: 'PROCTORING_SESSION_CLOSED', code: 'PROCTORING_SESSION_CLOSED' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        ))
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useProctoring({ ...OPTIONS, alreadyStarted: true }))

    await act(async () => {
      await result.current.requestPermissionsAndStart()
    })

    await waitFor(() => {
      expect(result.current.startError?.code).toBe('PROCTORING_SESSION_CLOSED')
    })
    // A session that cannot be reopened must leave recovery showing, not drop
    // the candidate into an unproctored exam.
    expect(result.current.needsRecovery).toBe(true)
  })
})
