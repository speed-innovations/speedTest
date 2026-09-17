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

/** Fisher-Yates shuffle backed by the CSPRNG. */
export function secureShuffle<T>(input: readonly T[]): T[] {
  const a = [...input]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
