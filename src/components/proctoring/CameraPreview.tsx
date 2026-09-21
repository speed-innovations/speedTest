'use client'
import { Video, VideoOff } from 'lucide-react'
import type { RefObject } from 'react'

/**
 * The candidate's own self-view.
 *
 * Purely a preview. Gaze inference reads from the hook's own video element, so
 * this can be mounted, unmounted and resized freely - including when the page
 * switches from the pre-check screen to the questions - without interrupting
 * detection or recording.
 *
 * Showing candidates what is being captured is not decoration: it is the only
 * way they can tell that the thing recording them is framed on their face and
 * nothing else in the room.
 */

export default function CameraPreview({
  videoRef,
  live,
  size = 'large',
}: {
  videoRef: RefObject<HTMLVideoElement>
  live: boolean
  size?: 'large' | 'small'
}) {
  const large = size === 'large'

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-gray-900 ${
        large ? 'w-full aspect-video' : 'w-40 aspect-video shadow-lg border border-white/20'
      }`}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        // Mirrored, like every video-call self-view. An un-mirrored preview
        // makes candidates move the wrong way when they try to centre themselves.
        className="w-full h-full object-cover scale-x-[-1]"
      />
      {!live && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2">
          <VideoOff size={large ? 28 : 18} />
          {large && <span className="text-xs">Camera preview will appear here</span>}
        </div>
      )}
      {live && (
        <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
          <Video size={10} /> You
        </div>
      )}
    </div>
  )
}
