'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AttemptKind, ProctoringClientState } from '../types'
import { checkBrowserSupport, type SupportReport } from './media-support'
import { nextState, type ProctoringEventName } from './state-machine'
import { proctoringApi, type AttemptRef, type SessionConfig } from './proctoring-api'
import { UploadQueue, type QueueItem, type QueueSummary } from './upload-queue'
import { WebcamRecorder } from './webcam-recorder'
import { ScreenCapture } from './screen-capture'
import { GazeMonitor } from './gaze-monitor'
import type { GazeThresholds } from './gaze-classify'
import type { GazeWarning } from './gaze-state'

/**
 * The single integration point between the proctoring services and React.
 *
 * Written once and called from both test pages. The two candidate pages are
 * near-identical 523-line components and this repo's standing failure mode is a
 * fix applied to one and not the other, so every decision here - what starts
 * capture, what tears it down, when recovery is required - lives in this file
 * and neither page re-implements any of it.
 *
 * Long-lived handles are kept in refs, never state. A webcam segment finishing
 * its upload must not re-render the question the candidate is reading.
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

export interface CaptureState {
  recording: boolean
  screenSharing: boolean
  cameraLive: boolean
  micLive: boolean
}

export interface UseProctoringResult {
  state: ProctoringClientState
  support: SupportReport
  devices: { camera: DeviceStatus; microphone: DeviceStatus; screen: DeviceStatus }
  warning: { message: string; kind: string } | null
  uploads: { pending: number; failed: number; uploaded: number }
  /** What is actually live right now. Drives the status indicator honestly. */
  capture: CaptureState
  /** The last session-start failure, already safe to display. */
  startError: { message: string; code?: string } | null
  /** True when the exam must not be shown: recovery is required. */
  needsRecovery: boolean
  requestPermissionsAndStart: () => Promise<boolean>
  resumeScreenShare: () => Promise<boolean>
  finalize: () => Promise<void>
  videoRef: React.RefObject<HTMLVideoElement>
}

/**
 * Gaze thresholds are not part of the server's session config - they are
 * classifier tuning, not capture parameters, and retuning them needs the test
 * fixtures in gaze-classify's suite rather than an env var nobody can validate.
 */
const DEFAULT_GAZE_THRESHOLDS: GazeThresholds = {
  yawDeg: 20,
  pitchDeg: 15,
  irisRatio: 0.18,
  hysteresisDeg: 5,
}

/** Queue bound. A segment is several megabytes, so this is a memory ceiling. */
const MAX_QUEUED_UPLOADS = 16
const UPLOAD_MAX_RETRIES = 3
const UPLOAD_BASE_DELAY_MS = 1000
/** Events are batched rather than sent per warning. */
const EVENT_FLUSH_INTERVAL_MS = 5000
const EVENT_BATCH_MAX = 50
/** How long a warning banner stays on screen. */
const WARNING_VISIBLE_MS = 4000
/**
 * Longest wait for in-flight uploads at submit time. Evidence must never cost a
 * candidate their answers, so the drain is raced against this and abandoned.
 */
const FINALIZE_DRAIN_TIMEOUT_MS = 8000

const WARNING_COPY: Record<string, string> = {
  GAZE_LEFT: 'Please look at the assessment screen.',
  GAZE_RIGHT: 'Please look at the assessment screen.',
  GAZE_UP: 'Please look at the assessment screen.',
  GAZE_DOWN: 'Please look at the assessment screen.',
  FACE_NOT_DETECTED: 'Please position your face clearly in front of the camera.',
  MULTIPLE_FACES_DETECTED:
    'More than one face was detected. Please ensure you are the only person visible.',
  UPLOAD_FAILURE:
    "We're having trouble saving assessment evidence. Please check your internet connection.",
}

interface PendingEvent {
  clientEventId: string
  type: string
  direction?: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
  occurredAt: string
  elapsedMs?: number
  durationMs?: number
  severity: 'INFO' | 'WARN'
  questionId?: string
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

const IDLE_DEVICE: DeviceStatus = { state: 'IDLE' }

export function useProctoring(opts: UseProctoringOptions): UseProctoringResult {
  const { enabled, attemptId, kind, parentId, currentQuestionId, alreadyStarted } = opts

  const [state, setState] = useState<ProctoringClientState>('IDLE')
  const [support, setSupport] = useState<SupportReport>({ supported: true, missing: [] })
  const [camera, setCamera] = useState<DeviceStatus>(IDLE_DEVICE)
  const [microphone, setMicrophone] = useState<DeviceStatus>(IDLE_DEVICE)
  const [screen, setScreen] = useState<DeviceStatus>(IDLE_DEVICE)
  const [warning, setWarning] = useState<{ message: string; kind: string } | null>(null)
  const [uploads, setUploads] = useState({ pending: 0, failed: 0, uploaded: 0 })
  const [capture, setCapture] = useState<CaptureState>({
    recording: false,
    screenSharing: false,
    cameraLive: false,
    micLive: false,
  })
  const [startError, setStartError] = useState<{ message: string; code?: string } | null>(null)
  /**
   * Whether this page instance has brought capture up at all.
   *
   * The part file expressed the recovery condition as `state !== 'ACTIVE'`,
   * which is correct at the moment of load and wrong immediately afterwards: a
   * candidate who stops screen sharing mid-exam leaves ACTIVE, and that must
   * show a resume prompt inside the exam, not replace the exam with the
   * recovery screen and hide their questions. What recovery actually asks is
   * "has proctoring ever started in this page instance?".
   */
  const [captureLive, setCaptureLive] = useState(false)

  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<WebcamRecorder | null>(null)
  const screenCaptureRef = useRef<ScreenCapture | null>(null)
  const gazeRef = useRef<GazeMonitor | null>(null)
  const queueRef = useRef<UploadQueue | null>(null)
  const configRef = useRef<SessionConfig | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const eventTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingEventsRef = useRef<PendingEvent[]>([])
  const startedAtRef = useRef(0)
  const startingRef = useRef(false)
  const finalizedRef = useRef(false)
  const captureStateRef = useRef<CaptureState>({
    recording: false,
    screenSharing: false,
    cameraLive: false,
    micLive: false,
  })
  const uploadDegradedRef = useRef(false)
  /** The gaze monitor's own video element, deliberately off-DOM. */
  const inferenceVideoRef = useRef<HTMLVideoElement | null>(null)
  /** The optional visible self-view. Never what inference reads from. */
  const videoRef = useRef<HTMLVideoElement>(null)
  const teardownRef = useRef<(() => void) | null>(null)
  const questionIdRef = useRef<string | null>(currentQuestionId)

  // Callbacks fired from timers and media events read the question id from a
  // ref: re-creating the recorder or the gaze monitor every time the candidate
  // pages to the next question would restart capture on every click.
  questionIdRef.current = currentQuestionId

  const attemptRef = useMemo<AttemptRef | null>(
    () => (attemptId ? { attemptId, kind, parentId } : null),
    [attemptId, kind, parentId]
  )
  const attemptRefRef = useRef<AttemptRef | null>(attemptRef)
  attemptRefRef.current = attemptRef

  const dispatch = useCallback((event: ProctoringEventName) => {
    setState(prev => nextState(prev, event))
  }, [])

  const patchCapture = useCallback((patch: Partial<CaptureState>) => {
    const merged = { ...captureStateRef.current, ...patch }
    captureStateRef.current = merged
    setCapture(merged)
  }, [])

  const elapsed = useCallback(() => {
    if (!startedAtRef.current) return 0
    return Math.max(0, Math.round(performance.now() - startedAtRef.current))
  }, [])

  const queueEvent = useCallback(
    (
      type: string,
      extra?: {
        direction?: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
        durationMs?: number
        severity?: 'INFO' | 'WARN'
      }
    ) => {
      const questionId = questionIdRef.current
      pendingEventsRef.current.push({
        clientEventId: newEventId(),
        type,
        direction: extra?.direction,
        occurredAt: new Date().toISOString(),
        elapsedMs: elapsed(),
        durationMs: extra?.durationMs,
        severity: extra?.severity ?? 'INFO',
        questionId: questionId ?? undefined,
      })
    },
    [elapsed]
  )

  const flushEvents = useCallback(async () => {
    const ref = attemptRefRef.current
    if (!ref) return
    while (pendingEventsRef.current.length > 0) {
      const batch = pendingEventsRef.current.slice(0, EVENT_BATCH_MAX)
      // Remove before sending. A failed batch is dropped rather than retried
      // forever: events are corroborating evidence, and an unbounded retry
      // buffer on a failing network is a worse failure than a missing warning.
      pendingEventsRef.current = pendingEventsRef.current.slice(batch.length)
      const res = await proctoringApi.sendEvents(ref, batch)
      if (!res.ok) return
    }
  }, [])

  const showWarning = useCallback((kind: string) => {
    const message = WARNING_COPY[kind]
    if (!message) return
    setWarning({ message, kind })
    if (warningTimerRef.current !== null) clearTimeout(warningTimerRef.current)
    warningTimerRef.current = setTimeout(() => setWarning(null), WARNING_VISIBLE_MS)
  }, [])

  /** Stop everything. Safe to call more than once, and from an unmount. */
  const teardown = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
    if (eventTimerRef.current !== null) {
      clearInterval(eventTimerRef.current)
      eventTimerRef.current = null
    }
    if (warningTimerRef.current !== null) {
      clearTimeout(warningTimerRef.current)
      warningTimerRef.current = null
    }

    try {
      gazeRef.current?.stop()
    } catch {
      // A monitor that never finished loading has nothing to stop.
    }
    gazeRef.current = null

    try {
      screenCaptureRef.current?.stop()
    } catch {
      // Already stopped.
    }
    screenCaptureRef.current = null

    // The recorder's own stop() is awaited in finalize(). Here the streams are
    // cut regardless, because an unmount cannot wait for a flush and a camera
    // that stays live after the candidate navigates away is the single most
    // visible way to lose their trust.
    recorderRef.current = null

    const streams = [cameraStreamRef.current, screenStreamRef.current]
    streams.forEach(stream => {
      stream?.getTracks().forEach(track => {
        try {
          track.stop()
        } catch {
          // A track already ended by the browser throws on some engines.
        }
      })
    })
    cameraStreamRef.current = null
    screenStreamRef.current = null

    const preview = videoRef.current
    if (preview) preview.srcObject = null
    const inference = inferenceVideoRef.current
    if (inference) inference.srcObject = null
    inferenceVideoRef.current = null

    captureStateRef.current = {
      recording: false,
      screenSharing: false,
      cameraLive: false,
      micLive: false,
    }
    setCapture(captureStateRef.current)
  }, [])

  teardownRef.current = teardown

  useEffect(() => {
    // Teardown runs on unmount and on navigation away, not only on submit. A
    // camera that stays live after the candidate leaves is both a privacy
    // failure and the thing that most visibly erodes trust in the product.
    return () => {
      teardownRef.current?.()
    }
  }, [])

  /**
   * Keep the visible self-view bound to the camera stream.
   *
   * Deliberately has no dependency array, so it runs after every render. The
   * page unmounts the pre-check's preview and mounts a different element in the
   * exam UI, and that swap is not a state change this hook can observe - a
   * one-shot attach at start time leaves the exam's preview permanently blank.
   * The identity check makes the repeated run free.
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

  // Capability check. No permission prompt and no network call - it only reads
  // what the browser exposes, so it is safe to run before any gesture.
  useEffect(() => {
    if (!enabled) return
    const report = checkBrowserSupport()
    setSupport(report)
    if (!report.supported) {
      setState(prev => nextState(prev, 'UNSUPPORTED'))
      setCamera({ state: 'FAILED', message: 'This browser cannot be used for a proctored assessment.' })
      setMicrophone({ state: 'FAILED' })
      setScreen({ state: 'FAILED' })
      return
    }
    setState(prev => nextState(nextState(prev, 'CHECK_DEVICES'), 'DEVICES_OK'))
  }, [enabled])

  const sendHeartbeat = useCallback(async () => {
    const ref = attemptRefRef.current
    if (!ref) return
    const c = captureStateRef.current
    const summary = queueRef.current?.summary()
    const res = await proctoringApi.heartbeat(ref, {
      recording: c.recording,
      screenSharing: c.screenSharing,
      cameraLive: c.cameraLive,
      micLive: c.micLive,
      pendingUploads: summary ? summary.pending + summary.uploading : 0,
    })
    if (!res.ok && res.status === 0) dispatch('OFFLINE')
  }, [dispatch])

  /** One queue item: sign, PUT, then confirm. A throw makes the queue retry. */
  const uploadItem = useCallback(async (item: QueueItem) => {
    const ref = attemptRefRef.current
    if (!ref) throw new Error('No attempt reference')

    // The blob's own type, not a derived guess: the recorder and canvas.toBlob
    // both stamp it, and the server signs the URL for exactly this value.
    const contentType =
      item.blob.type || (item.kind === 'WEBCAM_SEGMENT' ? 'video/webm' : 'image/webp')

    const signed = await proctoringApi.requestUploadUrl(ref, {
      type: item.kind,
      sequence: item.sequence,
      contentType,
      capturedAt: item.capturedAt.toISOString(),
      elapsedMs: item.elapsedMs,
      questionId: item.questionId ?? undefined,
    })
    if (!signed.ok) throw new Error(signed.error)

    const put = await proctoringApi.putObject(signed.data.uploadUrl, item.blob, contentType)
    if (!put.ok) throw new Error(put.error)

    const done = await proctoringApi.completeAsset(ref, signed.data.assetId)
    if (!done.ok) throw new Error(done.error)
  }, [])

  const onQueueChange = useCallback((summary: QueueSummary) => {
    setUploads({ pending: summary.pending + summary.uploading, failed: summary.failed, uploaded: summary.uploaded })
    if (summary.failed > 0 && !uploadDegradedRef.current) {
      uploadDegradedRef.current = true
      setState(prev => nextState(prev, 'UPLOADS_BACKLOGGED'))
      showWarning('UPLOAD_FAILURE')
      queueEvent('UPLOAD_FAILURE', { severity: 'WARN' })
    } else if (summary.failed === 0 && uploadDegradedRef.current) {
      uploadDegradedRef.current = false
      setState(prev => nextState(prev, 'UPLOADS_RECOVERED'))
      queueEvent('UPLOAD_RECOVERED')
    }
  }, [queueEvent, showWarning])

  /**
   * Acquire the display stream. Separated because recovery and a mid-exam
   * resume both need it from their own user gesture.
   */
  const acquireScreen = useCallback(async (): Promise<MediaStream | null> => {
    setScreen({ state: 'CHECKING' })
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        // Audio is deliberately not requested: the screen is sampled as stills
        // and system audio would be captured without being needed.
        audio: false,
      })
      setScreen({ state: 'READY' })
      return stream
    } catch (err) {
      const name = (err as { name?: string }).name
      setScreen({
        state: name === 'NotAllowedError' ? 'DENIED' : 'FAILED',
        message:
          name === 'NotAllowedError'
            ? 'Screen sharing was not allowed. A proctored assessment cannot begin without it.'
            : 'Screen sharing could not be started. Please try again.',
      })
      return null
    }
  }, [])

  const startScreenCapture = useCallback(
    async (stream: MediaStream, cfg: SessionConfig) => {
      const sc = new ScreenCapture({
        stream,
        maxBytes: cfg.maxScreenshotBytes,
        onSnapshot: snapshot => {
          queueRef.current?.enqueue({
            id: `screenshot-${snapshot.sequence}`,
            kind: 'SCREENSHOT',
            sequence: snapshot.sequence,
            blob: snapshot.blob,
            capturedAt: snapshot.capturedAt,
            elapsedMs: snapshot.elapsedMs,
            questionId: questionIdRef.current,
          })
        },
        onEnded: () => {
          patchCapture({ screenSharing: false })
          setScreen({
            state: 'DENIED',
            message: 'Screen sharing has stopped. Please resume it to continue being proctored.',
          })
          dispatch('SCREEN_SHARE_ENDED')
          queueEvent('SCREEN_SHARE_STOPPED', { severity: 'WARN' })
        },
        onError: () => {
          // A single failed snapshot is not worth telling the candidate about;
          // the missing sequence number is visible to a reviewer.
        },
      })
      screenCaptureRef.current = sc
      await sc.start(cfg.screenshotIntervalMs)
      patchCapture({ screenSharing: true })
    },
    [dispatch, patchCapture, queueEvent]
  )

  const requestPermissionsAndStart = useCallback(async (): Promise<boolean> => {
    if (!enabled) return false
    if (startingRef.current) return false
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
      // Screen first, then camera.
      //
      // getDisplayMedia requires transient user activation and the activation
      // from the click expires within a few seconds. A first-time camera prompt
      // can easily outlast it, so asking for the screen while the gesture is
      // still fresh is what stops "allow camera" from making screen sharing
      // impossible.
      //
      // Screen sharing is always required at this point, which is the config's
      // default. PROCTORING_SCREEN_REQUIRED=false cannot be honoured here: the
      // flag arrives with the session config, and the session must not be
      // created until permissions are granted, or a candidate who then denies
      // them would leave a live session that /start would happily accept.
      const screenStream = await acquireScreen()
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
        screenStream.getTracks().forEach(t => t.stop())
        setScreen(IDLE_DEVICE)
        dispatch('PERMISSIONS_DENIED')
        return false
      }

      cameraStreamRef.current = cameraStream
      const hasVideo = cameraStream.getVideoTracks().length > 0
      const hasAudio = cameraStream.getAudioTracks().length > 0
      setCamera(
        hasVideo
          ? { state: 'READY' }
          : { state: 'FAILED', message: 'No camera track was produced. Please check your camera.' }
      )
      setMicrophone(
        hasAudio
          ? { state: 'READY' }
          : { state: 'FAILED', message: 'No microphone track was produced. Please check your microphone.' }
      )
      if (!hasVideo || !hasAudio) {
        dispatch('PERMISSIONS_DENIED')
        return false
      }
      screenStreamRef.current = screenStream
      dispatch('PERMISSIONS_GRANTED')

      // Only now is a session created. Doing it before the prompts would
      // reserve storage for a candidate who then denies permission.
      const started = await proctoringApi.startSession(ref)
      if (!started.ok) {
        if (started.status === 503) {
          dispatch('STORAGE_UNAVAILABLE')
          setStartError({
            message: 'Proctored assessment is temporarily unavailable. Please try again later.',
            code: started.code,
          })
        } else {
          setStartError({ message: started.error, code: started.code })
          dispatch('PERMISSIONS_DENIED')
        }
        teardown()
        return false
      }

      const cfg = started.data.config
      configRef.current = cfg
      startedAtRef.current = performance.now()
      finalizedRef.current = false

      queueRef.current = new UploadQueue({
        maxItems: MAX_QUEUED_UPLOADS,
        maxRetries: UPLOAD_MAX_RETRIES,
        baseDelayMs: UPLOAD_BASE_DELAY_MS,
        upload: uploadItem,
        onStateChange: onQueueChange,
      })

      // Track-ended listeners before capture starts, so a device yanked during
      // startup is still reported rather than looking like a silent stall.
      cameraStream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          patchCapture({ cameraLive: false })
          setCamera({ state: 'FAILED', message: 'The camera has stopped.' })
          dispatch('CAMERA_ENDED')
          queueEvent('CAMERA_STOPPED', { severity: 'WARN' })
        })
      })
      cameraStream.getAudioTracks().forEach(track => {
        track.addEventListener('ended', () => {
          patchCapture({ micLive: false })
          setMicrophone({ state: 'FAILED', message: 'The microphone has stopped.' })
          dispatch('MICROPHONE_ENDED')
          queueEvent('MICROPHONE_STOPPED', { severity: 'WARN' })
        })
      })

      const recorder = new WebcamRecorder({
        stream: cameraStream,
        segmentMs: cfg.videoSegmentMs,
        videoBitsPerSecond: cfg.videoBitsPerSecond,
        audioBitsPerSecond: cfg.audioBitsPerSecond,
        onSegment: segment => {
          queueRef.current?.enqueue({
            id: `segment-${segment.sequence}`,
            kind: 'WEBCAM_SEGMENT',
            sequence: segment.sequence,
            blob: segment.blob,
            capturedAt: segment.capturedAt,
            elapsedMs: segment.elapsedMs,
            questionId: questionIdRef.current,
          })
        },
        onError: () => {
          patchCapture({ recording: false })
        },
      })
      recorderRef.current = recorder
      recorder.start()
      patchCapture({ recording: true, cameraLive: true, micLive: true })

      await startScreenCapture(screenStream, cfg)

      // Gaze reads from its own element rather than the preview, so inference
      // is unaffected by the page unmounting the self-view when it switches
      // from the pre-check screen to the questions.
      try {
        const inference = document.createElement('video')
        inference.muted = true
        inference.playsInline = true
        inference.srcObject = cameraStream
        inferenceVideoRef.current = inference
        await inference.play().catch(() => undefined)

        const monitor = await GazeMonitor.create({
          thresholds: DEFAULT_GAZE_THRESHOLDS,
          gazeWarningMs: cfg.gazeWarningMs,
          gazeWarningCooldownMs: cfg.gazeWarningCooldownMs,
          faceMissingWarningMs: cfg.faceMissingWarningMs,
          multipleFacesWarningMs: cfg.multipleFacesWarningMs,
          onWarning: (w: GazeWarning) => {
            showWarning(w.type)
            queueEvent(w.type, {
              direction: w.direction ?? undefined,
              durationMs: w.durationMs,
              severity: 'WARN',
            })
          },
          onError: () => {
            // Inference failures are not the candidate's problem and must not
            // interrupt them. Recording and screenshots continue regardless.
          },
        })
        gazeRef.current = monitor
        monitor.start(inference)
      } catch {
        // Gaze analysis is the one part of proctoring that may be absent
        // without invalidating the evidence - the recording is still made. A
        // failed model load therefore degrades rather than refusing to start.
      }

      dispatch('SESSION_STARTED')
      setCaptureLive(true)
      queueEvent('PROCTORING_STARTED')

      heartbeatTimerRef.current = setInterval(() => {
        void sendHeartbeat()
      }, cfg.heartbeatIntervalMs)
      eventTimerRef.current = setInterval(() => {
        void flushEvents()
      }, EVENT_FLUSH_INTERVAL_MS)

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
    acquireScreen,
    dispatch,
    enabled,
    flushEvents,
    onQueueChange,
    patchCapture,
    queueEvent,
    sendHeartbeat,
    showWarning,
    startScreenCapture,
    support.supported,
    teardown,
    uploadItem,
  ])

  const resumeScreenShare = useCallback(async (): Promise<boolean> => {
    const cfg = configRef.current
    if (!cfg) return false
    const stream = await acquireScreen()
    if (!stream) return false

    screenCaptureRef.current?.stop()
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    screenStreamRef.current = stream
    await startScreenCapture(stream, cfg)
    dispatch('SCREEN_SHARE_RESUMED')
    queueEvent('SCREEN_SHARE_RESUMED')
    return true
  }, [acquireScreen, dispatch, queueEvent, startScreenCapture])

  const finalize = useCallback(async (): Promise<void> => {
    if (!enabled) return
    if (finalizedRef.current) return
    finalizedRef.current = true
    dispatch('FINALIZE')

    try {
      // Flush the final segment into the queue before anything is torn down,
      // or the last stretch of the assessment is simply missing.
      await recorderRef.current?.stop()
    } catch {
      // A recorder that already errored has nothing left to flush.
    }

    try {
      screenCaptureRef.current?.stop()
    } catch {
      // Already stopped.
    }

    queueEvent('PROCTORING_ENDED')

    const queue = queueRef.current
    if (queue) {
      // Raced, not awaited outright: a candidate on a dying connection must not
      // be held at the submit button by an upload that will never finish.
      await Promise.race([
        queue.drain(),
        new Promise<void>(resolve => setTimeout(resolve, FINALIZE_DRAIN_TIMEOUT_MS)),
      ])
    }

    try {
      await flushEvents()
    } catch {
      // Events are corroborating evidence; losing the last batch is survivable.
    }

    const ref = attemptRefRef.current
    if (ref) {
      // Best effort. The stale sweep and the submit route's safety net both
      // close a session whose client never got here.
      await proctoringApi.finalize(ref)
    }

    teardown()
    dispatch('FINALIZED')
    setCaptureLive(false)
  }, [dispatch, enabled, flushEvents, queueEvent, teardown])

  // Tab and focus changes are proctoring evidence in their own right. The pages
  // already record their own violations; these are the proctoring-side rows, so
  // a reviewer sees them on the same timeline as the gaze warnings.
  useEffect(() => {
    if (!enabled || !captureLive) return

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') queueEvent('TAB_HIDDEN', { severity: 'WARN' })
    }
    const onBlur = () => queueEvent('WINDOW_BLURRED', { severity: 'WARN' })
    const onOffline = () => dispatch('OFFLINE')
    const onOnline = () => dispatch('ONLINE')

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [dispatch, enabled, captureLive, queueEvent])

  const needsRecovery = enabled && alreadyStarted && !captureLive

  return {
    state,
    support,
    devices: { camera, microphone, screen },
    warning,
    uploads,
    capture,
    startError,
    needsRecovery,
    requestPermissionsAndStart,
    resumeScreenShare,
    finalize,
    videoRef,
  }
}
