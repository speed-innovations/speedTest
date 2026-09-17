import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import StudentSidebar from '@/components/student/StudentSidebar'

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'STUDENT') redirect('/login')

  return (
    <div className="flex h-screen overflow-hidden">
      <StudentSidebar user={session.user as any} />
      <main className="flex-1 overflow-y-auto bg-gray-50">{children}</main>
    </div>
  )
}
