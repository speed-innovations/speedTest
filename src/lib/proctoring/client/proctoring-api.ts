import type { AttemptKind } from '../types'
import type { DeviceHealth } from './integrity-monitor'
import type { WireEvent } from './event-queue'

/**
 * Typed wrappers over the student proctoring endpoints - the only module that
 * knows these URLs. Every method returns a discriminated result rather than
 * throwing: proctoring failures are degraded around, never allowed to crash a
 * live assessment. Nothing here ever carries media.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string }

export interface AttemptRef {
  attemptId: string
  kind: AttemptKind
  parentId: string
}

/** Operational only. Detection thresholds are never sent by the server. */
export interface SessionConfig {
  heartbeatIntervalMs: number
  screenRequired: boolean
}

export interface StartedSession {
  sessionId: string
  status: string
  version: string
  retentionExpiresAt: string
  resumed: boolean
  config: SessionConfig
}

export type GazeMonitorHealth = 'STARTING' | 'CALIBRATING' | 'RUNNING' | 'UNAVAILABLE' | 'STOPPED'

export interface HeartbeatReport {
  sessionId: string
  clientState: string
  camera: DeviceHealth
  microphone: DeviceHealth
  screen: DeviceHealth
  gazeMonitor: GazeMonitorHealth
  clientTimestamp: string
  droppedEvents?: number
}

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        // errorResponse never puts internal detail in `error`, so this is safe to show.
        error: (body && typeof body.error === 'string' && body.error) || `Request failed (${res.status})`,
        code: body && typeof body.code === 'string' ? body.code : body && typeof body.error === 'string' ? body.error : undefined,
      }
    }
    return { ok: true, data: body as T }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' }
  }
}

const post = <T>(url: string, body: unknown, extra: RequestInit = {}) =>
  request<T>(url, { method: 'POST', body: JSON.stringify(body), ...extra })

export const proctoringApi = {
  startSession(ref: AttemptRef): Promise<ApiResult<StartedSession>> {
    return post<StartedSession>('/api/student/proctoring/session', ref)
  },

  getSession(ref: AttemptRef): Promise<ApiResult<{
    proctoringEnabled: boolean
    session: { sessionId: string; status: string; startedAt: string | null } | null
  }>> {
    const q = new URLSearchParams({ attemptId: ref.attemptId, kind: ref.kind, parentId: ref.parentId })
    return request(`/api/student/proctoring/session?${q.toString()}`)
  },

  heartbeat(ref: AttemptRef, report: HeartbeatReport): Promise<ApiResult<{
    ok: boolean
    session: { sessionId: string; status: string } | null
  }>> {
    return post('/api/student/proctoring/heartbeat', { ...ref, ...report })
  },

  finalize(ref: AttemptRef): Promise<ApiResult<{ ok: boolean; alreadyFinalized: boolean }>> {
    return post('/api/student/proctoring/finalize', ref)
  },

  /** `keepalive` lets the pagehide flush outlive the page. */
  sendEvents(ref: AttemptRef, sessionId: string, events: WireEvent[], opts: { keepalive?: boolean } = {}): Promise<ApiResult<{
    accepted: number
    duplicates: number
    capped: boolean
    /** The live session id, or null when the session is closed and nothing was stored. */
    session: string | null
  }>> {
    return post('/api/student/proctoring/events', { ...ref, sessionId, events }, { keepalive: !!opts.keepalive })
  },
}
