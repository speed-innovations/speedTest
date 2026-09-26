// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'

/**
 * The hook end to end with fake devices and a fake network. MediaPipe is
 * mocked (it never loads under jsdom); the pipeline has its own node tests.
 * The first case protects every existing assessment: off means inert.
 */

type Fn = ReturnType<typeof vi.fn>

// vi.hoisted: the mock factory below is hoisted above every import, so the
// object it closes over must be hoisted too. The fns are assigned in beforeEach.
const gaze = vi.hoisted(() => ({
  onOutput: null as null | ((o: unknown) => void),
  onError: null as null | ((err: unknown) => void),
  start: null as unknown as Fn,
  stop: null as unknown as Fn,
  flush: null as unknown as Fn,
}))

vi.mock('@/lib/proctoring/client/gaze-monitor', () => ({
  GazeMonitor: {
    create: (opts: { onOutput: (o: unknown) => void; onError?: (err: unknown) => void }) => {
      gaze.onOutput = opts.onOutput
      gaze.onError = opts.onError ?? null
      return Promise.resolve({ start: gaze.start, stop: gaze.stop, flush: gaze.flush })
    },
  },
}))

import { useProctoring, clampHeartbeatInterval } from '@/lib/proctoring/client/use-proctoring'

const SESSION_URL = '/api/student/proctoring/session'
const EVENTS_URL = '/api/student/proctoring/events'
const HEARTBEAT_URL = '/api/student/proctoring/heartbeat'
const FINALIZE_URL = '/api/student/proctoring/finalize'

interface FakeTrack {
  kind: string
  readyState: string
  muted: boolean
  stop: ReturnType<typeof vi.fn>
  getSettings: () => { displaySurface: string }
  addEventListener: (e: string, cb: () => void) => void
  removeEventListener: (e: string, cb: () => void) => void
  fire: (e: string) => void
}

function fakeTrack(kind: string): FakeTrack {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    kind, readyState: 'live', muted: false, stop: vi.fn(),
    getSettings: () => ({ displaySurface: 'monitor' }),
    addEventListener(e, cb) { listeners[e] = (listeners[e] || []).concat(cb) },
    removeEventListener(e, cb) { listeners[e] = (listeners[e] || []).filter(x => x !== cb) },
    fire(e) { (listeners[e] || []).slice().forEach(cb => cb()) },
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
let heartbeatReply: () => Promise<Response>
let eventsReply: () => Promise<Response>

const OPTIONS = {
  enabled: true, attemptId: 'attempt1', kind: 'scheduled' as const,
  parentId: 'sched1', currentQuestionId: 'q1', alreadyStarted: false,
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as { body?: string } | undefined
  return init?.body ? JSON.parse(init.body) : {}
}

const callsTo = (url: string) => fetchMock.mock.calls.filter(c => String(c[0]).indexOf(url) === 0)
const sentTypes = () => callsTo(EVENTS_URL).reduce<string[]>(
  (a, c) => a.concat((bodyOf(c).events as Array<{ type: string }>).map(e => e.type)), []
)

async function started() {
  const hook = renderHook(() => useProctoring(OPTIONS))
  await act(async () => { await hook.result.current.requestPermissionsAndStart() })
  await waitFor(() => expect(hook.result.current.state).toBe('ACTIVE'))
  return hook
}

beforeEach(() => {
  gaze.onOutput = null
  gaze.onError = null
  gaze.start = vi.fn()
  gaze.stop = vi.fn()
  gaze.flush = vi.fn(() => [])
  cameraTracks = [fakeTrack('video'), fakeTrack('audio')]
  screenTracks = [fakeTrack('video')]
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => Promise.resolve(fakeStream(cameraTracks))),
      getDisplayMedia: vi.fn(() => Promise.resolve(fakeStream(screenTracks))),
    },
  })
  HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve())
  heartbeatReply = () => json({ ok: true, session: { sessionId: 's1', status: 'ACTIVE' } })
  eventsReply = () => json({ accepted: 1, duplicates: 0, capped: false, session: 's1' })
  fetchMock = vi.fn((url: string) => {
    const u = String(url)
    if (u.indexOf(SESSION_URL) === 0) {
      return json({
        sessionId: 's1', status: 'ACTIVE', version: '2', resumed: false,
        retentionExpiresAt: new Date().toISOString(),
        config: { heartbeatIntervalMs: 20_000, screenRequired: true },
      })
    }
    if (u.indexOf(HEARTBEAT_URL) === 0) return heartbeatReply()
    if (u.indexOf(FINALIZE_URL) === 0) return json({ ok: true, alreadyFinalized: false })
    return eventsReply()
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useProctoring: regression', () => {
  it('does nothing whatsoever when proctoring is disabled', () => {
    const getUserMedia = vi.fn()
    const getDisplayMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, getDisplayMedia } })
    const disabledFetch = vi.fn()
    vi.stubGlobal('fetch', disabledFetch)
    const { result } = renderHook(() => useProctoring({ ...OPTIONS, enabled: false }))
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(disabledFetch).not.toHaveBeenCalled()
    expect(result.current.state).toBe('IDLE')
    expect(result.current.needsRecovery).toBe(false)
  })
})

describe('useProctoring: session', () => {
  it('reports needsRecovery for a proctored attempt that is already started', () => {
    const { result } = renderHook(() => useProctoring({ ...OPTIONS, alreadyStarted: true }))
    expect(result.current.needsRecovery).toBe(true)
  })

  it('clears needsRecovery once monitoring is live, with one session call', async () => {
    const { result } = renderHook(() => useProctoring({ ...OPTIONS, alreadyStarted: true }))
    await act(async () => { await result.current.requestPermissionsAndStart() })
    await waitFor(() => expect(result.current.needsRecovery).toBe(false))
    expect(callsTo(SESSION_URL).length).toBe(1)
  })

  it('reports every device ACTIVE and says so honestly', async () => {
    const { result } = await started()
    expect(result.current.health).toMatchObject({ camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE', connection: 'OK' })
    expect(result.current.capture).toEqual({ cameraLive: true, micLive: true, screenSharing: true })
  })

  it('heartbeats with the session id and device health, and no media fields', async () => {
    await started()
    await waitFor(() => expect(callsTo(HEARTBEAT_URL).length).toBeGreaterThan(0))
    const body = bodyOf(callsTo(HEARTBEAT_URL)[0])
    expect(body).toMatchObject({ sessionId: 's1', camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE', clientState: 'ACTIVE' })
    expect(Object.keys(body).join(',')).not.toMatch(/record|upload|segment|screenshot/i)
  })

  it('never calls anything but the proctoring JSON endpoints - no upload, no storage', async () => {
    const { result } = await started()
    await act(async () => { await result.current.finalize() })
    fetchMock.mock.calls.forEach(c => {
      expect(String(c[0])).toMatch(/^\/api\/student\/proctoring\/(session|heartbeat|events|finalize)/)
      const init = c[1] as { body?: unknown } | undefined
      if (init && init.body !== undefined) expect(typeof init.body).toBe('string')
    })
  })
})

describe('useProctoring: integrity', () => {
  it('camera stopped: CAMERA_INTERRUPTED, camera health ENDED, inference stopped', async () => {
    const { result } = await started()
    await waitFor(() => expect(gaze.onOutput).not.toBeNull())
    act(() => { cameraTracks[0].fire('ended') })
    expect(result.current.health.camera).toBe('ENDED')
    expect(result.current.state).toBe('CAMERA_STOPPED')
    expect(gaze.stop).toHaveBeenCalled()
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('CAMERA_INTERRUPTED')
  })

  it('camera reconnect: new stream, CAMERA_RESTORED, back to ACTIVE', async () => {
    const { result } = await started()
    act(() => { cameraTracks[0].fire('ended') })
    cameraTracks = [fakeTrack('video'), fakeTrack('audio')]
    await act(async () => { await result.current.resumeCamera() })
    expect(result.current.health.camera).toBe('ACTIVE')
    expect(result.current.state).toBe('ACTIVE')
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('CAMERA_RESTORED')
  })

  it('microphone stopped: MICROPHONE_INTERRUPTED', async () => {
    const { result } = await started()
    act(() => { cameraTracks[1].fire('ended') })
    expect(result.current.health.microphone).toBe('ENDED')
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('MICROPHONE_INTERRUPTED')
  })

  it('screen sharing stopped: SCREEN_SHARE_INTERRUPTED and a stopped state', async () => {
    const { result } = await started()
    act(() => { screenTracks[0].fire('ended') })
    expect(result.current.health.screen).toBe('ENDED')
    expect(result.current.capture.screenSharing).toBe(false)
    expect(result.current.state).toBe('SCREEN_SHARE_STOPPED')
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('SCREEN_SHARE_INTERRUPTED')
  })

  it('screen sharing resumed from a gesture: SCREEN_SHARE_RESUMED and ACTIVE', async () => {
    const { result } = await started()
    act(() => { screenTracks[0].fire('ended') })
    screenTracks = [fakeTrack('video')]
    await act(async () => { await result.current.resumeScreenShare() })
    expect(result.current.health.screen).toBe('ACTIVE')
    expect(result.current.state).toBe('ACTIVE')
    expect((navigator.mediaDevices.getDisplayMedia as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
    await act(async () => { await result.current.finalize() })
    expect(sentTypes()).toContain('SCREEN_SHARE_RESUMED')
  })

  it('tab hidden and visible are both logged', async () => {
    const { result } = await started()
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => { await result.current.finalize() })
    const types = sentTypes()
    expect(types).toContain('TAB_HIDDEN')
    expect(types).toContain('TAB_VISIBLE')
  })

  it('heartbeat failure marks the connection LOST; recovery clears it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    heartbeatReply = () => Promise.reject(new TypeError('Failed to fetch'))
    const { result } = await started()
    await act(async () => { vi.advanceTimersByTime(20_000) })
    await waitFor(() => expect(result.current.health.connection).toBe('LOST'))
    heartbeatReply = () => json({ ok: true, session: { sessionId: 's1', status: 'ACTIVE' } })
    await act(async () => { vi.advanceTimersByTime(20_000) })
    await waitFor(() => expect(result.current.health.connection).toBe('OK'))
  })

  it('a session the server closed moves to SESSION_INTERRUPTED and can be resumed', async () => {
    heartbeatReply = () => json({ ok: true, session: null })
    // Not started(): the first heartbeat can move the state on before a
    // wait for ACTIVE would ever observe it.
    const { result } = renderHook(() => useProctoring(OPTIONS))
    await act(async () => { await result.current.requestPermissionsAndStart() })
    await waitFor(() => expect(result.current.state).toBe('SESSION_INTERRUPTED'))
    heartbeatReply = () => json({ ok: true, session: { sessionId: 's1', status: 'ACTIVE' } })
    await act(async () => { await result.current.resumeSession() })
    expect(result.current.state).toBe('ACTIVE')
  })
})

describe('useProctoring: detection output', () => {
  it('shows a warning from detection, with no numbers in it', async () => {
    const { result } = await started()
    await waitFor(() => expect(gaze.onOutput).not.toBeNull())
    act(() => {
      gaze.onOutput!({ phase: 'MONITORING', warnings: ['MULTIPLE_FACES'], events: [] })
    })
    expect(result.current.warning?.kind).toBe('MULTIPLE_FACES')
    expect(result.current.warning?.message).not.toMatch(/\d/)
    expect(result.current.health.gaze).toBe('RUNNING')
  })

  it('sends one aggregated episode with start, end, duration and confidence', async () => {
    const { result } = await started()
    await waitFor(() => expect(gaze.onOutput).not.toBeNull())
    const t = performance.now()
    act(() => {
      gaze.onOutput!({
        phase: 'MONITORING', warnings: [],
        events: [{ type: 'LOOKING_DOWN', startedAtMs: t - 3200, endedAtMs: t, durationMs: 3200, confidence: 0.89, direction: 'DOWN' }],
      })
    })
    await act(async () => { await result.current.finalize() })
    const all = callsTo(EVENTS_URL).reduce<Array<Record<string, unknown>>>(
      (a, c) => a.concat(bodyOf(c).events as Array<Record<string, unknown>>), []
    )
    const down = all.find(e => e.type === 'LOOKING_DOWN')!
    expect(down).toMatchObject({ durationMs: 3200, confidence: 0.89, direction: 'DOWN' })
    expect(typeof down.startedAt).toBe('string')
    expect(typeof down.endedAt).toBe('string')
    expect(bodyOf(callsTo(EVENTS_URL)[0]).sessionId).toBe('s1')
  })
})

describe('useProctoring: gaze failure', () => {
  it('only ten consecutive inference errors mark gaze UNAVAILABLE, reported once', async () => {
    const { result } = await started()
    await waitFor(() => expect(gaze.onError).not.toBeNull())
    const fail = (n: number) => { for (let i = 0; i < n; i++) gaze.onError!(new Error('inference failed')) }
    act(() => { fail(9) })
    expect(result.current.health.gaze).not.toBe('UNAVAILABLE')
    // A good frame resets the run: 9 more are still short of the limit.
    act(() => {
      gaze.onOutput!({ phase: 'MONITORING', warnings: [], events: [] })
      fail(9)
    })
    expect(result.current.health.gaze).not.toBe('UNAVAILABLE')
    act(() => { fail(12) })
    expect(result.current.health.gaze).toBe('UNAVAILABLE')
    await act(async () => { await result.current.finalize() })
    expect(sentTypes().filter(t => t === 'GAZE_MONITOR_UNAVAILABLE').length).toBe(1)
  })
})

describe('useProctoring: cancellation', () => {
  it('unmount while the camera prompt is pending stops every track and sends nothing afterwards', async () => {
    let resolveCamera: (s: MediaStream) => void = () => undefined
    ;(navigator.mediaDevices.getUserMedia as Fn).mockImplementation(
      () => new Promise<MediaStream>(r => { resolveCamera = r })
    )
    const hook = renderHook(() => useProctoring(OPTIONS))
    let pending: Promise<boolean> = Promise.resolve(true)
    act(() => { pending = hook.result.current.requestPermissionsAndStart() })
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    hook.unmount()
    resolveCamera(fakeStream(cameraTracks))
    expect(await pending).toBe(false)
    cameraTracks.concat(screenTracks).forEach(t => expect(t.stop).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 50))
    // Not even a session: the start never got that far.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('finalize while the session is being opened wins: COMPLETED, tracks stopped, no heartbeat loop', async () => {
    const normal = fetchMock.getMockImplementation()!
    let resolveSession: (r: Response) => void = () => undefined
    fetchMock.mockImplementation((url: string) =>
      String(url).indexOf(SESSION_URL) === 0
        ? new Promise<Response>(r => { resolveSession = r })
        : normal(url))
    const { result } = renderHook(() => useProctoring(OPTIONS))
    let pending: Promise<boolean> = Promise.resolve(true)
    act(() => { pending = result.current.requestPermissionsAndStart() })
    await waitFor(() => expect(callsTo(SESSION_URL).length).toBe(1))
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await act(async () => { await result.current.finalize() })
    await act(async () => {
      resolveSession(new Response(JSON.stringify({
        sessionId: 's1', status: 'ACTIVE', version: '2', resumed: false,
        retentionExpiresAt: new Date().toISOString(),
        config: { heartbeatIntervalMs: 20_000, screenRequired: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      expect(await pending).toBe(false)
    })
    expect(result.current.state).toBe('COMPLETED')
    cameraTracks.concat(screenTracks).forEach(t => expect(t.stop).toHaveBeenCalled())
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { vi.advanceTimersByTime(120_000) })
    expect(callsTo(HEARTBEAT_URL).length).toBe(0)
    expect(callsTo(EVENTS_URL).length).toBe(0)
    // The session that opened late is closed rather than left dangling.
    await waitFor(() => expect(callsTo(FINALIZE_URL).length).toBe(1))
  })

  it('a second resume while one is pending returns false at once', async () => {
    const { result } = await started()
    const [a, b] = await act(async () => Promise.all([result.current.resumeSession(), result.current.resumeSession()]))
    expect(a).toBe(true)
    expect(b).toBe(false)
    expect(callsTo(SESSION_URL).length).toBe(2)
  })
})

describe('useProctoring: interrupted session', () => {
  it('keeps events refused by a closed session and delivers them after resume', async () => {
    eventsReply = () => json({ accepted: 0, duplicates: 0, capped: false, session: null })
    const { result } = await started()
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(result.current.state).toBe('SESSION_INTERRUPTED'))

    const from = fetchMock.mock.calls.length
    eventsReply = () => json({ accepted: 2, duplicates: 0, capped: false, session: 's1' })
    await act(async () => { await result.current.resumeSession() })
    expect(result.current.state).toBe('ACTIVE')
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => {
      const delivered = fetchMock.mock.calls.slice(from)
        .filter(c => String(c[0]).indexOf(EVENTS_URL) === 0)
        .reduce<string[]>((a, c) => a.concat((bodyOf(c).events as Array<{ type: string }>).map(e => e.type)), [])
      expect(delivered).toContain('PROCTORING_STARTED')
      expect(delivered).toContain('SCREEN_SHARE_STARTED')
    })
  })
})

describe('clampHeartbeatInterval', () => {
  it('never lets the server create a tight loop or a starved session', () => {
    expect(clampHeartbeatInterval(0)).toBe(5_000)
    expect(clampHeartbeatInterval(-1)).toBe(5_000)
    expect(clampHeartbeatInterval(undefined)).toBe(20_000)
    expect(clampHeartbeatInterval(NaN)).toBe(20_000)
    expect(clampHeartbeatInterval(20_000)).toBe(20_000)
    expect(clampHeartbeatInterval(3_600_000)).toBe(60_000)
  })
})

describe('useProctoring: cleanup', () => {
  it('stops every track on unmount', async () => {
    const { unmount } = await started()
    unmount()
    cameraTracks.concat(screenTracks).forEach(t => expect(t.stop).toHaveBeenCalled())
  })

  it('finalize stops every track, flushes, closes the session and stops heartbeating', async () => {
    const { result } = await started()
    await act(async () => { await result.current.finalize() })
    cameraTracks.concat(screenTracks).forEach(t => expect(t.stop).toHaveBeenCalled())
    expect(callsTo(FINALIZE_URL).length).toBe(1)
    const types = sentTypes()
    expect(types).toContain('PROCTORING_STARTED')
    expect(types).toContain('SCREEN_SHARE_STARTED')
    expect(types).toContain('PROCTORING_ENDED')
    expect(result.current.state).toBe('COMPLETED')
    expect(result.current.health.camera).toBe('UNAVAILABLE')
    const before = fetchMock.mock.calls.length
    await new Promise(r => setTimeout(r, 50))
    expect(fetchMock.mock.calls.length).toBe(before)
  })
})

describe('useProctoring: submit ordering and page exit', () => {
  const openEpisode = () => {
    const t = performance.now()
    return [{ type: 'FACE_MISSING', startedAtMs: t - 4000, endedAtMs: t, durationMs: 4000, confidence: 0.9 }]
  }
  const allEvents = () => callsTo(EVENTS_URL).reduce<Array<Record<string, unknown>>>(
    (a, c) => a.concat(bodyOf(c).events as Array<Record<string, unknown>>), []
  )

  it('flushPending delivers the open episode and the queue, and leaves monitoring running', async () => {
    const { result } = await started()
    await waitFor(() => expect(gaze.onOutput).not.toBeNull())
    gaze.flush.mockImplementation(openEpisode)
    await act(async () => { await result.current.flushPending() })
    expect(gaze.flush).toHaveBeenCalledTimes(1)
    expect(sentTypes()).toContain('FACE_MISSING')
    // Nothing torn down: a submit that fails next must leave the candidate monitored.
    expect(callsTo(FINALIZE_URL).length).toBe(0)
    expect(gaze.stop).not.toHaveBeenCalled()
    cameraTracks.concat(screenTracks).forEach(t => expect(t.stop).not.toHaveBeenCalled())
    expect(result.current.state).toBe('ACTIVE')
    expect(result.current.capture.cameraLive).toBe(true)
    await act(async () => { await result.current.finalize() })
  })

  it('pagehide flushes the open gaze episode into the keepalive flush', async () => {
    const { result } = await started()
    await waitFor(() => expect(gaze.onOutput).not.toBeNull())
    // Let the start-up flushes settle so the keepalive one is not coalesced into them.
    await act(async () => { await result.current.flushPending() })
    gaze.flush.mockImplementation(openEpisode)
    await act(async () => { window.dispatchEvent(new Event('pagehide')) })
    await waitFor(() => expect(allEvents().some(e => e.type === 'FACE_MISSING')).toBe(true))
    const call = callsTo(EVENTS_URL).find(c =>
      (bodyOf(c).events as Array<{ type: string }>).some(e => e.type === 'FACE_MISSING'))!
    expect((call[1] as RequestInit).keepalive).toBe(true)
    // Keepalive requests are left without a timeout signal; they must outlive the page.
    expect((call[1] as RequestInit).signal).toBeUndefined()
    expect(gaze.stop).not.toHaveBeenCalled()
    await act(async () => { await result.current.finalize() })
  })
})

describe('useProctoring: request timeouts', () => {
  it('non-keepalive requests carry an abort signal', async () => {
    const { result } = await started()
    await waitFor(() => expect(callsTo(HEARTBEAT_URL).length).toBeGreaterThan(0))
    expect((callsTo(SESSION_URL)[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
    expect((callsTo(HEARTBEAT_URL)[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
    await act(async () => { await result.current.finalize() })
  })

  it('skips a heartbeat tick while the previous heartbeat is still in flight', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let release: (r: Response) => void = () => {}
    heartbeatReply = () => new Promise<Response>(r => { release = r })
    const { result } = await started()
    await waitFor(() => expect(callsTo(HEARTBEAT_URL).length).toBe(1))
    await act(async () => { vi.advanceTimersByTime(20_000) })
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(callsTo(HEARTBEAT_URL).length).toBe(1)
    // Once it settles, the next tick sends again.
    heartbeatReply = () => json({ ok: true, session: { sessionId: 's1', status: 'ACTIVE' } })
    await act(async () => { release(new Response(JSON.stringify({ ok: true, session: { sessionId: 's1', status: 'ACTIVE' } }), { status: 200 })) })
    await act(async () => { vi.advanceTimersByTime(20_000) })
    await waitFor(() => expect(callsTo(HEARTBEAT_URL).length).toBe(2))
    await act(async () => { await result.current.finalize() })
  })
})
