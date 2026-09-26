// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * The MediaPipe shell, with the model mocked. What is pinned: the model
 * config, GPU->CPU fallback, the frame-rate gate, one loop only, clean stop,
 * and requestVideoFrameCallback with its rAF fallback.
 */

const detectForVideo = vi.fn()
const close = vi.fn()
const createFromOptions = vi.fn()

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(() => Promise.resolve({})) },
  FaceLandmarker: { createFromOptions: (...a: unknown[]) => createFromOptions(...a) },
}))

import { GazeMonitor } from '@/lib/proctoring/client/gaze-monitor'
import type { PipelineOutput } from '@/lib/proctoring/client/detection-pipeline'

let rafQueue: Array<(t: number) => void>
let now: number

function video(readyState = 4): HTMLVideoElement {
  const v = document.createElement('video')
  Object.defineProperty(v, 'readyState', { configurable: true, get: () => readyState })
  return v
}

function tick(ms: number): void {
  now += ms
  const q = rafQueue
  rafQueue = []
  q.forEach(cb => cb(now))
}

beforeEach(() => {
  rafQueue = []
  now = 1000
  detectForVideo.mockReset().mockImplementation(() => ({ faceLandmarks: [], facialTransformationMatrixes: [] }))
  close.mockReset()
  createFromOptions.mockReset().mockImplementation(() => Promise.resolve({ detectForVideo, close }))
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { rafQueue.push(cb); return rafQueue.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GazeMonitor', () => {
  it('loads the self-hosted model: two faces, matrices on, blendshapes off, GPU first', async () => {
    await GazeMonitor.create({ onOutput: () => undefined })
    expect(createFromOptions.mock.calls[0][1]).toMatchObject({
      runningMode: 'VIDEO',
      numFaces: 2,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
      baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'GPU' },
    })
  })

  it('falls back to the CPU delegate when GPU initialisation fails', async () => {
    createFromOptions
      .mockImplementationOnce(() => Promise.reject(new Error('no webgl')))
      .mockImplementationOnce(() => Promise.resolve({ detectForVideo, close }))
    await GazeMonitor.create({ onOutput: () => undefined })
    expect(createFromOptions.mock.calls[1][1].baseOptions.delegate).toBe('CPU')
  })

  it('infers at roughly six frames per second, not at display rate', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    m.start(video())
    for (let i = 0; i < 20; i++) tick(50) // one second at 20 Hz
    expect(detectForVideo.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(detectForVideo.mock.calls.length).toBeLessThanOrEqual(7)
  })

  it('passes strictly increasing timestamps', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    m.start(video())
    for (let i = 0; i < 20; i++) tick(200)
    const ts = detectForVideo.mock.calls.map(c => c[1] as number)
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1])
  })

  it('never runs two loops, even if started twice', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    const v = video()
    m.start(v)
    m.start(v)
    expect(rafQueue.length).toBe(1)
    tick(200)
    expect(rafQueue.length).toBe(1)
  })

  it('skips frames while the video is not ready', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    m.start(video(1))
    for (let i = 0; i < 10; i++) tick(200)
    expect(detectForVideo).not.toHaveBeenCalled()
  })

  it('stop cancels the loop, closes the model and infers nothing more', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    m.start(video())
    tick(200)
    const calls = detectForVideo.mock.calls.length
    m.stop()
    for (let i = 0; i < 10; i++) tick(200)
    expect(detectForVideo.mock.calls.length).toBe(calls)
    expect(close).toHaveBeenCalledTimes(1)
    expect(m.isRunning).toBe(false)
  })

  it('feeds the pipeline: no face in view becomes a FACE_MISSING warning', async () => {
    const outs: PipelineOutput[] = []
    const m = await GazeMonitor.create({ onOutput: o => outs.push(o) })
    m.start(video())
    for (let i = 0; i < 20; i++) tick(170)
    expect(outs.some(o => o.warnings.indexOf('FACE_MISSING') !== -1)).toBe(true)
    expect(m.flush().map(e => e.type)).toEqual(['FACE_MISSING'])
  })

  it('prefers requestVideoFrameCallback when the element has it', async () => {
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    const v = video() as HTMLVideoElement & { requestVideoFrameCallback: ReturnType<typeof vi.fn> }
    v.requestVideoFrameCallback = vi.fn(() => 1)
    m.start(v)
    expect(v.requestVideoFrameCallback).toHaveBeenCalledTimes(1)
    expect(rafQueue.length).toBe(0)
    m.stop()
  })

  it('falls back to requestAnimationFrame if video-frame callbacks never arrive', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const m = await GazeMonitor.create({ onOutput: () => undefined })
    const v = video() as HTMLVideoElement & { requestVideoFrameCallback: ReturnType<typeof vi.fn>; cancelVideoFrameCallback: ReturnType<typeof vi.fn> }
    v.requestVideoFrameCallback = vi.fn(() => 7)
    v.cancelVideoFrameCallback = vi.fn()
    m.start(v)
    vi.advanceTimersByTime(1100)
    expect(v.cancelVideoFrameCallback).toHaveBeenCalledWith(7)
    expect(rafQueue.length).toBe(1)
    m.stop()
  })
})
