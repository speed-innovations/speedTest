import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'

export const authOptions: NextAuthOptions = {
  // Use NEXTAUTH_SECRET if set; fallback to a derived secret based on DB URL (must be set in prod)
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 24 * 60 * 60 }, // 24h
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null

          const user = await prisma.user.findUnique({
            where: { email: credentials.email.toLowerCase().trim() },
          })

          if (!user) {
            console.log('Login failed: user not found', credentials.email)
            return null
          }
          if (!user.isActive) {
            console.log('Login failed: user inactive', credentials.email)
            return null
          }

          const isValid = await bcrypt.compare(credentials.password, user.password)
          if (!isValid) {
            console.log('Login failed: bad password', credentials.email)
            return null
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            mustResetPassword: user.mustResetPassword,
            collegeId: user.collegeId,
          } as any
        } catch (err) {
          console.error('Login error:', err)
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role
        token.mustResetPassword = (user as any).mustResetPassword
        token.collegeId = (user as any).collegeId
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub
        ;(session.user as any).role = token.role
        ;(session.user as any).mustResetPassword = token.mustResetPassword
        ;(session.user as any).collegeId = token.collegeId
      }
      return session
    },
  },
}
