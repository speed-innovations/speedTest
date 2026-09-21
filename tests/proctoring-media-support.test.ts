import { describe, it, expect, afterEach } from 'vitest'
import { checkBrowserSupport, selectRecorderMimeType } from '@/lib/proctoring/client/media-support'

/**
 * Capability detection decides whether a candidate is allowed to begin at all.
 * Getting it wrong in the permissive direction is the expensive failure: an
 * assessment that appears proctored but records nothing.
 *
 * These run in the node environment with the globals stubbed by hand, which is
 * closer to a hostile or unusual browser than jsdom would be.
 */

const g = globalThis as Record<string, unknown>

function stubRecorder(supported: string[]): void {
  g.MediaRecorder = { isTypeSupported: (t: string) => supported.indexOf(t) !== -1 }
}

function stubNavigator(opts: { getUserMedia?: boolean; getDisplayMedia?: boolean; mediaDevices?: boolean }): void {
  if (opts.mediaDevices === false) {
    g.navigator = {}
    return
  }
  const md: Record<string, unknown> = {}
  if (opts.getUserMedia !== false) md.getUserMedia = () => {}
  if (opts.getDisplayMedia !== false) md.getDisplayMedia = () => {}
  g.navigator = { mediaDevices: md }
}

afterEach(() => {
  delete g.MediaRecorder
  delete g.navigator
})

describe('selectRecorderMimeType', () => {
  it('prefers vp8/opus when everything is supported', () => {
    stubRecorder(['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'])
    expect(selectRecorderMimeType()).toBe('video/webm;codecs=vp8,opus')
  })

  it('falls back down the list rather than failing', () => {
    // Only the third candidate is supported - a browser that knows webm but
    // rejects explicit codec strings.
    stubRecorder(['video/webm'])
    expect(selectRecorderMimeType()).toBe('video/webm')
  })

  it('returns null when nothing on the list is supported', () => {
    stubRecorder([])
    expect(selectRecorderMimeType()).toBeNull()
  })

  it('returns null when MediaRecorder does not exist at all', () => {
    expect(selectRecorderMimeType()).toBeNull()
  })

  it('survives a MediaRecorder without isTypeSupported', () => {
    // Rather than throwing, which would be reported to the candidate as an
    // unsupported browser for the wrong reason.
    g.MediaRecorder = {}
    expect(selectRecorderMimeType()).toBeNull()
  })

  it('survives isTypeSupported throwing', () => {
    g.MediaRecorder = { isTypeSupported: () => { throw new Error('nope') } }
    expect(selectRecorderMimeType()).toBeNull()
  })
})

describe('checkBrowserSupport', () => {
  it('reports supported when every capability is present', () => {
    stubNavigator({})
    stubRecorder(['video/webm;codecs=vp8,opus'])
    expect(checkBrowserSupport()).toEqual({ supported: true, missing: [] })
  })

  it('reports every missing capability, not just the first', () => {
    // A browser with mediaDevices but neither method, and no MediaRecorder.
    stubNavigator({ getUserMedia: false, getDisplayMedia: false })
    const r = checkBrowserSupport()
    expect(r.supported).toBe(false)
    expect(r.missing).toContain('getUserMedia')
    expect(r.missing).toContain('getDisplayMedia')
    expect(r.missing).toContain('MediaRecorder')
    expect(r.missing).toHaveLength(3)
  })

  it('names screen capture specifically when only that is missing', () => {
    // The common real case: an iOS browser with camera but no getDisplayMedia.
    stubNavigator({ getDisplayMedia: false })
    stubRecorder(['video/webm'])
    expect(checkBrowserSupport()).toEqual({ supported: false, missing: ['getDisplayMedia'] })
  })

  it('reports a missing recording format distinctly from a missing recorder', () => {
    stubNavigator({})
    stubRecorder([])
    expect(checkBrowserSupport().missing).toEqual(['a supported WebM recording format'])
  })

  it('reports MediaDevices itself when the object is absent', () => {
    stubNavigator({ mediaDevices: false })
    stubRecorder(['video/webm'])
    expect(checkBrowserSupport().missing).toEqual(['MediaDevices'])
  })
})
