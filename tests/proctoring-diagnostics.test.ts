import { describe, it, expect } from 'vitest'
import { DIAGNOSTICS_ENABLED, directionLabel } from '@/lib/proctoring/client/diagnostics'
import type { FusedObservation } from '@/lib/proctoring/client/gaze-classify'

const o = (p: Partial<FusedObservation>): FusedObservation => ({
  direction: 'CENTER', horizontal: null, vertical: null, confidence: 1, agreement: 'NONE',
  deviation: { yaw: null, pitch: null, irisX: null, irisY: null }, ...p,
})

describe('diagnostics', () => {
  it('is off outside development', () => {
    expect(DIAGNOSTICS_ENABLED).toBe(false)
  })

  it('labels diagonals with both axes, and uncertainty as UNKNOWN', () => {
    expect(directionLabel(o({ direction: 'DOWN', horizontal: 'LEFT', vertical: 'DOWN' }))).toBe('LEFT + DOWN')
    expect(directionLabel(o({ direction: 'DOWN', horizontal: 'RIGHT', vertical: 'DOWN' }))).toBe('RIGHT + DOWN')
    expect(directionLabel(o({ direction: 'LEFT', horizontal: 'LEFT' }))).toBe('LEFT')
    expect(directionLabel(o({ direction: 'UNCERTAIN' }))).toBe('UNKNOWN')
  })
})
