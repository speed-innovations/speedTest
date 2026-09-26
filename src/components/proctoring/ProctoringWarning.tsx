'use client'
import { AlertTriangle } from 'lucide-react'

/**
 * The transient proctoring banner.
 *
 * `role="status"` with `aria-live="polite"` on purpose: a screen reader
 * announces it at the next pause instead of interrupting the question the
 * candidate is part-way through reading. `assertive` would steal focus and make
 * the warning cost them the answer.
 *
 * It never blocks interaction and has no dismiss-to-continue. A warning is
 * evidence for a human reviewer, not a punishment, and a candidate must always
 * be able to keep answering while one is on screen.
 */

export default function ProctoringWarning({
  warning,
}: {
  warning: { message: string; kind: string } | null
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      // Always rendered, so the live region exists before the first message.
      // A region inserted at the same moment as its content is often not
      // announced at all.
      className="pointer-events-none fixed top-16 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4"
    >
      {warning && (
        <div
          className="flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-4 py-3 shadow-lg text-sm"
          data-testid="proctoring-warning"
          data-kind={warning.kind}
        >
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span className="leading-relaxed">{warning.message}</span>
        </div>
      )}
    </div>
  )
}
