import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url))
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
  ],
}
