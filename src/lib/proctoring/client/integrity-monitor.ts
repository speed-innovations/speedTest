import type { ClientEventType } from '../event-types'

/**
 * Tamper and interruption detection: media tracks and page lifecycle.
 *
 * Every event is an observation, never a verdict. A blur or a hidden tab
 * means only that the page lost focus; a reviewer reads it next to everything
 * else. What this class guarantees is that nothing goes quiet: an ended or
 * muted track changes device health at once, so the UI and the heartbeat
 * never report a dead device as healthy.
 *
 * Options take a clock, a document and a window, so the whole class runs
 * under jsdom with fake time.
 */

export type DeviceKind = 'camera' | 'microphone' | 'screen'
export type DeviceHealth = 'ACTIVE' | 'MUTED' | 'ENDED' | 'UNAVAILABLE'

export interface IntegrityEvent {
  type: ClientEventType
  /** When it happened, on the `now()` clock. */
  atMs: number
  durationMs?: number
  metadata?: Record<string, string | number | boolean>
}

export interface IntegrityMonitorOptions {
  onEvent: (e: IntegrityEvent) => void
  onHealthChange?: (health: Record<DeviceKind, DeviceHealth>) => void
  /** Last chance to flush before the page goes away. */
  onPageHide?: () => void
  /** A blur shorter than this is flicker - a permission prompt, the share bar. */
  blurDebounceMs?: number
  now?: () => number
  doc?: Document
  win?: Window
}

const INTERRUPTED: Record<DeviceKind, ClientEventType> = {
  camera: 'CAMERA_INTERRUPTED',
  microphone: 'MICROPHONE_INTERRUPTED',
  screen: 'SCREEN_SHARE_INTERRUPTED',
}

const RESTORED: Record<DeviceKind, ClientEventType> = {
  camera: 'CAMERA_RESTORED',
  microphone: 'MICROPHONE_RESTORED',
  screen: 'SCREEN_SHARE_RESUMED',
}

export class IntegrityMonitor {
  private health: Record<DeviceKind, DeviceHealth> = { camera: 'UNAVAILABLE', microphone: 'UNAVAILABLE', screen: 'UNAVAILABLE' }
  private trackCleanup: Record<DeviceKind, (() => void) | null> = { camera: null, microphone: null, screen: null }
  private mutedAt: { [device: string]: number } = {}
  private pageCleanup: (() => void) | null = null
  private hiddenAt: number | null = null
  private fullscreenAt: number | null = null
  private blurredAt: number | null = null
  private blurTimer: ReturnType<typeof setTimeout> | null = null
  private blurReported = false
  private readonly now: () => number
  private readonly blurDebounceMs: number

  constructor(private readonly opts: IntegrityMonitorOptions) {
    this.now = opts.now ?? (() => performance.now())
    this.blurDebounceMs = opts.blurDebounceMs ?? 300
  }

  /** Watch a track, replacing any previous track for that device. */
  watchTrack(device: DeviceKind, track: MediaStreamTrack | undefined): void {
    this.unwatch(device)
    if (!track) {
      this.setHealth(device, 'UNAVAILABLE')
      return
    }
    const onEnded = () => {
      this.unwatch(device)
      this.setHealth(device, 'ENDED')
      this.emit(INTERRUPTED[device], { metadata: { reason: 'ended' } })
    }
    const onMute = () => {
      if (this.health[device] !== 'ACTIVE') return
      this.mutedAt[device] = this.now()
      this.setHealth(device, 'MUTED')
      this.emit(INTERRUPTED[device], { metadata: { reason: 'muted' } })
    }
    const onUnmute = () => {
      if (this.health[device] !== 'MUTED') return
      const since = this.mutedAt[device]
      delete this.mutedAt[device]
      this.setHealth(device, 'ACTIVE')
      this.emit(RESTORED[device], {
        durationMs: since === undefined ? undefined : this.now() - since,
        metadata: { reason: 'unmuted' },
      })
    }
    track.addEventListener('ended', onEnded)
    track.addEventListener('mute', onMute)
    track.addEventListener('unmute', onUnmute)
    this.trackCleanup[device] = () => {
      track.removeEventListener('ended', onEnded)
      track.removeEventListener('mute', onMute)
      track.removeEventListener('unmute', onUnmute)
    }
    this.setHealth(device, track.readyState === 'ended' ? 'ENDED' : track.muted ? 'MUTED' : 'ACTIVE')
  }

  attachPage(): void {
    if (this.pageCleanup) return
    const doc = this.opts.doc ?? document
    const win = this.opts.win ?? window

    const onVisibility = () => {
      if (doc.visibilityState === 'hidden') {
        if (this.hiddenAt !== null) return
        this.hiddenAt = this.now()
        this.emit('TAB_HIDDEN')
      } else if (this.hiddenAt !== null) {
        const d = this.now() - this.hiddenAt
        this.hiddenAt = null
        this.emit('TAB_VISIBLE', { durationMs: d })
      }
    }
    const onPageHide = () => {
      this.emit('PAGE_HIDDEN')
      this.opts.onPageHide?.()
    }
    const onFullscreen = () => {
      if (doc.fullscreenElement) {
        if (this.fullscreenAt !== null) return
        this.fullscreenAt = this.now()
        this.emit('FULLSCREEN_ENTERED')
      } else if (this.fullscreenAt !== null) {
        const d = this.now() - this.fullscreenAt
        this.fullscreenAt = null
        this.emit('FULLSCREEN_EXITED', { durationMs: d })
      }
    }
    const onBlur = () => {
      if (this.blurredAt !== null) return
      const at = this.now()
      this.blurredAt = at
      this.blurReported = false
      this.blurTimer = setTimeout(() => {
        this.blurTimer = null
        this.blurReported = true
        this.emit('WINDOW_BLUR', { atMs: at })
      }, this.blurDebounceMs)
    }
    const onFocus = () => {
      if (this.blurredAt === null) return
      const d = this.now() - this.blurredAt
      this.blurredAt = null
      if (this.blurTimer !== null) {
        clearTimeout(this.blurTimer)
        this.blurTimer = null
        return
      }
      if (this.blurReported) this.emit('WINDOW_FOCUS', { durationMs: d })
    }

    doc.addEventListener('visibilitychange', onVisibility)
    doc.addEventListener('fullscreenchange', onFullscreen)
    win.addEventListener('pagehide', onPageHide)
    win.addEventListener('blur', onBlur)
    win.addEventListener('focus', onFocus)
    this.pageCleanup = () => {
      doc.removeEventListener('visibilitychange', onVisibility)
      doc.removeEventListener('fullscreenchange', onFullscreen)
      win.removeEventListener('pagehide', onPageHide)
      win.removeEventListener('blur', onBlur)
      win.removeEventListener('focus', onFocus)
      if (this.blurTimer !== null) {
        clearTimeout(this.blurTimer)
        this.blurTimer = null
      }
    }
  }

  getHealth(): Record<DeviceKind, DeviceHealth> {
    return { camera: this.health.camera, microphone: this.health.microphone, screen: this.health.screen }
  }

  /** Remove every listener. Safe to call more than once. */
  detach(): void {
    this.unwatch('camera')
    this.unwatch('microphone')
    this.unwatch('screen')
    if (this.pageCleanup) {
      this.pageCleanup()
      this.pageCleanup = null
    }
    this.hiddenAt = null
    this.fullscreenAt = null
    this.blurredAt = null
    this.mutedAt = {}
  }

  private unwatch(device: DeviceKind): void {
    const cleanup = this.trackCleanup[device]
    if (cleanup) cleanup()
    this.trackCleanup[device] = null
  }

  private setHealth(device: DeviceKind, h: DeviceHealth): void {
    if (this.health[device] === h) return
    this.health[device] = h
    this.opts.onHealthChange?.(this.getHealth())
  }

  private emit(
    type: ClientEventType,
    extra: { durationMs?: number; metadata?: IntegrityEvent['metadata']; atMs?: number } = {}
  ): void {
    this.opts.onEvent({
      type,
      atMs: extra.atMs ?? this.now(),
      durationMs: extra.durationMs === undefined ? undefined : Math.max(0, Math.round(extra.durationMs)),
      metadata: extra.metadata,
    })
  }
}
