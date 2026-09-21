import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, resetRateLimitsForTests } from '@/lib/proctoring/rate-limit'

describe('rateLimit', () => {
  beforeEach(() => resetRateLimitsForTests())

  it('allows up to the limit then refuses', () => {
    for (let i = 0; i < 5; i++) expect(rateLimit('k', 5, 1000, 0)).toBe(true)
    expect(rateLimit('k', 5, 1000, 0)).toBe(false)
  })

  it('opens a fresh window once the old one expires', () => {
    for (let i = 0; i < 5; i++) rateLimit('k', 5, 1000, 0)
    expect(rateLimit('k', 5, 1000, 999)).toBe(false)
    expect(rateLimit('k', 5, 1000, 1000)).toBe(true)
  })

  it('keys are independent', () => {
    for (let i = 0; i < 5; i++) rateLimit('a', 5, 1000, 0)
    expect(rateLimit('a', 5, 1000, 0)).toBe(false)
    expect(rateLimit('b', 5, 1000, 0)).toBe(true)
  })
})
