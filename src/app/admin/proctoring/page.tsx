'use client'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'

/**
 * Proctoring capacity, for an operator deciding whether tomorrow's drive can
 * run.
 *
 * The headline is deliberately "attempts remaining", not "bytes remaining".
 * With the default 7 GB budget the answer is roughly 75 attempts per rolling
 * three-day window, and that is the number a drive gets planned around - bytes
 * require arithmetic nobody does under pressure.
 *
 * The rolling part is the bit that surprises people, so the page says it in
 * words: media is held for the full retention period and does not free up when
 * an attempt is submitted, so staggering a cohort into waves does not help.
 */

interface Usage {
  reservedBytes: number
  storedBytes: number
  totalBytes: number
  safetyBytes: number
  remainingBytes: number
  activeSessions: number
  assetsAwaitingCleanup: number
  expiredAssets: number
  uploadFailures: number
  avgSegmentBytes: number
  avgScreenshotBytes: number
  bytesPerAttempt: number
  estimatedAttemptsRemaining: number
  retentionHours: number
  storageProvider: string
}

function gb(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`
}

function mb(bytes: number): string {
  if (bytes === 0) return '—'
  const v = bytes / 1_000_000
  return v < 1 ? `${Math.round(bytes / 1000)} KB` : `${v.toFixed(1)} MB`
}

export default function ProctoringUsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/proctoring/usage')
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Could not load proctoring usage.')
        return
      }
      setUsage(data as Usage)
    } catch {
      setError('Could not load proctoring usage.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const usedPct = usage && usage.safetyBytes > 0
    ? Math.min(100, Math.round((usage.totalBytes / usage.safetyBytes) * 100))
    : 0

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ShieldCheck size={22} className="text-brand-purple" /> Proctoring Usage
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Storage capacity for proctored assessments, read from the assessment database.
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="btn-secondary disabled:opacity-60">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 mb-6">{error}</div>
      )}

      {loading && !usage && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-10">
          <Loader2 size={16} className="animate-spin" /> Loading usage…
        </div>
      )}

      {usage && (
        <div className="space-y-6">
          {/* The headline figure. */}
          <div className="card">
            <div className="flex flex-wrap items-end gap-8">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Attempts remaining
                </div>
                <div className="text-4xl font-bold text-brand-purple">
                  {usage.estimatedAttemptsRemaining}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  at {mb(usage.bytesPerAttempt)} reserved per 60-minute attempt
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Remaining</div>
                <div className="text-2xl font-semibold text-gray-800">{gb(usage.remainingBytes)}</div>
                <div className="text-xs text-gray-500 mt-1">of {gb(usage.safetyBytes)} budget</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Assessments in progress
                </div>
                <div className="text-2xl font-semibold text-gray-800">{usage.activeSessions}</div>
                <div className="text-xs text-gray-500 mt-1">holding a reservation</div>
              </div>
            </div>

            <div className="mt-5">
              <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-amber-500' : 'bg-brand-purple'
                  }`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1.5">
                <span>{gb(usage.totalBytes)} committed ({usedPct}%)</span>
                <span>{gb(usage.safetyBytes)}</span>
              </div>
            </div>

            {usage.estimatedAttemptsRemaining === 0 && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                The budget is committed. New proctored assessments will be refused with
                &ldquo;temporarily unavailable&rdquo; until existing media passes its retention
                period. This is the configured limit working as intended, not a fault.
              </div>
            )}
          </div>

          {/*
            Cleanup backlog. If the scheduled job stalls this is the only place
            it surfaces before the budget is quietly eaten, so it gets its own
            card rather than a row in a table.
          */}
          <div className={`card ${usage.assetsAwaitingCleanup > 0 ? 'border-amber-300' : ''}`}>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Cleanup backlog</div>
            <div className="flex flex-wrap items-end gap-8">
              <div>
                <div className={`text-3xl font-bold ${usage.assetsAwaitingCleanup > 0 ? 'text-amber-600' : 'text-gray-800'}`}>
                  {usage.assetsAwaitingCleanup}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  assets past their {usage.retentionHours}-hour retention, not yet deleted
                </div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-gray-700">{usage.expiredAssets}</div>
                <div className="text-xs text-gray-500 mt-1">marked expired</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-gray-700">{usage.uploadFailures}</div>
                <div className="text-xs text-gray-500 mt-1">failed uploads</div>
              </div>
            </div>
            {usage.assetsAwaitingCleanup > 0 && (
              <p className="text-xs text-amber-700 mt-3 leading-relaxed">
                These no longer count against the budget, but they still occupy the bucket. A
                number that keeps climbing means the cleanup job is not running.
              </p>
            )}
          </div>

          <div className="card">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Breakdown</div>
            <div className="divide-y divide-gray-100 text-sm">
              {[
                ['Reserved by assessments in progress', gb(usage.reservedBytes)],
                ['Stored and within retention', gb(usage.storedBytes)],
                ['Total committed', gb(usage.totalBytes)],
                ['Average recording segment', mb(usage.avgSegmentBytes)],
                ['Average screen snapshot', mb(usage.avgScreenshotBytes)],
                ['Retention period', `${usage.retentionHours} hours`],
                ['Storage provider', usage.storageProvider],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-2.5">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-medium text-gray-800">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 leading-relaxed">
            <p className="font-medium mb-1">Why capacity is a rolling figure</p>
            Recorded media is held for the full {usage.retentionHours}-hour retention period. It
            does not free up when a candidate submits, so completed attempts keep consuming the
            budget until they expire. Splitting a large drive into waves does not raise the
            ceiling — a later wave still competes with the first wave&apos;s media.
          </div>
        </div>
      )}
    </div>
  )
}
