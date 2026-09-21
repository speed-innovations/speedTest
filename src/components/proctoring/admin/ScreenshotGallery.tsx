'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2, X } from 'lucide-react'

/**
 * Screen snapshots in capture order, signed on demand.
 *
 * The laziness is the point. A 60-minute attempt produces ~61 screenshots;
 * signing them all on mount would be 61 live bearer tokens and a slow page, for
 * a reviewer who typically looks at three. Each tile signs its own URL the
 * first time it scrolls into view and never again.
 */

export interface GalleryShot {
  id: string
  sequence: number
  status: string
  elapsedMs: number | null
  capturedAt: string | Date
  questionId: string | null
  byteSize: number
}

function formatElapsed(ms: number | null): string {
  if (ms === null) return '--:--'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function Tile({
  shot,
  questionNumber,
  onOpen,
}: {
  shot: GalleryShot
  questionNumber: number | null
  onOpen: (url: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const requestedRef = useRef(false)

  const sign = useCallback(async () => {
    if (requestedRef.current) return
    requestedRef.current = true
    setState('loading')
    try {
      const res = await fetch(`/api/admin/proctoring/assets/${shot.id}/download-url`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        setState('unavailable')
        return
      }
      setUrl(data.url as string)
      setState('ready')
    } catch {
      setState('unavailable')
    }
  }, [shot.id])

  useEffect(() => {
    // An asset that is not UPLOADED has nothing to sign - notably EXPIRED,
    // which is the normal state after the retention period rather than a fault.
    if (shot.status !== 'UPLOADED') {
      setState('unavailable')
      return
    }
    const el = ref.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      // No observer (older browser, or jsdom): fall back to signing eagerly
      // rather than showing a gallery that never loads.
      void sign()
      return
    }

    const io = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            void sign()
            io.disconnect()
          }
        })
      },
      // A little ahead of the viewport, so scrolling does not reveal blanks.
      { rootMargin: '200px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shot.status, sign])

  return (
    <div ref={ref} className="rounded-lg border border-gray-200 overflow-hidden bg-white">
      <div className="relative aspect-video bg-gray-100 flex items-center justify-center">
        {state === 'ready' && url ? (
          <button onClick={() => onOpen(url)} className="w-full h-full" aria-label={`Enlarge screenshot ${shot.sequence}`}>
            {/*
              A plain <img>, not next/image: the src is a short-lived presigned
              URL on a storage origin, which the image optimiser cannot be
              configured for and should not proxy.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Screen snapshot ${shot.sequence} at ${formatElapsed(shot.elapsedMs)}`}
              loading="lazy"
              className="w-full h-full object-cover hover:opacity-90 transition-opacity"
            />
          </button>
        ) : state === 'loading' ? (
          <Loader2 size={18} className="text-gray-400 animate-spin" />
        ) : state === 'unavailable' ? (
          <div className="text-center px-2 py-3">
            <ImageOff size={18} className="text-gray-400 mx-auto mb-1.5" />
            <p className="text-[11px] text-gray-500 leading-snug">
              {shot.status === 'EXPIRED' || shot.status === 'DELETED'
                ? 'Screenshot expired — removed under the retention policy'
                : 'Screenshot unavailable'}
            </p>
          </div>
        ) : (
          <div className="w-full h-full" />
        )}
      </div>
      <div className="px-2 py-1.5 text-[11px] text-gray-500 flex items-center justify-between gap-1">
        <span className="font-mono">{formatElapsed(shot.elapsedMs)}</span>
        <span>
          {questionNumber !== null ? `Q${questionNumber}` : new Date(shot.capturedAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}

export default function ScreenshotGallery({
  shots,
  questionOrder,
}: {
  shots: GalleryShot[]
  /** Assigned question ids in order, so a shot can show "Q7" rather than a cuid. */
  questionOrder?: string[]
}) {
  const [enlarged, setEnlarged] = useState<string | null>(null)

  if (shots.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
        <ImageOff size={22} className="text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No screen snapshots were captured for this attempt.</p>
      </div>
    )
  }

  const numberFor = (questionId: string | null): number | null => {
    if (!questionId || !questionOrder) return null
    const idx = questionOrder.indexOf(questionId)
    return idx === -1 ? null : idx + 1
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {shots.map(shot => (
          <Tile
            key={shot.id}
            shot={shot}
            questionNumber={numberFor(shot.questionId)}
            onOpen={setEnlarged}
          />
        ))}
      </div>

      {enlarged && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setEnlarged(null)}
        >
          <button
            onClick={() => setEnlarged(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            aria-label="Close"
          >
            <X size={24} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enlarged} alt="Screen snapshot, enlarged" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </>
  )
}
