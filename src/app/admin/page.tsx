import { prisma } from '@/lib/db'
import { Building2, Users, ClipboardList, BookOpen, TrendingUp, Award } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

async function getStats() {
  const [colleges, coordinators, students, tests, questions, attempts] = await Promise.all([
    prisma.college.count({ where: { isActive: true } }),
    prisma.user.count({ where: { role: 'COLLEGE_COORDINATOR', isActive: true } }),
    prisma.studentProfile.count(),
    prisma.test.count({ where: { isActive: true } }),
    prisma.question.count({ where: { isActive: true } }),
    prisma.testAttempt.count({ where: { isSubmitted: true } }),
  ])
  return { colleges, coordinators, students, tests, questions, attempts }
}

async function getRecentTests() {
  return prisma.test.findMany({
    where: { isActive: true },
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { schedules: true, _count: { select: { schedules: true } } },
  })
}

export default async function AdminDashboard() {
  const stats = await getStats()
  const recentTests = await getRecentTests()

  const statCards = [
    { label: 'Active Colleges', value: stats.colleges, icon: Building2, color: '#3B1F8C', href: '/admin/colleges' },
    { label: 'Coordinators', value: stats.coordinators, icon: Users, color: '#007DA6', href: '/admin/coordinators' },
    { label: 'Registered Students', value: stats.students, icon: Users, color: '#00C9A7', href: '/admin/results' },
    { label: 'Tests Created', value: stats.tests, icon: ClipboardList, color: '#5A3DB5', href: '/admin/tests' },
    { label: 'Questions in Bank', value: stats.questions, icon: BookOpen, color: '#007DA6', href: '/admin/question-bank' },
    { label: 'Tests Submitted', value: stats.attempts, icon: Award, color: '#059669', href: '/admin/results' },
  ]

  const statusColor: Record<string, string> = {
    DRAFT: 'badge-yellow',
    SCHEDULED: 'badge-purple',
    ACTIVE: 'badge-teal',
    COMPLETED: 'badge-green',
    CANCELLED: 'badge-red',
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="speed-accent w-12 mb-4" />
        <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Welcome back! Here's an overview of your platform.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {statCards.map(stat => (
          <Link key={stat.label} href={stat.href}
            className="card hover:shadow-md transition-all group">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-3xl font-bold" style={{ color: stat.color }}>
                  {stat.value.toLocaleString()}
                </div>
                <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
              </div>
              <div className="p-2.5 rounded-xl" style={{ backgroundColor: stat.color + '15' }}>
                <stat.icon size={22} style={{ color: stat.color }} />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Tests */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Recent Tests</h2>
          <Link href="/admin/tests" className="text-sm text-brand-purple hover:underline">View All →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header text-left pb-3">Test Name</th>
                <th className="table-header text-left pb-3">Duration</th>
                <th className="table-header text-left pb-3">Schedules</th>
                <th className="table-header text-left pb-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentTests.map(test => (
                <tr key={test.id} className="hover:bg-gray-50">
                  <td className="py-3 text-sm font-medium text-gray-800">{test.title}</td>
                  <td className="py-3 text-sm text-gray-500">{test.durationMinutes} min</td>
                  <td className="py-3 text-sm text-gray-500">{test._count.schedules}</td>
                  <td className="py-3">
                    <span className={statusColor[test.status] || 'badge-yellow'}>{test.status}</span>
                  </td>
                </tr>
              ))}
              {recentTests.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-gray-400 text-sm">No tests created yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Add College', href: '/admin/colleges/new', color: '#3B1F8C' },
          { label: 'Create Test', href: '/admin/tests/new', color: '#007DA6' },
          { label: 'Upload Questions', href: '/admin/question-bank', color: '#00C9A7' },
          { label: 'Add Job Opening', href: '/admin/job-openings/new', color: '#5A3DB5' },
        ].map(action => (
          <Link key={action.label} href={action.href}
            className="flex items-center justify-center gap-2 p-4 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-opacity shadow-sm"
            style={{ background: action.color }}>
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
