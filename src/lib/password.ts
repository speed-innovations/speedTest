import { randomInt } from 'crypto'

/**
 * Account password generation.
 *
 * Math.random() is a non-cryptographic PRNG: its internal state is recoverable
 * from a handful of outputs, so passwords minted from it are predictable across
 * a bulk import. randomInt() draws from the OS CSPRNG and is rejection-sampled,
 * so there is no modulo bias either.
 */

// Ambiguous glyphs (0/O, 1/l/I) are excluded — these get read off a screen and
// typed by hand, and a support ticket is worse than two bits of entropy.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generatePassword(length = 12): string {
  if (length < 8) throw new Error('Refusing to generate a password shorter than 8 characters')
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)]
  }
  return out
}

export const MIN_PASSWORD_LENGTH = 8

/**
 * Policy for user-chosen passwords. Returns an error message, or null if valid.
 *
 * Deliberately modest: a length floor plus a check that the password actually
 * changed. Composition rules (one digit, one symbol) push people towards
 * "Password1!" without adding real entropy.
 */
export function validateNewPassword(
  newPassword: unknown,
  currentPassword?: unknown
): string | null {
  if (typeof newPassword !== 'string' || newPassword.length === 0) {
    return 'New password is required'
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (newPassword.length > 200) {
    return 'Password must be at most 200 characters'
  }
  if (newPassword.trim().length === 0) {
    return 'Password cannot be only whitespace'
  }
  if (typeof currentPassword === 'string' && currentPassword === newPassword) {
    return 'New password must be different from the current password'
  }
  return null
}

/** Fisher-Yates shuffle backed by the CSPRNG. */
export function secureShuffle<T>(input: readonly T[]): T[] {
  const a = [...input]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
