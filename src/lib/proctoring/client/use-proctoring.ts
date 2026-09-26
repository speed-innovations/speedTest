'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AttemptKind, ProctoringClientState } from '../types'
import { severityFor, type ClientEventType } from '../event-types'
import { checkBrowserSupport, type SupportReport } from './media-support'
import { nextState, type ProctoringEventName } from './state-machine'
import { proctoringApi, type AttemptRef, type GazeMonitorHealth } from './proctoring-api'
import { GazeMonitor } from './gaze-monitor'
import type { DetectionEvent, PipelineOutput } from './detection-pipeline'
import { IntegrityMonitor, type DeviceHealth, type DeviceKind, type IntegrityEvent } from './integrity-monitor'
import { EventQueue, type WireEvent } from './event-queue'
import { INTEGRITY_COPY, WARNING_COPY, WarningGate, type WarningKind } from './warning-copy'
import { DIAGNOSTICS_ENABLED, toDiagnosticsSnapshot, type DiagnosticsSnapshot } from './diagnostics'

/**
 * The single integration point between live proctoring and React, called
 * from both candidate pages. Every decision - what starts monitoring, what
 * tears it down, when recovery is needed - lives here, never in a page.
 *
 * Metadata only. The camera and microphone stream feeds an off-DOM video
 * element that MediaPipe reads in this tab. The screen stream is held only so
 * its end can be detected. No frame, sample or snapshot is ever encoded,
 * stored or sent: the only network traffic is session, heartbeat and event
 * JSON.
 *
 * Long-lived handles live in refs, and every callback that fires from a
 * timer, a track or MediaPipe reads refs rather than render-time values, so
 * there are no stale closures and no capture restarts on re-render.
 */

export type DeviceState = 'IDLE' | 'CHECKING' | 'READY' | 'DENIED' | 'FAILED' | 'NOT_REQUIRED'

export interface DeviceStatus {
  state: DeviceState
  /** Candidate-facing, already phrased for display. Never an internal error. */
  message?: string
}

export interface UseProctoringOptions {
  enabled: boolean
  attemptId: string | null
  kind: AttemptKind
  parentId: string
  /** Current question id, for correlation. Validated server-side. */
  currentQuestionId: string | null
  /** True once the server says this attempt is already started. */
  alreadyStarted: boolean
}

export type GazeHealth = 'IDLE' | 'LOADING' | 'CALIBRATING' | 'RUNNING' | 'UNAVAILABLE'

export interface ProctoringHealth {
  camera: DeviceHealth
  microphone: DeviceHealth
  screen: DeviceHealth
  gaze: GazeHealth
  connection: 'OK' | 'LOST'
}

export interface CaptureState {
  screenSharing: boolean
  cameraLive: boolean
  micLive: boolean
}

export interface UseProctoringResult {
  state: ProctoringClientState
  support: SupportReport
  devices: { camera: DeviceStatus; microphone: DeviceStatus; screen: DeviceStatus }
  warning: { message: string; kind: WarningKind } | null
  /** What is actually true right now. The UI reads this, never the state name. */
  health: ProctoringHealth
  capture: CaptureState
  startError: { message: string; code?: string } | null
  needsRecovery: boolean
  /** Dev-only; always null in production builds. */
  diagnostics: DiagnosticsSnapshot | null
  requestPermissionsAndStart: () => Promise<boolean>
  resumeScreenShare: () => Promise<boolean>
  resumeCamera: () => Promise<boolean>
  resumeSession: () => Promise<boolean>
  finalize: () => Promise<void>
  videoRef: React.RefObject<HTMLVideoElement>
}

const EVENT_FLUSH_INTERVAL_MS = 5000
const WARNING_VISIBLE_MS = 4000
/** Monitoring must never cost a candidate their answers: the final flush is abandoned after this. */
const FINALIZE_FLUSH_TIMEOUT_MS = 5000
const HEARTBEAT_FAILURES_BEFORE_LOST = 2
const DIAGNOSTICS_MIN_INTERVAL_MS = 250
const MAX_EVENT_DURATION_MS = 14_400_000
/**
 * Consecutive inference failures before gaze analysis is declared
 * unavailable. One bad frame is noise; a model that throws on every frame
 * must not sit at LOADING forever while the server hears STARTING.
 */
const GAZE_ERROR_LIMIT = 10
/**
 * The server's heartbeat interval is clamped before use: 0, a negative or a
 * missing value must never become a tight request loop, and a huge one must
 * not let the stale-session sweep close a healthy session.
 */
const HEARTBEAT_INTERVAL_MIN_MS = 5_000
const HEARTBEAT_INTERVAL_MAX_MS = 60_000
const HEARTBEAT_INTERVAL_DEFAULT_MS = 20_000

const IDLE_DEVICE: DeviceStatus = { state: 'IDLE' }
const INITIAL_HEALTH: ProctoringHealth = {
  camera: 'UNAVAILABLE', microphone: 'UNAVAILABLE', screen: 'UNAVAILABLE', gaze: 'IDLE', connection: 'OK',
}

function newEventId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      // Fall through to the manual id.
    }
  }
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** A performance.now() instant as a wall-clock ISO string. */
function wallClock(perfMs: number): string {
  return new Date(Date.now() - (performance.now() - perfMs)).toISOString()
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach(track => {
    try {
      track.stop()
    } catch {
      // An already-ended track throws on some engines.
    }
  })
}

function displaySurfaceOf(stream: MediaStream): string {
  const track = stream.getVideoTracks()[0]
  if (!track || typeof track.getSettings !== 'function') return 'unknown'
  const surface = (track.getSettings() as { displaySurface?: unknown }).displaySurface
  return typeof surface === 'string' ? surface : 'unknown'
}

function gazeForServer(g: GazeHealth): GazeMonitorHealth {
  switch (g) {
    case 'LOADING': return 'STARTING'
    case 'CALIBRATING': return 'CALIBRATING'
    case 'RUNNING': return 'RUNNING'
    case 'UNAVAILABLE': return 'UNAVAILABLE'
    default: return 'STOPPED'
  }
}

function captureFrom(h: ProctoringHealth): CaptureState {
  return {
    cameraLive: h.camera === 'ACTIVE' || h.camera === 'MUTED',
    micLive: h.microphone === 'ACTIVE' || h.microphone === 'MUTED',
    screenSharing: h.screen === 'ACTIVE',
  }
}

export function clampHeartbeatInterval(ms: unknown): number {
  if (typeof ms !== 'number' || !isFinite(ms)) return HEARTBEAT_INTERVAL_DEFAULT_MS
  return Math.min(HEARTBEAT_INTERVAL_MAX_MS, Math.max(HEARTBEAT_INTERVAL_MIN_MS, Math.round(ms)))
}

/** Race a promise against a timer, and clear the timer either way. */
function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    const done = () => { clearTimeout(timer); resolve() }
    p.then(done, done)
  })
}

export function useProctoring(opts: UseProctoringOptions): UseProctoringResult {
  const { enabled, attemptId, kind, parentId, currentQuestionId, alreadyStarted } = opts

  const [state, setState] = useState<ProctoringClientState>('IDLE')
  const [support, setSupport] = useState<SupportReport>({ supported: true, missing: [] })
  const [camera, setCamera] = useState<DeviceStatus>(IDLE_DEVICE)
  const [microphone, setMicrophone] = useState<DeviceStatus>(IDLE_DEVICE)
  const [screen, setScreen] = useState<DeviceStatus>(IDLE_DEVICE)
  const [warning, setWarning] = useState<{ message: string; kind: WarningKind } | null>(null)
  const [health, setHealth] = useState<ProctoringHealth>(INITIAL_HEALTH)
  const [startError, setStartError] = useState<{ message: string; code?: string } | null>(null)
  /** Whether this page instance brought monitoring up. Recovery keys on it. */
  const [captureLive, setCaptureLive] = useState(false)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null)

  const stateRef = useRef<ProctoringClientState>('IDLE')
  const healthRef = useRef<ProctoringHealth>(INITIAL_HEALTH)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const gazeRef = useRef<GazeMonitor | null>(null)
  /** Bumped on every start/stop, so a model that finishes loading late is discarded. */
  const gazeGenerationRef = useRef(0)
  /** Consecutive onError calls since the last good output. */
  const gazeErrorCountRef = useRef(0)
  /** The generation already reported UNAVAILABLE, so it is enqueued once per monitor. */
  const gazeUnavailableGenerationRef = useRef(-1)
  const integrityRef = useRef<IntegrityMonitor | null>(null)
  const queueRef = useRef<EventQueue | null>(null)
  const gateRef = useRef(new WarningGate())
  const sessionIdRef = useRef<string | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const eventTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatFailuresRef = useRef(0)
  const lastDiagnosticsAtRef = useRef(0)
  const startedAtRef = useRef(0)
  const startingRef = useRef(false)
  const finalizedRef = useRef(false)
  /** Set by the unmount cleanup; every async continuation checks it. */
  const unmountedRef = useRef(false)
  /** One of each resume at a time: a double click must not race itself. */
  const resumingScreenRef = useRef(false)
  const resumingCameraRef = useRef(false)
  const resumingSessionRef = useRef(false)
  /** The monitor's own video element, deliberately off-DOM. */
  const inferenceVideoRef = useRef<HTMLVideoElement | null>(null)
  /** The visible self-view. Never what inference reads from. */
  const videoRef = useRef<HTMLVideoElement>(null)
  const teardownRef = useRef<(() => void) | null>(null)
  const questionIdRef = useRef<string | null>(currentQuestionId)
  questionIdRef.current = currentQuestionId

  const attemptRef = useMemo<AttemptRef | null>(
    () => (attemptId ? { attemptId, kind, parentId } : null),
    [attemptId, kind, parentId]
  )
  const attemptRefRef = useRef<AttemptRef | null>(attemptRef)
  attemptRefRef.current = attemptRef

  /** Against the ref, so the ref and the rendered state never disagree. */
  const dispatch = useCallback((event: ProctoringEventName) => {
    const next = nextState(stateRef.current, event)
    stateRef.current = next
    setState(next)
  }, [])

  const patchHealth = useCallback((patch: Partial<ProctoringHealth>) => {
    const merged = { ...healthRef.current, ...patch }
    healthRef.current = merged
    setHealth(merged)
  }, [])

  const enqueue = useCallback((
    type: ClientEventType,
    extra: {
      startedAtPerf?: number
      endedAtPerf?: number
      durationMs?: number
      confidence?: number
      direction?: WireEvent['direction']
      metadata?: WireEvent['metadata']
    } = {}
  ) => {
    const queue = queueRef.current
    if (!queue) return
    const startPerf = extra.startedAtPerf ?? performance.now()
    const questionId = questionIdRef.current
    queue.push({
      clientEventId: newEventId(),
      type,
      startedAt: wallClock(startPerf),
      endedAt: extra.endedAtPerf !== undefined ? wallClock(extra.endedAtPerf) : undefined,
      durationMs: extra.durationMs !== undefined
        ? Math.min(MAX_EVENT_DURATION_MS, Math.max(0, Math.round(extra.durationMs)))
        : undefined,
      confidence: extra.confidence,
      direction: extra.direction,
      severity: severityFor(type),
      elapsedMs: startedAtRef.current ? Math.max(0, Math.round(startPerf - startedAtRef.current)) : undefined,
      questionId: questionId ?? undefined,
      metadata: extra.metadata,
    })
  }, [])

  const showWarning = useCallback((kind: WarningKind) => {
    if (!gateRef.current.allow(kind, performance.now())) return
    setWarning({ message: WARNING_COPY[kind], kind })
    if (warningTimerRef.current !== null) clearTimeout(warningTimerRef.current)
    warningTimerRef.current = setTimeout(() => {
      warningTimerRef.current = null
      setWarning(null)
    }, WARNING_VISIBLE_MS)
  }, [])

  const handleDetectionEvent = useCallback((e: DetectionEvent) => {
    enqueue(e.type, {
      startedAtPerf: e.startedAtMs,
      endedAtPerf: e.endedAtMs,
      durationMs: e.durationMs,
      confidence: e.confidence,
      direction: e.direction,
      metadata: e.metadata,
    })
  }, [enqueue])

  const handleOutput = useCallback((out: PipelineOutput) => {
    gazeErrorCountRef.current = 0
    out.events.forEach(handleDetectionEvent)
    out.warnings.forEach(showWarning)
    const g: GazeHealth = out.phase === 'CALIBRATING' ? 'CALIBRATING' : 'RUNNING'
    if (healthRef.current.gaze !== g) patchHealth({ gaze: g })
    if (DIAGNOSTICS_ENABLED) {
      const now = performance.now()
      if (now - lastDiagnosticsAtRef.current >= DIAGNOSTICS_MIN_INTERVAL_MS) {
        lastDiagnosticsAtRef.current = now
        setDiagnostics(toDiagnosticsSnapshot(out))
      }
    }
  }, [handleDetectionEvent, patchHealth, showWarning])

  /** Stop inference. `flush` keeps the episode in progress (finalize, camera loss). */
  const stopGaze = useCallback((flush: boolean) => {
    gazeGenerationRef.current++
    const monitor = gazeRef.current
    gazeRef.current = null
    if (!monitor) return
    if (flush) {
      try {
        monitor.flush().forEach(handleDetectionEvent)
      } catch {
        // Nothing in progress to keep.
      }
    }
    try {
      monitor.stop()
    } catch {
      // A monitor that never finished loading has nothing to stop.
    }
  }, [handleDetectionEvent])

  const startGaze = useCallback(async (stream: MediaStream) => {
    stopGaze(false)
    const generation = ++gazeGenerationRef.current
    gazeErrorCountRef.current = 0
    patchHealth({ gaze: 'LOADING' })
    /** Health always follows; the event is enqueued once per monitor instance. */
    const reportUnavailable = () => {
      if (healthRef.current.gaze !== 'UNAVAILABLE') patchHealth({ gaze: 'UNAVAILABLE' })
      if (gazeUnavailableGenerationRef.current === generation) return
      gazeUnavailableGenerationRef.current = generation
      enqueue('GAZE_MONITOR_UNAVAILABLE')
    }
    const handleError = () => {
      if (generation !== gazeGenerationRef.current) return
      gazeErrorCountRef.current++
      if (gazeErrorCountRef.current >= GAZE_ERROR_LIMIT) reportUnavailable()
    }
    try {
      let inference = inferenceVideoRef.current
      if (!inference) {
        inference = document.createElement('video')
        inference.muted = true
        inference.playsInline = true
        inferenceVideoRef.current = inference
      }
      inference.srcObject = stream
      await inference.play().catch(() => undefined)
      const monitor = await GazeMonitor.create({ onOutput: handleOutput, onError: handleError })
      // Superseded while the model loaded (camera reconnected, or torn down):
      // discard, so there is never more than one MediaPipe instance.
      if (generation !== gazeGenerationRef.current) {
        monitor.stop()
        return
      }
      gazeRef.current = monitor
      monitor.start(inference)
    } catch {
      if (generation !== gazeGenerationRef.current) return
      // Gaze analysis is the one part that may be absent. It is reported,
      // never hidden: the heartbeat says UNAVAILABLE and a reviewer sees it.
      reportUnavailable()
    }
  }, [enqueue, handleOutput, patchHealth, stopGaze])

  const handleIntegrityEvent = useCallback((e: IntegrityEvent) => {
    enqueue(e.type, { startedAtPerf: e.atMs, durationMs: e.durationMs, metadata: e.metadata })
  }, [enqueue])

  const handleHealthChange = useCallback((next: Record<DeviceKind, DeviceHealth>) => {
    const prev = healthRef.current
    patchHealth({ camera: next.camera, microphone: next.microphone, screen: next.screen })
    if (finalizedRef.current) return
    if (next.camera === 'ENDED' && prev.camera !== 'ENDED') {
      setCamera({ state: 'FAILED', message: INTEGRITY_COPY.CAMERA_INTERRUPTED })
      dispatch('CAMERA_ENDED')
      // A frozen last frame would keep reading as "face present". Stop
      // inference rather than trust it.
      stopGaze(true)
      patchHealth({ gaze: 'IDLE' })
    }
    if (next.microphone === 'ENDED' && prev.microphone !== 'ENDED') {
      setMicrophone({ state: 'FAILED', message: INTEGRITY_COPY.MICROPHONE_INTERRUPTED })
      dispatch('MICROPHONE_ENDED')
    }
    if (next.screen === 'ENDED' && prev.screen !== 'ENDED') {
      setScreen({ state: 'DENIED', message: INTEGRITY_COPY.SCREEN_SHARE_STOPPED })
      dispatch('SCREEN_SHARE_ENDED')
    }
    if (next.screen === 'ACTIVE' && prev.screen === 'ENDED') setScreen({ state: 'READY' })
  }, [dispatch, patchHealth, stopGaze])

  const clearTimers = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
    if (eventTimerRef.current !== null) {
      clearInterval(eventTimerRef.current)
      eventTimerRef.current = null
    }
  }, [])

  /** Stop everything. Safe to call more than once, and from an unmount. */
  const teardown = useCallback(() => {
    clearTimers()
    if (warningTimerRef.current !== null) {
      clearTimeout(warningTimerRef.current)
      warningTimerRef.current = null
    }
    stopGaze(false)
    integrityRef.current?.detach()
    integrityRef.current = null
    queueRef.current?.close()
    queueRef.current = null
    // A camera left live after the candidate leaves is the most visible way
    // to lose their trust.
    stopStream(cameraStreamRef.current)
    stopStream(screenStreamRef.current)
    cameraStreamRef.current = null
    screenStreamRef.current = null
    const preview = videoRef.current
    if (preview) preview.srcObject = null
    const inference = inferenceVideoRef.current
    if (inference) inference.srcObject = null
    inferenceVideoRef.current = null
    sessionIdRef.current = null
    gateRef.current.reset()
    heartbeatFailuresRef.current = 0
    healthRef.current = INITIAL_HEALTH
    setHealth(INITIAL_HEALTH)
    setWarning(null)
    setDiagnostics(null)
  }, [clearTimers, stopGaze])

  teardownRef.current = teardown

  useEffect(() => {
    // Reset on (re)mount: StrictMode runs this effect's cleanup once in
    // development before mounting again.
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      teardownRef.current?.()
    }
  }, [])

  /**
   * True once the page instance is gone or has submitted. Checked after every
   * await in start and resume: the continuation of a prompt or request that
   * settled late must not bring monitoring back up after teardown.
   */
  const isCancelled = useCallback(() => unmountedRef.current || finalizedRef.current, [])

  /**
   * Keep the visible self-view bound to the camera stream. No dependency
   * array on purpose: the page swaps the preview element between pre-check
   * and exam, and a one-shot attach leaves the exam's preview blank.
   */
  useEffect(() => {
    const el = videoRef.current
    const stream = cameraStreamRef.current
    if (!el || !stream) return
    if (el.srcObject !== stream) {
      el.srcObject = stream
      el.muted = true
      void el.play().catch(() => undefined)
    }
  })

  // Capability check only - no prompt, no network - so it is safe before a gesture.
  useEffect(() => {
    if (!enabled) return
    const report = checkBrowserSupport()
    setSupport(report)
    if (!report.supported) {
      dispatch('UNSUPPORTED')
      setCamera({ state: 'FAILED', message: 'This browser cannot be used for a proctored assessment.' })
      setMicrophone({ state: 'FAILED' })
      setScreen({ state: 'FAILED' })
      return
    }
    dispatch('CHECK_DEVICES')
    dispatch('DEVICES_OK')
  }, [enabled, dispatch])

  const sendBatch = useCallback(async (batch: WireEvent[], o: { keepalive: boolean }): Promise<boolean> => {
    const ref = attemptRefRef.current
    const sessionId = sessionIdRef.current
    if (!ref || !sessionId) return false
    const res = await proctoringApi.sendEvents(ref, sessionId, batch, o)
    if (res.ok) {
      // A 200 with no live session means nothing was stored: the server
      // closed the session (stale heartbeat) and reopens the same id on
      // resume. Keep the batch - ids are idempotent - and surface the loss.
      if (res.data.session === null && !finalizedRef.current) {
        if (!unmountedRef.current) dispatch('SESSION_LOST')
        return false
      }
      return true
    }
    // A 4xx other than 429 is a permanent refusal. Resending it would loop,
    // so the batch is let go.
    return res.status >= 400 && res.status < 500 && res.status !== 429
  }, [dispatch])

  const sendHeartbeat = useCallback(async () => {
    const ref = attemptRefRef.current
    const sessionId = sessionIdRef.current
    if (!ref || !sessionId || finalizedRef.current) return
    const h = healthRef.current
    const res = await proctoringApi.heartbeat(ref, {
      sessionId,
      clientState: stateRef.current,
      camera: h.camera,
      microphone: h.microphone,
      screen: h.screen,
      gazeMonitor: gazeForServer(h.gaze),
      clientTimestamp: new Date().toISOString(),
      droppedEvents: queueRef.current ? queueRef.current.dropped : 0,
    })
    if (finalizedRef.current || unmountedRef.current) return
    if (!res.ok) {
      if (res.status === 404 || res.status === 409) {
        dispatch('SESSION_LOST')
        return
      }
      heartbeatFailuresRef.current++
      if (heartbeatFailuresRef.current >= HEARTBEAT_FAILURES_BEFORE_LOST && healthRef.current.connection !== 'LOST') {
        patchHealth({ connection: 'LOST' })
        dispatch('OFFLINE')
      }
      return
    }
    heartbeatFailuresRef.current = 0
    if (healthRef.current.connection === 'LOST') {
      patchHealth({ connection: 'OK' })
      dispatch('ONLINE')
    }
    if (res.data.session === null) dispatch('SESSION_LOST')
  }, [dispatch, patchHealth])

  const startTimers = useCallback((heartbeatIntervalMs: number) => {
    clearTimers()
    heartbeatTimerRef.current = setInterval(() => { void sendHeartbeat() }, clampHeartbeatInterval(heartbeatIntervalMs))
    eventTimerRef.current = setInterval(() => { void queueRef.current?.flush() }, EVENT_FLUSH_INTERVAL_MS)
  }, [clearTimers, sendHeartbeat])

  const watchCameraTracks = useCallback((integrity: IntegrityMonitor, stream: MediaStream) => {
    integrity.watchTrack('camera', stream.getVideoTracks()[0])
    integrity.watchTrack('microphone', stream.getAudioTracks()[0])
  }, [])

  const acquireScreen = useCallback(async (): Promise<MediaStream | null> => {
    setScreen({ state: 'CHECKING' })
    try {
      // No audio: nothing of the screen is captured, only whether it is shared.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      setScreen({ state: 'READY' })
      return stream
    } catch (err) {
      const name = (err as { name?: string }).name
      setScreen({
        state: name === 'NotAllowedError' ? 'DENIED' : 'FAILED',
        message: name === 'NotAllowedError'
          ? 'Screen sharing was not allowed. A proctored assessment cannot begin without it.'
          : 'Screen sharing could not be started. Please try again.',
      })
      return null
    }
  }, [])

  const requestPermissionsAndStart = useCallback(async (): Promise<boolean> => {
    // A finalized page instance never restarts monitoring.
    if (!enabled || startingRef.current || isCancelled()) return false
    const ref = attemptRefRef.current
    if (!ref) {
      setStartError({ message: 'This assessment is not ready yet. Please reload the page.' })
      return false
    }
    if (!support.supported) {
      dispatch('UNSUPPORTED')
      return false
    }

    startingRef.current = true
    setStartError(null)
    dispatch('START_REQUESTED')

    try {
      // Screen first: getDisplayMedia needs transient user activation, which
      // a first-time camera prompt can outlast.
      const screenStream = await acquireScreen()
      if (isCancelled()) {
        stopStream(screenStream)
        return false
      }
      if (!screenStream) {
        dispatch('PERMISSIONS_DENIED')
        return false
      }

      setCamera({ state: 'CHECKING' })
      setMicrophone({ state: 'CHECKING' })
      let cameraStream: MediaStream
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch (err) {
        if (isCancelled()) {
          stopStream(screenStream)
          return false
        }
        const name = (err as { name?: string }).name
        const denied = name === 'NotAllowedError' || name === 'SecurityError'
        const missing = name === 'NotFoundError' || name === 'DevicesNotFoundError'
        const message = denied
          ? 'Camera and microphone access was denied. A proctored assessment cannot begin without both.'
          : missing
            ? 'No camera or microphone was found. Please connect one and try again.'
            : 'The camera and microphone could not be started. Please close other apps using them and try again.'
        setCamera({ state: denied ? 'DENIED' : 'FAILED', message })
        setMicrophone({ state: denied ? 'DENIED' : 'FAILED', message })
        stopStream(screenStream)
        setScreen(IDLE_DEVICE)
        dispatch('PERMISSIONS_DENIED')
        return false
      }

      if (isCancelled()) {
        stopStream(cameraStream)
        stopStream(screenStream)
        return false
      }

      const hasVideo = cameraStream.getVideoTracks().length > 0
      const hasAudio = cameraStream.getAudioTracks().length > 0
      setCamera(hasVideo ? { state: 'READY' } : { state: 'FAILED', message: 'No camera track was produced. Please check your camera.' })
      setMicrophone(hasAudio ? { state: 'READY' } : { state: 'FAILED', message: 'No microphone track was produced. Please check your microphone.' })
      if (!hasVideo || !hasAudio) {
        // Setup cancelled: nothing may stay live.
        stopStream(cameraStream)
        stopStream(screenStream)
        dispatch('PERMISSIONS_DENIED')
        return false
      }
      cameraStreamRef.current = cameraStream
      screenStreamRef.current = screenStream
      dispatch('PERMISSIONS_GRANTED')

      // Only now is a session created, so a denial never leaves one behind
      // for /start to accept.
      const started = await proctoringApi.startSession(ref)
      if (isCancelled()) {
        // Torn down (unmount or finalize) while the session was being opened.
        // teardown() already stopped these through the refs; stopping again
        // is harmless. Nothing else is touched.
        stopStream(cameraStream)
        stopStream(screenStream)
        // Submitted meanwhile: close the session just opened, best effort.
        // An unmount leaves it open so a reload can resume it.
        if (started.ok && finalizedRef.current) void proctoringApi.finalize(ref)
        return false
      }
      if (!started.ok) {
        if (started.status === 503) {
          dispatch('PROCTORING_UNAVAILABLE')
          setStartError({ message: 'Proctored assessment is temporarily unavailable. Please try again later.', code: started.code })
        } else {
          setStartError({ message: started.error, code: started.code })
          dispatch('PERMISSIONS_DENIED')
        }
        teardown()
        return false
      }

      sessionIdRef.current = started.data.sessionId
      startedAtRef.current = performance.now()
      heartbeatFailuresRef.current = 0
      gateRef.current.reset()
      queueRef.current = new EventQueue({ send: sendBatch })

      const integrity = new IntegrityMonitor({
        onEvent: handleIntegrityEvent,
        onHealthChange: handleHealthChange,
        onPageHide: () => { void queueRef.current?.flush({ keepalive: true }) },
      })
      integrityRef.current = integrity
      // Watch before anything else runs, so a device yanked during startup is
      // still reported.
      watchCameraTracks(integrity, cameraStream)
      integrity.watchTrack('screen', screenStream.getVideoTracks()[0])
      integrity.attachPage()
      patchHealth({ connection: 'OK' })

      enqueue('PROCTORING_STARTED', { metadata: { resumed: started.data.resumed } })
      enqueue('SCREEN_SHARE_STARTED', { metadata: { displaySurface: displaySurfaceOf(screenStream) } })

      // Not awaited: the model loads in the background while the exam opens.
      // Health reads LOADING until it runs.
      void startGaze(cameraStream)

      dispatch('SESSION_STARTED')
      setCaptureLive(true)
      startTimers(started.data.config.heartbeatIntervalMs)
      void sendHeartbeat()
      return true
    } catch {
      setStartError({ message: 'Proctoring could not be started. Please try again.' })
      dispatch('PERMISSIONS_DENIED')
      teardown()
      return false
    } finally {
      startingRef.current = false
    }
  }, [
    acquireScreen, dispatch, enabled, enqueue, handleHealthChange, handleIntegrityEvent, isCancelled,
    patchHealth, sendBatch, sendHeartbeat, startGaze, startTimers, support.supported, teardown,
    watchCameraTracks,
  ])

  /** From the candidate's click on the resume button: needs the gesture. */
  const resumeScreenShare = useCallback(async (): Promise<boolean> => {
    if (resumingScreenRef.current || isCancelled()) return false
    if (!sessionIdRef.current || !integrityRef.current) return false
    resumingScreenRef.current = true
    try {
      const stream = await acquireScreen()
      // Re-read after the await: a teardown meanwhile detached the monitor.
      const integrity = integrityRef.current
      if (isCancelled() || !integrity) {
        stopStream(stream)
        return false
      }
      if (!stream) return false
      stopStream(screenStreamRef.current)
      screenStreamRef.current = stream
      integrity.watchTrack('screen', stream.getVideoTracks()[0])
      enqueue('SCREEN_SHARE_RESUMED', { metadata: { displaySurface: displaySurfaceOf(stream) } })
      dispatch('SCREEN_SHARE_RESUMED')
      return true
    } finally {
      resumingScreenRef.current = false
    }
  }, [acquireScreen, dispatch, enqueue, isCancelled])

  const resumeCamera = useCallback(async (): Promise<boolean> => {
    if (resumingCameraRef.current || isCancelled()) return false
    if (!sessionIdRef.current || !integrityRef.current) return false
    resumingCameraRef.current = true
    try {
      const before = healthRef.current
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch {
        if (isCancelled()) return false
        setCamera({ state: 'FAILED', message: 'The camera could not be restarted. Please check it is connected and not in use by another app.' })
        return false
      }
      // Re-read after the await: a teardown meanwhile detached the monitor.
      const integrity = integrityRef.current
      if (isCancelled() || !integrity) {
        stopStream(stream)
        return false
      }
      if (stream.getVideoTracks().length === 0 || stream.getAudioTracks().length === 0) {
        stopStream(stream)
        return false
      }
      // A microphone-only recovery leaves inference running: keep the episode
      // in progress before the restart below replaces the monitor.
      stopGaze(true)
      stopStream(cameraStreamRef.current)
      cameraStreamRef.current = stream
      watchCameraTracks(integrity, stream)
      if (before.camera !== 'ACTIVE') enqueue('CAMERA_RESTORED', { metadata: { reason: 'reconnected' } })
      if (before.microphone !== 'ACTIVE') enqueue('MICROPHONE_RESTORED', { metadata: { reason: 'reconnected' } })
      setCamera({ state: 'READY' })
      setMicrophone({ state: 'READY' })
      dispatch('DEVICES_RECOVERED')
      void startGaze(stream)
      return true
    } finally {
      resumingCameraRef.current = false
    }
  }, [dispatch, enqueue, isCancelled, startGaze, stopGaze, watchCameraTracks])

  /** The server closed the session (stale heartbeat). Reopen it - it resumes in place. */
  const resumeSession = useCallback(async (): Promise<boolean> => {
    const ref = attemptRefRef.current
    if (!ref || resumingSessionRef.current || isCancelled()) return false
    resumingSessionRef.current = true
    try {
      const started = await proctoringApi.startSession(ref)
      if (isCancelled()) return false
      if (!started.ok) {
        setStartError({ message: started.error, code: started.code })
        return false
      }
      sessionIdRef.current = started.data.sessionId
      setStartError(null)
      dispatch('SESSION_RESUMED')
      void sendHeartbeat()
      // Deliver what was held while the session was closed, now rather than
      // on the next timer tick.
      void queueRef.current?.flush()
      return true
    } finally {
      resumingSessionRef.current = false
    }
  }, [dispatch, isCancelled, sendHeartbeat])

  const finalize = useCallback(async (): Promise<void> => {
    if (!enabled || finalizedRef.current) return
    finalizedRef.current = true
    dispatch('FINALIZE')
    clearTimers()
    // Keep the episode in progress: the last look away must not be lost.
    stopGaze(true)
    enqueue('PROCTORING_ENDED')
    const queue = queueRef.current
    if (queue) await withTimeout(queue.flush(), FINALIZE_FLUSH_TIMEOUT_MS)
    const ref = attemptRefRef.current
    if (ref && sessionIdRef.current) {
      // Best effort. The submit route's safety net closes it otherwise.
      await proctoringApi.finalize(ref)
    }
    teardown()
    dispatch('FINALIZED')
    setCaptureLive(false)
  }, [clearTimers, dispatch, enabled, enqueue, stopGaze, teardown])

  // Back online: report and flush at once rather than waiting for the timers.
  useEffect(() => {
    if (!enabled || !captureLive) return
    const onOnline = () => {
      void sendHeartbeat()
      void queueRef.current?.flush()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [enabled, captureLive, sendHeartbeat])

  const needsRecovery = enabled && alreadyStarted && !captureLive

  return {
    state,
    support,
    devices: { camera, microphone, screen },
    warning,
    health,
    capture: captureFrom(health),
    startError,
    needsRecovery,
    diagnostics,
    requestPermissionsAndStart,
    resumeScreenShare,
    resumeCamera,
    resumeSession,
    finalize,
    videoRef,
  }
}
