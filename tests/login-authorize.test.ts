import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

// A database outage used to surface as "Invalid credentials": authorize()
// caught every exception and returned null, so a paused Supabase project was
// indistinguishable from a typo. These tests pin the two outcomes apart.

const db = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: db.findUnique } } }))

import { authorizeCredentials } from '@/lib/auth'
import { LOGIN_UNAVAILABLE } from '@/lib/auth-errors'

const creds = { email: 'Admin@Example.test ', password: 'Admin@123' }

async function userWith(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1', email: 'admin@example.test', name: 'Admin', role: 'APP_ADMIN',
    isActive: true, mustResetPassword: false, collegeId: null,
    password: await bcrypt.hash('Admin@123', 4),
    ...overrides,
  }
}

describe('authorizeCredentials', () => {
  beforeEach(() => {
    db.findUnique.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns the user for a correct password, normalising the email', async () => {
    db.findUnique.mockResolvedValue(await userWith())
    const user = await authorizeCredentials(creds)
    expect(user).toMatchObject({ id: 'u1', role: 'APP_ADMIN' })
    expect(db.findUnique).toHaveBeenCalledWith({ where: { email: 'admin@example.test' } })
  })

  it('returns null for missing fields, unknown user, inactive user and wrong password', async () => {
    expect(await authorizeCredentials({ email: '', password: 'x' })).toBeNull()

    db.findUnique.mockResolvedValue(null)
    expect(await authorizeCredentials(creds)).toBeNull()

    db.findUnique.mockResolvedValue(await userWith({ isActive: false }))
    expect(await authorizeCredentials(creds)).toBeNull()

    db.findUnique.mockResolvedValue(await userWith())
    expect(await authorizeCredentials({ ...creds, password: 'wrong' })).toBeNull()
  })

  it('throws LOGIN_UNAVAILABLE when the database cannot be reached', async () => {
    db.findUnique.mockRejectedValue(new Error('(ENOTFOUND) tenant/user postgres.x not found'))
    await expect(authorizeCredentials(creds)).rejects.toThrow(LOGIN_UNAVAILABLE)
    expect(console.error).toHaveBeenCalled()
  })
})
