// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { checkBrowserSupport } from '@/lib/proctoring/client/media-support'

function install(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value })
}

afterEach(() => install(undefined))

describe('checkBrowserSupport', () => {
  it('is supported with camera and screen capture, and needs no recorder', () => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder
    install({ getUserMedia: () => undefined, getDisplayMedia: () => undefined })
    expect(checkBrowserSupport()).toEqual({ supported: true, missing: [] })
  })

  it('names screen capture specifically when only that is missing', () => {
    install({ getUserMedia: () => undefined })
    expect(checkBrowserSupport()).toEqual({ supported: false, missing: ['getDisplayMedia'] })
  })

  it('reports every missing capability', () => {
    install({})
    expect(checkBrowserSupport().missing).toEqual(['getUserMedia', 'getDisplayMedia'])
  })

  it('reports MediaDevices itself when absent', () => {
    install(undefined)
    expect(checkBrowserSupport().missing).toEqual(['MediaDevices'])
  })
})
