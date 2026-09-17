import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import { Clock, CheckCircle, AlertTriangle, Calendar, Download } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function StudentTestsPage() {
  const session = await getServerSession(authOptions)
  const user = await prisma.user.findUnique({
    where: { email: session!.user!.email! },
    include: { studentProfile: true }
  })

  const collegeId = user?.studentProfile?.collegeId || ''
  const studentId = user?.studentProfile?.id || ''

  // Fetch active schedules for student's college with active tests
  const allSchedules = await prisma.testSchedule.findMany({
    where: { collegeId, isActive: true },
    include: {
      test: { include: { jobOpening: true } },
      attempts: {
        where: { studentId },
        include: { responses: { select: { flagged: true } } }
      }
    },
    orderBy: { scheduledAt: 'desc' }
  })

  // Filter out soft-deleted tests in JS
  const schedules = allSchedules.filter(s => s.test.isActive)

  const now = new Date()

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">My Tests</h1>
        <p className="text-gray-500 text-sm">All scheduled assessments</p>
      </div>

      <div className="space-y-4">
        {schedules.map(schedule => {
          const attempt = schedule.attempts[0]
          const isLive = now >= new Date(schedule.scheduledAt) && now <= new Date(schedule.endsAt)
          const isPast = now > new Date(schedule.endsAt)
          const isSubmitted = attempt?.isSubmitted
          const flaggedCount = attempt?.responses?.filter((r: any) => r.flagged).length || 0
          const config = (schedule.test.assessmentConfig as any[]) || []

          return (
            <div key={schedule.id} className={`card ${isLive && !isSubmitted ? 'border-l-4 border-green-400' : ''}`}>
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-xl flex-shrink-0 ${isSubmitted ? 'bg-green-100' : isLive ? 'bg-green-100' : 'bg-gray-100'}`}>
                  {isSubmitted
                    ? <CheckCircle size={22} className="text-green-600" />
                    : isLive
                    ? <Calendar size={22} className="text-green-600" />
                    : <Clock size={22} className="text-gray-400" />
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-gray-800">{schedule.test.title}</h3>
                      {schedule.test.jobOpening && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Position: {schedule.test.jobOpening.title}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isSubmitted ? (
                        <span className="badge-green flex items-center gap-1">
                          <CheckCircle size={11} /> Submitted
                        </span>
                      ) : isLive ? (
                        <Link href={`/student/test/${schedule.id}`}
                          className="btn-teal text-sm py-1.5 px-4">
                          Start Test
                        </Link>
                      ) : isPast ? (
                        <span className="text-xs text-gray-400">Expired</span>
                      ) : (
                        <span className="badge-yellow">Scheduled</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} /> {new Date(schedule.scheduledAt).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={12} /> {schedule.test.durationMinutes} min
                    </span>
                    <span>{schedule.test.totalMarks} marks</span>
                  </div>

                  {/* Assessment areas */}
                  {config.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {config.map((c: any) => (
                        <span key={c.area} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md">
                          {c.area}: {c.count}Q
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Result summary if submitted */}
                  {isSubmitted && attempt && (
                    <div className="mt-3 p-3 bg-brand-purple/5 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-brand-purple">
                          Score: {attempt.totalScore} / {schedule.test.totalMarks}
                        </span>
                        {flaggedCount > 0 && (
                          <span className="text-xs text-orange-600 flex items-center gap-1">
                            <AlertTriangle size={12} /> {flaggedCount} questions flagged
                          </span>
                        )}
                      </div>
                      {attempt.areaScores && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {Object.entries(attempt.areaScores as Record<string, number>).map(([area, score]) => (
                            <span key={area} className="text-xs bg-white border border-gray-200 px-2 py-0.5 rounded-md text-gray-600">
                              {area}: {score}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* PPT download */}
                  {schedule.test.companyPptUrl && (
                    <a href={schedule.test.companyPptUrl} target="_blank" rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs text-brand-purple hover:underline">
                      <Download size={12} /> Download Company Presentation
                    </a>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {schedules.length === 0 && (
          <div className="card text-center py-16 text-gray-400">
            <Clock size={40} className="mx-auto mb-3 text-gray-300" />
            <p>No tests scheduled for your college yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
