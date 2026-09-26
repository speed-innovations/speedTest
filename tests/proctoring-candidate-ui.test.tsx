// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import ProctoringStatusIndicator from '@/components/proctoring/ProctoringStatusIndicator'
import ProctoringIntegrityBanner from '@/components/proctoring/ProctoringIntegrityBanner'
import ProctoringWarning from '@/components/proctoring/ProctoringWarning'
import { CONSENT_COPY, DATA_NOTE, PROCTORING_RULES } from '@/components/proctoring/ProctoringSetup'
import { INTEGRITY_COPY } from '@/lib/proctoring/client/warning-copy'
import type { ProctoringHealth, UseProctoringResult } from '@/lib/proctoring/client/use-proctoring'

afterEach(() => cleanup())

const HEALTHY: ProctoringHealth = { camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE', gaze: 'RUNNING', connection: 'OK' }

function fake(p: Partial<UseProctoringResult> = {}): UseProctoringResult {
  return {
    state: 'ACTIVE',
    support: { supported: true, missing: [] },
    devices: { camera: { state: 'READY' }, microphone: { state: 'READY' }, screen: { state: 'READY' } },
    warning: null,
    health: HEALTHY,
    capture: { cameraLive: true, micLive: true, screenSharing: true },
    startError: null,
    needsRecovery: false,
    diagnostics: null,
    requestPermissionsAndStart: vi.fn(() => Promise.resolve(true)),
    resumeScreenShare: vi.fn(() => Promise.resolve(true)),
    resumeCamera: vi.fn(() => Promise.resolve(true)),
    resumeSession: vi.fn(() => Promise.resolve(true)),
    finalize: vi.fn(() => Promise.resolve()),
    videoRef: { current: null },
    ...p,
  }
}

describe('setup copy', () => {
  it('states the ticket consent verbatim', () => {
    expect(CONSENT_COPY).toBe(
      'Proctoring is enabled for this assessment. Your camera, microphone permission status, ' +
      'screen-sharing status, and exam activity may be monitored during the assessment. ' +
      'Gaze analysis runs locally in your browser.'
    )
  })

  it('tells the candidate plainly that phones are not permitted', () => {
    expect(PROCTORING_RULES.some(r => /mobile phone/i.test(r))).toBe(true)
  })

  it('says what is actually stored, and reveals no thresholds', () => {
    expect(DATA_NOTE).toMatch(/No video, audio or screenshots are stored/)
    PROCTORING_RULES.concat(CONSENT_COPY).forEach(s => {
      expect(s).not.toMatch(/\d|second|degree|threshold/i)
      expect(s).not.toMatch(/record|upload|saved/i)
    })
  })
})

describe('ProctoringStatusIndicator', () => {
  it('panel: PROCTORING ACTIVE with Camera and Screen Share active', () => {
    render(<ProctoringStatusIndicator variant="panel" state="ACTIVE" health={HEALTHY} />)
    const panel = screen.getByTestId('proctoring-panel')
    expect(panel.textContent).toMatch(/Proctoring active/i)
    expect(panel.textContent).toMatch(/Camera/)
    expect(panel.textContent).toMatch(/Screen Share/)
    expect(screen.getAllByText('Active').length).toBe(2)
  })

  it('never claims recording, saving or uploading', () => {
    render(<ProctoringStatusIndicator variant="panel" state="ACTIVE" health={HEALTHY} />)
    expect(document.body.textContent).not.toMatch(/record|saved|upload|evidence/i)
  })

  it('says attention is needed the moment screen sharing stops', () => {
    render(<ProctoringStatusIndicator variant="panel" state="SCREEN_SHARE_STOPPED" health={{ ...HEALTHY, screen: 'ENDED' }} />)
    expect(screen.getByTestId('proctoring-panel').textContent).toMatch(/attention needed/i)
    expect(screen.getByText('Stopped')).toBeTruthy()
  })

  it('chip variant for the top bar', () => {
    render(<ProctoringStatusIndicator variant="chip" state="ACTIVE" health={HEALTHY} />)
    expect(screen.getByTestId('proctoring-chip').textContent).toMatch(/Proctoring active/i)
  })

  it('renders nothing before monitoring starts', () => {
    const { container } = render(<ProctoringStatusIndicator state="IDLE" health={HEALTHY} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('ProctoringIntegrityBanner', () => {
  it('is a polite live region and shows nothing when all is well', () => {
    render(<ProctoringIntegrityBanner proctoring={fake()} />)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
  })

  it('screen sharing stopped: the ticket message and a resume button needing a click', async () => {
    const p = fake({ state: 'SCREEN_SHARE_STOPPED', health: { ...HEALTHY, screen: 'ENDED' } })
    render(<ProctoringIntegrityBanner proctoring={p} />)
    expect(screen.getByText(INTEGRITY_COPY.SCREEN_SHARE_STOPPED)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /resume screen sharing/i }))
    await waitFor(() => expect(p.resumeScreenShare).toHaveBeenCalledTimes(1))
  })

  it('camera stopped: "Your camera connection was interrupted." and a reconnect button', async () => {
    const p = fake({ state: 'CAMERA_STOPPED', health: { ...HEALTHY, camera: 'ENDED' } })
    render(<ProctoringIntegrityBanner proctoring={p} />)
    expect(screen.getByText('Your camera connection was interrupted.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))
    await waitFor(() => expect(p.resumeCamera).toHaveBeenCalledTimes(1))
  })

  it('connection lost is shown, with nothing to click', () => {
    render(<ProctoringIntegrityBanner proctoring={fake({ health: { ...HEALTHY, connection: 'LOST' } })} />)
    expect(screen.getByText(INTEGRITY_COPY.CONNECTION_LOST)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('an interrupted session offers resume; a closed one tells them to get help', () => {
    const p = fake({ state: 'SESSION_INTERRUPTED' })
    const { rerender } = render(<ProctoringIntegrityBanner proctoring={p} />)
    expect(screen.getByRole('button', { name: /resume proctoring/i })).toBeTruthy()
    rerender(<ProctoringIntegrityBanner proctoring={fake({ state: 'SESSION_INTERRUPTED', startError: { message: 'x', code: 'PROCTORING_SESSION_CLOSED' } })} />)
    expect(screen.getByText(INTEGRITY_COPY.SESSION_CLOSED)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('ProctoringWarning', () => {
  it('is non-blocking: a polite status region that does not capture clicks', () => {
    render(<ProctoringWarning warning={{ message: 'Please look at the assessment screen.', kind: 'LOOK_AT_SCREEN' }} />)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.className).toMatch(/pointer-events-none/)
  })
})
