import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { validateNewPassword } from '@/lib/password'

/**
 * Change the signed-in user's own password. Available to every role.
 *
 * Previously the only change-password endpoint was gated to APP_ADMIN, so
 * students and coordinators had no way to rotate the password that was emailed
 * to them in plaintext, and the `mustResetPassword` flag had nothing to satisfy.
 *
 * The account is always resolved from the session, never from the request, so
 * this cannot be used to change anyone else's password.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { currentPassword, newPassword } = body

    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
      return NextResponse.json({ error: 'Current password is required' }, { status: 400 })
    }

    const policyError = validateNewPassword(newPassword, currentPassword)
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (!user.isActive) {
      return NextResponse.json({ error: 'Account is inactive' }, { status: 403 })
    }

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    const hashed = await bcrypt.hash(newPassword as string, 12)
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, mustResetPassword: false },
    })

    // The JWT still carries the old mustResetPassword claim, and a password
    // change should not leave the previous session usable. The client signs out
    // on success and signs back in with the new password.
    return NextResponse.json({ success: true, reauthRequired: true })
  } catch (err) {
    console.error('Change password error:', err)
    return NextResponse.json({ error: 'Could not change password' }, { status: 500 })
  }
}
