/**
 * Fixed-window, in-process rate limiting.
 *
 * Scope and honesty about it: this runs in one Node process. Render's free plan
 * is single-instance so it is effective there, but it does not coordinate across
 * instances and its state is lost on deploy and on cold start. It raises the
 * cost of hammering an endpoint; it is not an authorization control, and nothing
 * downstream may rely on it for correctness.
 *
 * Fixed window rather than sliding: a sliding log would retain a timestamp per
 * request per key, which is unbounded memory for an endpoint a hostile client
 * controls. The window boundary lets through at most 2x the limit in a burst,
 * which is an acceptable trade for O(1) memory per key.
 */

interface Window { count: number; resetAt: number }

const windows = new Map<string, Window>()
/** Bound the map so a client cycling keys cannot exhaust memory. */
const MAX_KEYS = 10_000

/** True when the call is allowed; false when it should be refused. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const existing = windows.get(key)

  if (!existing || now >= existing.resetAt) {
    if (windows.size >= MAX_KEYS) evictExpired(now)
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (existing.count >= limit) return false
  existing.count++
  return true
}

/**
 * Written with forEach rather than for...of or spread: tsconfig targets es5,
 * where iterating a Map directly needs downlevelIteration. Changing the
 * project's target for one helper is not worth it.
 */
function evictExpired(now: number): void {
  const expired: string[] = []
  windows.forEach((w, k) => { if (now >= w.resetAt) expired.push(k) })
  expired.forEach(k => windows.delete(k))

  // Still full of live windows: drop the oldest half rather than grow without bound.
  if (windows.size >= MAX_KEYS) {
    const live: Array<{ key: string; resetAt: number }> = []
    windows.forEach((w, k) => live.push({ key: k, resetAt: w.resetAt }))
    live.sort((a, b) => a.resetAt - b.resetAt)
      .slice(0, Math.floor(MAX_KEYS / 2))
      .forEach(e => windows.delete(e.key))
  }
}

export function resetRateLimitsForTests(): void { windows.clear() }
