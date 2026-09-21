'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, VideoOff } from 'lucide-react'

/**
 * Webcam playback as a playlist over segments.
 *
 * There is no merged file and none is wanted: concatenating WebM segments
 * server-side would mean transcoding, and a review tool does not need it. On
 * `ended` the player advances, so a session plays through as one sitting.
 *
 * Each segment's URL is signed only when it is about to play. Signing all
 * twelve on mount would hand out twelve live bearer tokens for a reviewer who
 * will usually watch one.
 */

export interface PlayableSegment {
  id: string
  sequence: number
  status: string
  elapsedMs: number | null
  byteSize: number
  capturedAt: string | Date
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

export default function RecordingPlayer({ segments }: { segments: PlayableSegment[] }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [index, setIndex] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [playing, setPlaying] = useState(false)
  /** Set once the reviewer has pressed play, so advancing keeps playing. */
  const autoPlayRef = useRef(false)

  const current = segments[index]

  const loadSegment = useCallback(async (assetId: string) => {
    setLoading(true)
    setUnavailable(false)
    setUrl(null)
    try {
      const res = await fetch(`/api/admin/proctoring/assets/${assetId}/download-url`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        // A 410 here is normal after the retention period, not a failure.
        setUnavailable(true)
        return
      }
      setUrl(data.url as string)
    } catch {
      setUnavailable(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!current) return
    if (current.status !== 'UPLOADED') {
      setUrl(null)
      setUnavailable(true)
      setLoading(false)
      return
    }
    void loadSegment(current.id)
  }, [current, loadSegment])

  const goTo = useCallback((next: number) => {
    if (next < 0 || next >= segments.length) return
    setIndex(next)
  }, [segments.length])

  /**
   * Skip forward past a segment that cannot play.
   *
   * Stalling on a missing segment would strand a reviewer mid-session with no
   * indication that the rest is fine. Only skips while auto-playing, so a
   * reviewer who navigated here deliberately still sees why it is unavailable.
   */
  useEffect(() => {
    if (!unavailable || !autoPlayRef.current) return
    if (index >= segments.length - 1) {
      autoPlayRef.current = false
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setIndex(i => i + 1), 700)
    return () => clearTimeout(t)
  }, [unavailable, index, segments.length])

  // Resume playback into the newly loaded segment.
  useEffect(() => {
    const el = videoRef.current
    if (!el || !url || !autoPlayRef.current) return
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }, [url])

  function togglePlay() {
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      autoPlayRef.current = true
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      autoPlayRef.current = false
      el.pause()
      setPlaying(false)
    }
  }

  function onEnded() {
    if (index < segments.length - 1) {
      autoPlayRef.current = true
      setIndex(index + 1)
    } else {
      autoPlayRef.current = false
      setPlaying(false)
    }
  }

  if (segments.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
        <VideoOff size={22} className="text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No recording segments were captured for this attempt.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="relative bg-gray-900 aspect-video flex items-center justify-center">
        {url ? (
          <video
            ref={videoRef}
            src={url}
            controls
            onEnded={onEnded}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className="w-full h-full"
          />
        ) : loading ? (
          <Loader2 size={24} className="text-white/60 animate-spin" />
        ) : (
          <div className="text-center px-4">
            <VideoOff size={22} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm text-gray-300">Recording segment unavailable</p>
            <p className="text-xs text-gray-500 mt-1">
              {current?.status === 'EXPIRED'
                ? 'Removed under the retention policy.'
                : current?.status === 'UPLOADED'
                  ? 'The segment could not be retrieved.'
                  : `Segment status: ${current?.status?.toLowerCase() ?? 'unknown'}.`}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 border-t border-gray-200">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { autoPlayRef.current = false; goTo(index - 1) }}
            disabled={index === 0}
            className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-40"
            aria-label="Previous segment"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={togglePlay}
            disabled={!url}
            className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-40"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            onClick={() => { autoPlayRef.current = false; goTo(index + 1) }}
            disabled={index >= segments.length - 1}
            className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-40"
            aria-label="Next segment"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="text-xs text-gray-600">
          Segment {index + 1} of {segments.length}
          {current?.elapsedMs !== undefined && (
            <span className="text-gray-400"> · starts at {formatElapsed(current?.elapsedMs ?? null)}</span>
          )}
        </div>
      </div>
    </div>
  )
}
