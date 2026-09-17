import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = (session.user as any).role
  if (role === 'APP_ADMIN') redirect('/admin')
  if (role === 'COLLEGE_COORDINATOR') redirect('/coordinator')
  if (role === 'STUDENT') redirect('/student')

  redirect('/login')
}
