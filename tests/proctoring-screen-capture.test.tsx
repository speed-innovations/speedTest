// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ScreenCapture } from '@/lib/proctoring/client/screen-capture'

/**
 * Screen capture in jsdom, with toBlob stubbed to return blobs of controlled
 * sizes. What is being pinned down is the re-encode ladder: it must lower
 * quality before dimensions, must fall back to JPEG when WebP is unavailable,
 * and must terminate rather than uploading something oversized.
 *
 * jsdom has no real canvas, so drawImage and getContext are stubbed too.
 */

type ToBlobStub = (cb: (b: Blob | null) => void, type?: string, quality?: number) => void

interface Call { type: string; quality: number; width: number; height: number }

let calls: Call[] = []
let canvasEl: HTMLCanvasElement | null = null

function stubCanvas(respond: (c: Call) => Blob | null): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement['getContext']

  const toBlob: ToBlobStub = function (this: HTMLCanvasElement, cb, type, quality) {
    const call: Call = {
      type: type ?? '',
      quality: quality ?? 0,
      width: this.width,
      height: this.height,
    }
    calls.push(call)
    canvasEl = this
    cb(respond(call))
  }
  HTMLCanvasElement.prototype.toBlob = toBlob as HTMLCanvasElement['toBlob']
}

/** A video element that reports a fixed natural size immediately. */
function stubVideo(width = 1920, height = 1080): void {
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => height })
  HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve())
}

function fakeStream(): MediaStream {
  return { getVideoTracks: () => [{ addEventListener: vi.fn() }] } as unknown as MediaStream
}

const blobOf = (size: number, type: string) => ({ size, type }) as Blob

beforeEach(() => {
  calls = []
  canvasEl = null
  stubVideo()
})

afterEach(() => { vi.restoreAllMocks() })

describe('ScreenCapture encoding ladder', () => {
  it('takes a WebP at the top quality when it fits the budget', async () => {
    stubCanvas(() => blobOf(50_000, 'image/webp'))
    const snaps: Array<{ contentType: string; width: number }> = []
    const cap = new ScreenCapture({
      stream: fakeStream(), maxBytes: 250_000,
      onSnapshot: s => snaps.push({ contentType: s.contentType, width: s.width }),
    })
    // start() creates the video element and takes the immediate first
    // snapshot that quota.ts's estimate accounts for.
    await cap.start(60_000)
    expect(calls).toHaveLength(1)
    expect(calls[0].type).toBe('image/webp')
    expect(calls[0].quality).toBe(0.65)
    // 1920 natural, capped to the 1280 maximum, aspect ratio preserved.
    expect(calls[0].width).toBe(1280)
    expect(calls[0].height).toBe(720)
    expect(snaps).toEqual([{ contentType: 'image/webp', width: 1280 }])
    cap.stop()
  })

  it('lowers quality before it lowers dimensions', async () => {
    // Only the third quality step fits; the width must not have changed yet.
    stubCanvas(c => blobOf(c.quality <= 0.35 ? 100_000 : 900_000, 'image/webp'))
    const snaps: Array<{ width: number }> = []
    const cap = new ScreenCapture({
      stream: fakeStream(), maxBytes: 250_000,
      onSnapshot: s => snaps.push({ width: s.width }),
    })
    await cap.start(60_000)
    expect(calls.map(c => c.quality)).toEqual([0.65, 0.5, 0.35])
    expect(calls.every(c => c.width === 1280)).toBe(true)
    expect(snaps[0].width).toBe(1280)
    cap.stop()
  })

  it('reduces dimensions only after every quality step has failed', async () => {
    // Nothing fits at full width; the 0.75 scale at top quality does.
    stubCanvas(c => blobOf(c.width === 1280 ? 900_000 : 100_000, 'image/webp'))
    const snaps: Array<{ width: number }> = []
    const cap = new ScreenCapture({
      stream: fakeStream(), maxBytes: 250_000,
      onSnapshot: s => snaps.push({ width: s.width }),
    })
    await cap.start(60_000)
    const widths = calls.map(c => c.width)
    // Three full-width attempts first, then the smaller one.
    expect(widths.slice(0, 3)).toEqual([1280, 1280, 1280])
    expect(widths[3]).toBe(960)
    expect(snaps[0].width).toBe(960)
    cap.stop()
  })

  it('falls back to JPEG when the browser cannot encode WebP', async () => {
    // toBlob yields null for an unsupported format - historically Safari.
    stubCanvas(c => (c.type === 'image/webp' ? null : blobOf(80_000, 'image/jpeg')))
    const snaps: Array<{ contentType: string }> = []
    const cap = new ScreenCapture({
      stream: fakeStream(), maxBytes: 250_000,
      onSnapshot: s => snaps.push({ contentType: s.contentType }),
    })
    await cap.start(60_000)
    expect(calls[0].type).toBe('image/webp')
    expect(calls[1].type).toBe('image/jpeg')
    expect(snaps).toEqual([{ contentType: 'image/jpeg' }])
    cap.stop()
  })

  it('gives up and reports rather than emitting an oversized snapshot', async () => {
    stubCanvas(() => blobOf(5_000_000, 'image/webp'))
    const snaps: unknown[] = []
    const errors: unknown[] = []
    const cap = new ScreenCapture({
      stream: fakeStream(), maxBytes: 250_000,
      onSnapshot: s => snaps.push(s),
      onError: e => errors.push(e),
    })
    await cap.start(60_000)
    // The ladder terminates: 3 scales x 3 qualities, then stops.
    expect(calls).toHaveLength(9)
    expect(snaps).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toMatch(/size budget/)
    cap.stop()
  })

  it('does nothing when the video has no frame yet', async () => {
    stubVideo(0, 0)
    stubCanvas(() => blobOf(1000, 'image/webp'))
    const snaps: unknown[] = []
    // A clock that leaps forward, so waitForDimensions gives up on its first
    // poll instead of holding the test for the full 5s timeout.
    let t = 0
    const cap = new ScreenCapture({
      stream: fakeStream(), maxBytes: 250_000, onSnapshot: s => snaps.push(s),
      now: () => (t += 10_000),
    })
    // Drawing a 0x0 video yields a blank image that looks like a working
    // capture right up until a reviewer opens it.
    await cap.start(60_000)
    expect(calls).toHaveLength(0)
    expect(snaps).toHaveLength(0)
    cap.stop()
  })

  it('numbers snapshots from 1 and increments', async () => {
    stubCanvas(() => blobOf(1000, 'image/webp'))
    const seqs: number[] = []
    const cap = new ScreenCapture({
      stream: fakeStream(), maxBytes: 250_000, onSnapshot: s => seqs.push(s.sequence),
    })
    await cap.start(60_000)   // takes the first
    await cap.capture()
    await cap.capture()
    expect(seqs).toEqual([1, 2, 3])
    expect(cap.snapshotCount).toBe(3)
    cap.stop()
  })

  it('reports the candidate stopping the share rather than re-acquiring', async () => {
    stubCanvas(() => blobOf(1000, 'image/webp'))
    let endedHandler: (() => void) | null = null
    const stream = {
      getVideoTracks: () => [{
        addEventListener: (name: string, fn: () => void) => { if (name === 'ended') endedHandler = fn },
      }],
    } as unknown as MediaStream

    let ended = false
    const cap = new ScreenCapture({
      stream, maxBytes: 250_000, onSnapshot: () => {}, onEnded: () => { ended = true },
    })
    await cap.start(60_000)
    expect(endedHandler).not.toBeNull()
    endedHandler!()
    expect(ended).toBe(true)
    cap.stop()
  })
})
