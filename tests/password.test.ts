import { describe, it, expect } from 'vitest'
import {
  generatePassword,
  secureShuffle,
  validateNewPassword,
  MIN_PASSWORD_LENGTH,
} from '@/lib/password'

describe('validateNewPassword', () => {
  it('accepts a password at the minimum length', () => {
    expect(validateNewPassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull()
  })

  it('rejects anything shorter than the minimum', () => {
    expect(validateNewPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least/)
  })

  it('rejects a missing, empty or non-string password', () => {
    expect(validateNewPassword(undefined)).toBeTruthy()
    expect(validateNewPassword('')).toBeTruthy()
    expect(validateNewPassword(12345678 as any)).toBeTruthy()
    expect(validateNewPassword(null)).toBeTruthy()
  })

  it('rejects whitespace-only passwords that clear the length check', () => {
    expect(validateNewPassword('          ')).toMatch(/whitespace/)
  })

  it('rejects reusing the current password', () => {
    const same = 'correct-horse'
    expect(validateNewPassword(same, same)).toMatch(/different/)
  })

  it('allows a new password when the current one differs', () => {
    expect(validateNewPassword('correct-horse', 'battery-staple')).toBeNull()
  })

  it('rejects absurdly long input rather than handing it to bcrypt', () => {
    expect(validateNewPassword('a'.repeat(5000))).toMatch(/at most/)
  })
})

describe('generatePassword', () => {
  it('produces the requested length', () => {
    expect(generatePassword(16)).toHaveLength(16)
  })

  it('refuses to mint a password below the safe floor', () => {
    expect(() => generatePassword(4)).toThrow()
  })

  it('omits glyphs that are ambiguous when read off a screen', () => {
    const sample = Array.from({ length: 200 }, () => generatePassword(16)).join('')
    for (const ambiguous of ['0', 'O', '1', 'l', 'I']) {
      expect(sample).not.toContain(ambiguous)
    }
  })

  it('does not repeat across calls', () => {
    const set = new Set(Array.from({ length: 500 }, () => generatePassword(12)))
    expect(set.size).toBe(500)
  })

  it('satisfies its own validation policy', () => {
    expect(validateNewPassword(generatePassword())).toBeNull()
  })
})

describe('secureShuffle', () => {
  it('preserves every element', () => {
    const input = Array.from({ length: 50 }, (_, i) => i)
    const out = secureShuffle(input)
    expect(out).toHaveLength(input.length)
    expect([...out].sort((a, b) => a - b)).toEqual(input)
  })

  it('does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5]
    const copy = [...input]
    secureShuffle(input)
    expect(input).toEqual(copy)
  })

  it('actually reorders — a fixed question order would leak the paper', () => {
    const input = Array.from({ length: 100 }, (_, i) => i)
    const orderings = new Set(
      Array.from({ length: 20 }, () => secureShuffle(input).join(','))
    )
    expect(orderings.size).toBeGreaterThan(1)
  })

  it('handles empty and single-element input', () => {
    expect(secureShuffle([])).toEqual([])
    expect(secureShuffle(['x'])).toEqual(['x'])
  })
})
