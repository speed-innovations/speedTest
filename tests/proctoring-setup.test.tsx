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

const SESSION_CONFIG = { heartbeatIntervalMs: 20_000, screenRequired: true }

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

  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 })
  HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve())

  fetchMock = vi.fn((url: string) => {
    if (String(url).indexOf(SESSION_URL) === 0) {
      return Promise.resolve(new Response(
        JSON.stringify({
          sessionId: 's1', status: 'ACTIVE', version: '1', resumed: false,
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
    // The regression that matters: a denial must not create a session.
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
    installMediaDevices({ getUserMedia: harness.getUserMedia } as unknown as Harness)

    render(<Host />)

    expect(screen.getByText(/this browser cannot run a proctored assessment/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /start proctored assessment/i })).toBeNull()
    expect(screen.getByTestId('state').textContent).toBe('UNSUPPORTED_BROWSER')
  })

  it('shows the calm unavailable message on a 503 and no internal reason', async () => {
    fetchMock = vi.fn((url: string) => {
      if (String(url).indexOf(SESSION_URL) === 0) {
        return Promise.resolve(new Response(
          JSON.stringify({ error: 'PROCTORING_DISABLED', code: 'PROCTORING_DISABLED' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ))
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: /start proctored assessment/i }))

    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('PROCTORING_UNAVAILABLE')
    })
    expect(screen.getByText(/temporarily unavailable\. please try again later/i)).toBeTruthy()
    // The server's reason is an operational detail. A candidate seeing
    // "PROCTORING_DISABLED" learns nothing and is alarmed by it.
    expect(document.body.textContent).not.toContain('PROCTORING_DISABLED')
  })
})
