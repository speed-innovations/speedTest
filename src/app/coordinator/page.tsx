import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { Users, ClipboardList, Upload, TrendingUp } from 'lucide-react'

export default async function CoordinatorDashboard() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const collegeId = user?.collegeId

  const college = collegeId ? await prisma.college.findUnique({ where: { id: collegeId } }) : null

  const [studentCount, scheduleCount, submittedCount] = await Promise.all([
    prisma.studentProfile.count({ where: { collegeId: collegeId || '' } }),
    prisma.testSchedule.count({ where: { collegeId: collegeId || '', isActive: true } }),
    prisma.testAttempt.count({ where: { student: { collegeId: collegeId || '' }, isSubmitted: true } }),
  ])

  const upcomingSchedules = await prisma.testSchedule.findMany({
    where: { collegeId: collegeId || '', isActive: true, scheduledAt: { gte: new Date() } },
    include: { test: true },
    orderBy: { scheduledAt: 'asc' },
    take: 3,
  })

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">
          {college ? college.name : 'College Dashboard'}
        </h1>
        <p className="text-gray-500 text-sm mt-1">Welcome back, {user?.name}</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Registered Students', value: studentCount, icon: Users, color: '#007DA6', href: '/coordinator/candidates' },
          { label: 'Test Schedules', value: scheduleCount, icon: ClipboardList, color: '#3B1F8C', href: '/coordinator/tests' },
          { label: 'Submitted Tests', value: submittedCount, icon: TrendingUp, color: '#00C9A7', href: '/coordinator/tests' },
        ].map(stat => (
          <Link key={stat.label} href={stat.href} className="card hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-3xl font-bold" style={{ color: stat.color }}>{stat.value}</div>
                <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
              </div>
              <div className="p-2.5 rounded-xl" style={{ backgroundColor: stat.color + '15' }}>
                <stat.icon size={22} style={{ color: stat.color }} />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {upcomingSchedules.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4">Upcoming Test Schedules</h2>
          <div className="space-y-3">
            {upcomingSchedules.map(s => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-800">{s.test.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    📅 {new Date(s.scheduledAt).toLocaleString()} · {s.test.durationMinutes} min
                  </p>
                </div>
                <span className="badge-purple">Upcoming</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4">
        <Link href="/coordinator/upload" className="card hover:shadow-md transition-all flex items-center gap-4 cursor-pointer">
          <div className="p-3 bg-brand-purple/10 rounded-xl">
            <Upload size={24} className="text-brand-purple" />
          </div>
          <div>
            <div className="font-semibold text-gray-800">Upload Candidates</div>
            <div className="text-xs text-gray-500">Import student list via Excel</div>
          </div>
        </Link>
        <Link href="/coordinator/candidates" className="card hover:shadow-md transition-all flex items-center gap-4 cursor-pointer">
          <div className="p-3 bg-brand-teal/10 rounded-xl">
            <Users size={24} className="text-brand-teal-dark" />
          </div>
          <div>
            <div className="font-semibold text-gray-800">Manage Candidates</div>
            <div className="text-xs text-gray-500">View and reset student credentials</div>
          </div>
        </Link>
      </div>
    </div>
  )
}
