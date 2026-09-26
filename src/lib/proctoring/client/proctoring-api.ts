import type { AttemptKind } from '../types'

/**
 * Typed wrappers over the Part 4-6 endpoints.
 *
 * The only module that knows these URLs, so Part 9's hook contains no fetch
 * calls. Every method returns a discriminated result rather than throwing: a
 * proctoring failure must be something the caller can degrade around, never
 * something that crashes a live assessment.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string }

export interface AttemptRef {
  attemptId: string
  kind: AttemptKind
  parentId: string
}

export interface SessionConfig {
  screenshotIntervalMs: number
  videoSegmentMs: number
  videoBitsPerSecond: number
  audioBitsPerSecond: number
  maxScreenshotBytes: number
  heartbeatIntervalMs: number
  screenRequired: boolean
}

export interface StartedSession {
  sessionId: string
  status: string
  version: string
  retentionExpiresAt: string
  config: SessionConfig
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
        // The server's message, when it gave one. errorResponse never puts
        // internal detail in it, so this is safe to show a candidate.
        error: (body && typeof body.error === 'string' && body.error) || `Request failed (${res.status})`,
        code: body && typeof body.code === 'string' ? body.code : undefined,
      }
    }
    return { ok: true, data: body as T }
  } catch (err) {
    // Network failure, offline, or a navigation cancelling the request.
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' }
  }
}

const post = <T>(url: string, body: unknown) =>
  request<T>(url, { method: 'POST', body: JSON.stringify(body) })

export const proctoringApi = {
  startSession(ref: AttemptRef): Promise<ApiResult<StartedSession>> {
    return post<StartedSession>('/api/student/proctoring/session', ref)
  },

  /**
   * Recovery read. A reload cannot resume capture on its own - getDisplayMedia
   * needs a user gesture - so the UI uses this to decide whether to show the
   * recovery screen.
   */
  getSession(ref: AttemptRef): Promise<ApiResult<{
    proctoringEnabled: boolean
    session: { sessionId: string; status: string; startedAt: string | null } | null
  }>> {
    const q = new URLSearchParams({ attemptId: ref.attemptId, kind: ref.kind, parentId: ref.parentId })
    return request(`/api/student/proctoring/session?${q.toString()}`)
  },

  heartbeat(ref: AttemptRef, state: {
    recording: boolean
    screenSharing: boolean
    cameraLive: boolean
    micLive: boolean
    pendingUploads?: number
    lastSegmentSequence?: number
    lastScreenshotSequence?: number
  }): Promise<ApiResult<{ ok: boolean; session: { sessionId: string; degraded: boolean } | null }>> {
    return post('/api/student/proctoring/heartbeat', { ...ref, ...state })
  },

  finalize(ref: AttemptRef): Promise<ApiResult<{ ok: boolean; alreadyFinalized: boolean }>> {
    return post('/api/student/proctoring/finalize', ref)
  },

  requestUploadUrl(ref: AttemptRef, asset: {
    type: 'WEBCAM_SEGMENT' | 'SCREENSHOT'
    sequence: number
    contentType: string
    capturedAt: string
    elapsedMs?: number
    questionId?: string
  }): Promise<ApiResult<{ assetId: string; uploadUrl: string; expiresAt: string }>> {
    return post('/api/student/proctoring/upload-url', { ...ref, ...asset })
  },

  /**
   * The direct PUT to object storage. Deliberately not JSON, and deliberately
   * without credentials - the presigned URL carries its own authorization, and
   * sending cookies to the storage origin would be both useless and leaky.
   */
  async putObject(uploadUrl: string, blob: Blob, contentType: string): Promise<ApiResult<null>> {
    try {
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': contentType },
        credentials: 'omit',
      })
      if (!res.ok) return { ok: false, status: res.status, error: `Upload failed (${res.status})` }
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Upload failed' }
    }
  },

  completeAsset(ref: AttemptRef, assetId: string): Promise<ApiResult<{
    ok: boolean; byteSize: number; status: string
  }>> {
    return post('/api/student/proctoring/asset-complete', { ...ref, assetId })
  },

  sendEvents(ref: AttemptRef, events: unknown[]): Promise<ApiResult<{
    accepted: number; duplicates: number
  }>> {
    return post('/api/student/proctoring/events', { ...ref, events })
  },
}
