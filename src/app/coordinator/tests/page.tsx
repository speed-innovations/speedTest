import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
import { Clock, Users, Calendar } from 'lucide-react'
import Link from 'next/link'

export default async function CoordinatorTestsPage() {
  const session = await getServerSession(authOptions)
  const coordinator = await prisma.user.findUnique({ where: { email: session!.user!.email! } })

  const schedules = await prisma.testSchedule.findMany({
    where: { collegeId: coordinator?.collegeId || '', isActive: true, test: { isActive: true } },
    include: {
      test: { include: { jobOpening: true } },
      _count: { select: { attempts: true } }
    },
    orderBy: { scheduledAt: 'asc' }
  })

  const now = new Date()

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">Test Schedules</h1>
        <p className="text-gray-500 text-sm">Upcoming and past tests for your college</p>
      </div>

      <div className="space-y-4">
        {schedules.map(s => {
          const isLive = now >= new Date(s.scheduledAt) && now <= new Date(s.endsAt)
          const isPast = now > new Date(s.endsAt)
          const isFuture = now < new Date(s.scheduledAt)

          return (
            <div key={s.id} className={`card ${isLive ? 'border-l-4 border-green-400' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800">{s.test.title}</h3>
                    {isLive && <span className="badge-green animate-pulse">● LIVE</span>}
                    {isFuture && <span className="badge-yellow">Upcoming</span>}
                    {isPast && <span className="text-xs text-gray-400">Completed</span>}
                  </div>
                  {s.test.jobOpening && (
                    <p className="text-xs text-gray-500 mt-0.5">Position: {s.test.jobOpening.title}</p>
                  )}
                  <div className="flex items-center gap-5 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(s.scheduledAt).toLocaleString()}</span>
                    <span className="flex items-center gap-1"><Clock size={12} /> {s.test.durationMinutes} min</span>
                    <span className="flex items-center gap-1"><Users size={12} /> {s._count.attempts} attempted</span>
                  </div>
                </div>

                <div>
                  {s.test.companyPptUrl && (
                    <a href={s.test.companyPptUrl} target="_blank" rel="noopener noreferrer"
                      className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
                      📥 Company PPT
                    </a>
                  )}
                </div>
              </div>

              {s.instructions && (
                <div className="mt-3 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
                  📋 {s.instructions}
                </div>
              )}
            </div>
          )
        })}
        {schedules.length === 0 && (
          <div className="card text-center py-16 text-gray-400">
            <Calendar size={40} className="mx-auto mb-3 text-gray-300" />
            <p>No test schedules yet</p>
            <p className="text-xs mt-1">Contact your administrator to schedule tests</p>
          </div>
        )}
      </div>
    </div>
  )
}
