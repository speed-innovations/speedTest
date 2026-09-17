import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

const CHANGE_PASSWORD_PATH = '/change-password'

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    // An account flagged for rotation cannot reach anything else until it has
    // set its own password. Without this the flag was written in four places
    // and read in none.
    if (token.mustResetPassword && path !== CHANGE_PASSWORD_PATH) {
      return NextResponse.redirect(new URL(`${CHANGE_PASSWORD_PATH}?required=1`, req.url))
    }

    // Once cleared, stop showing the forced-reset screen as a landing page.
    if (!token.mustResetPassword && path === CHANGE_PASSWORD_PATH && req.nextUrl.searchParams.get('required') === '1') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    const role = token.role as string

    // Role-based routing
    if (path.startsWith('/admin') && role !== 'APP_ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    if (path.startsWith('/coordinator') && role !== 'COLLEGE_COORDINATOR') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    if (path.startsWith('/student') && role !== 'STUDENT') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
)

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/coordinator/:path*',
    '/student/:path*',
    '/change-password',
  ],
}
