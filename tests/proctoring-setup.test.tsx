// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useProctoring } from '@/lib/proctoring/client/use-proctoring'
import ProctoringSetup from '@/components/proctoring/ProctoringSetup'

/**
 * The pre-check, driven through the real hook rather than with hand-fed props.
 *
 * Mocking the hook would leave the interesting part untested: what is being
 * pinned down here is that a denial actually stops short of creating a session,
 * and that an unsupported browser is refused rather than started in a
 * half-proctored state. Both of those are hook behaviour, not markup.
 */

/**
 * MediaPipe is mocked away.
 *
 * GazeMonitor.create loads a 3.6 MB model and a multi-megabyte WASM module and
 * never settles under jsdom, which would hang this suite rather than fail it.
 * The classifier and the state machine are pure and covered by their own node
 * tests; whether the model itself works can only be confirmed against a real
 * camera, which is Part 14's manual check.
 */
vi.mock('@/lib/proctoring/client/gaze-monitor', () => ({
  GazeMonitor: {
    create: vi.fn(() => Promise.resolve({ start: vi.fn(), stop: vi.fn(), hasBaseline: false })),
  },
}))

const SESSION_URL = '/api/student/proctoring/session'

interface Harness {
  getUserMedia: ReturnType<typeof vi.fn>
  getDisplayMedia: ReturnType<typeof vi.fn>
}

let harness: Harness
let fetchMock: ReturnType<typeof vi.fn>

function track(kind: 'video' | 'audio'): MediaStreamTrack {
  return {
    kind,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack
}

function stream(video: number, audio: number): MediaStream {
  const v: MediaStreamTrack[] = []
  const a: MediaStreamTrack[] = []
  for (let i = 0; i < video; i++) v.push(track('video'))
  for (let i = 0; i < audio; i++) a.push(track('audio'))
  return {
    getTracks: () => v.concat(a),
    getVideoTracks: () => v,
    getAudioTracks: () => a,
  } as unknown as MediaStream
}

function namedError(name: string): Error {
  const err = new Error(name)
  err.name = name
  return err
}

const SESSION_CONFIG = {
  screenshotIntervalMs: 60_000,
  videoSegmentMs: 300_000,
  videoBitsPerSecond: 160_000,
  audioBitsPerSecond: 32_000,
  gazeWarningMs: 1500,
  gazeWarningCooldownMs: 10_000,
  faceMissingWarningMs: 3000,
  multipleFacesWarningMs: 3000,
  maxScreenshotBytes: 250_000,
  heartbeatIntervalMs: 20_000,
  screenRequired: true,
}

/** MediaRecorder is stubbed: nothing here asserts on recorded output. */
function installMediaRecorder(supported = true): void {
  class FakeRecorder {
    state = 'recording'
    ondataavailable: unknown = null
    onstop: unknown = null
    onerror: unknown = null
    start = vi.fn()
    stop = vi.fn()
    static isTypeSupported = (t: string) => supported && t.indexOf('webm') !== -1
  }
  ;(globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder
}

function installMediaDevices(h: Harness): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: h.getUserMedia, getDisplayMedia: h.getDisplayMedia },
  })
}

/** A tiny host component so the hook is exercised exactly as a page uses it. */
function Host({ enabled = true }: { enabled?: boolean }) {
  const p = useProctoring({
    enabled,
    attemptId: 'attempt1',
    kind: 'scheduled',
    parentId: 'sched1',
    currentQuestionId: 'q1',
    alreadyStarted: false,
  })
  return (
    <div>
      <span data-testid="state">{p.state}</span>
      <ProctoringSetup
        support={p.support}
        devices={p.devices}
        state={p.state}
        startError={p.startError}
        starting={false}
        cameraLive={p.capture.cameraLive}
        videoRef={p.videoRef}
        onStart={() => { void p.requestPermissionsAndStart() }}
      />
    </div>
  )
}

function sessionCalls(): number {
  return fetchMock.mock.calls.filter(c => String(c[0]).indexOf(SESSION_URL) === 0).length
}

beforeEach(() => {
  harness = {
    getUserMedia: vi.fn(() => Promise.resolve(stream(1, 1))),
    getDisplayMedia: vi.fn(() => Promise.resolve(stream(1, 0))),
  }
  installMediaDevices(harness)
  installMediaRecorder(true)

  // Canvas and video are not real in jsdom; the screen-capture suite covers
  // encoding, so here they only need to not throw.
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
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ProctoringSetup', () => {
  it('reports all three devices ready and offers the start button', async () => {
    render(<Host />)

    expect(screen.getByRole('button', { name: /start proctored assessment/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /start proctored assessment/i }))

    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('ACTIVE')
    })
    // Three rows, all Ready.
    expect(screen.getAllByText('Ready').length).toBe(3)
    expect(harness.getDisplayMedia).toHaveBeenCalledTimes(1)
    expect(harness.getUserMedia).toHaveBeenCalledTimes(1)
    expect(sessionCalls()).toBe(1)
  })

  it('names the camera and offers a retry when the camera is denied, and creates no session', async () => {
    harness.getUserMedia = vi.fn(() => Promise.reject(namedError('NotAllowedError')))
    installMediaDevices(harness)

    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: /start proctored assessment/i }))

    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('PERMISSION_DENIED')
    })
    expect(screen.getAllByText(/camera and microphone access was denied/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    // The regression that matters: a denial must not reserve storage.
    expect(sessionCalls()).toBe(0)
  })

  it('does not begin the assessment when screen sharing is denied', async () => {
    harness.getDisplayMedia = vi.fn(() => Promise.reject(namedError('NotAllowedError')))
    installMediaDevices(harness)

    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: /start proctored assessment/i }))

    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('PERMISSION_DENIED')
    })
    expect(screen.getAllByText(/screen sharing was not allowed/i).length).toBeGreaterThan(0)
    // Screen is asked for first, so the camera is never prompted at all.
    expect(harness.getUserMedia).not.toHaveBeenCalled()
    expect(sessionCalls()).toBe(0)
  })

  it('refuses an unsupported browser and does not offer to start', () => {
    installMediaRecorder(false)

    render(<Host />)

    expect(screen.getByText(/this browser cannot run a proctored assessment/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /start proctored assessment/i })).toBeNull()
    expect(screen.getByTestId('state').textContent).toBe('UNSUPPORTED_BROWSER')
  })

  it('shows the calm storage message on a 503 and no internal reason', async () => {
    fetchMock = vi.fn((url: string) => {
      if (String(url).indexOf(SESSION_URL) === 0) {
        return Promise.resolve(new Response(
          JSON.stringify({ error: 'PROCTORING_STORAGE_LIMIT_REACHED', code: 'PROCTORING_STORAGE_LIMIT_REACHED' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ))
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: /start proctored assessment/i }))

    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('STORAGE_UNAVAILABLE')
    })
    expect(screen.getByText(/temporarily unavailable\. please try again later/i)).toBeTruthy()
    // The server's reason is an operational detail. A candidate seeing
    // "STORAGE_LIMIT_REACHED" learns nothing and is alarmed by it.
    expect(document.body.textContent).not.toContain('PROCTORING_STORAGE_LIMIT_REACHED')
  })
})
