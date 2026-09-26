// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ProctoringDiagnostics from '@/components/proctoring/ProctoringDiagnostics'
import type { DiagnosticsSnapshot } from '@/lib/proctoring/client/diagnostics'

afterEach(() => cleanup())

const HEALTH = { camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ENDED', gaze: 'RUNNING', connection: 'OK' } as const

const SNAP: DiagnosticsSnapshot = {
  faceCount: 1, yaw: -21.46, pitch: -18.02, roll: 2.4, irisX: -0.19, irisY: 0.2, quality: 1, faceWidth: 0.21,
  baseline: { yaw: 3, pitch: -2, irisX: 0.01, irisY: 0.02 },
  deviation: { yaw: -24.46, pitch: -16.02, irisX: -0.2, irisY: 0.18 },
  direction: 'LEFT + DOWN', confidence: 0.9, agreement: 'HEAD_AND_EYES',
  phase: 'MONITORING', temporalState: 'WARNING', condition: 'LOOKING_DOWN',
}

describe('ProctoringDiagnostics', () => {
  it('renders nothing unless diagnostics are enabled (the production case)', () => {
    const { container } = render(<ProctoringDiagnostics snapshot={SNAP} state="ACTIVE" health={HEALTH} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows every field the spec lists when enabled in development', () => {
    render(<ProctoringDiagnostics enabled snapshot={SNAP} state="ACTIVE" health={HEALTH} />)
    const text = screen.getByTestId('proctoring-diagnostics').textContent ?? ''
    const labels = [
      'Face count', 'Yaw', 'Pitch', 'Roll', 'Iris X', 'Iris Y', 'Baseline', 'Deviation',
      'Direction', 'Confidence', 'Temporal state', 'Proctoring state', 'Camera', 'Screen share',
    ]
    labels.forEach(l => expect(text).toContain(l))
    expect(text).toContain('LEFT + DOWN')
    expect(text).toContain('-21.5')
    expect(text).toContain('ENDED')
  })

  it('renders null readings as a dash, never as 0', () => {
    render(<ProctoringDiagnostics enabled snapshot={{ ...SNAP, irisX: null, irisY: null }} state="ACTIVE" health={HEALTH} />)
    expect(screen.getByTestId('diag-iris-x').textContent).toBe('—')
  })
})
