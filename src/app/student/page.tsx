import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import { ClipboardList, User, Download, Clock, Zap } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function StudentDashboard() {
  const session = await getServerSession(authOptions)
  const userEmail = session?.user?.email!

  const user = await prisma.user.findUnique({
    where: { email: userEmail },
    include: {
      studentProfile: {
        include: { college: true }
      }
    }
  })

  const profile = user?.studentProfile

  const schedules = profile ? await prisma.testSchedule.findMany({
    where: {
      collegeId: profile.collegeId,
      isActive: true,
      test: { isActive: true },
    },
    include: {
      test: { include: { jobOpening: true } },
      attempts: { where: { studentId: profile.id } }
    },
    orderBy: { scheduledAt: 'asc' }
  }) : []

  // Fetch walk-in tests where this student is explicitly enabled
  const eligibleRecords = profile ? await prisma.walkInEligibleStudent.findMany({
    where: { studentId: profile.id, isEnabled: true },
    include: { test: { include: { jobOpening: true } } }
  }) : []

  const walkInTests = eligibleRecords
    .filter(e => e.test.isWalkIn && e.test.isActive && e.test.status === 'ACTIVE')
    .map(e => e.test)

  // Get walk-in attempts for this student
  const walkInAttempts = profile && walkInTests.length > 0 ? await prisma.walkInAttempt.findMany({
    where: { studentId: profile.id, testId: { in: walkInTests.map(t => t.id) } }
  }) : []

  const walkInAttemptMap = new Map(walkInAttempts.map(a => [a.testId, a]))

  const now = new Date()

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">Welcome, {profile?.fullName || user?.name}!</h1>
        <p className="text-gray-500 text-sm">{profile?.college?.name}</p>
      </div>

      {/* Profile Completeness */}
      {profile && (
        <div className="card mb-6 border-l-4 border-brand-purple">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-800">Your Profile</h3>
              <p className="text-sm text-gray-500 mt-0.5">Keep your information up to date</p>
            </div>
            <Link href="/student/profile" className="btn-primary text-sm py-2">
              <User size={14} /> View Profile
            </Link>
          </div>
        </div>
      )}

      {/* Walk-in Tests */}
      {walkInTests.length > 0 && (
        <div className="card mb-6">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Zap size={18} className="text-orange-500" /> Walk-in Tests (Lab)
          </h2>
          <div className="space-y-4">
            {walkInTests.map(test => {
              const attempt = walkInAttemptMap.get(test.id)
              const isSubmitted = attempt?.isSubmitted

              return (
                <div key={test.id} className={`p-4 rounded-xl border ${isSubmitted ? 'border-gray-100' : 'border-orange-200 bg-orange-50'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-800">{test.title}</h3>
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Zap size={10} /> Walk-in
                        </span>
                      </div>
                      {test.jobOpening && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Position: {test.jobOpening.title}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock size={12} /> {test.durationMinutes} min
                        </span>
                        <span>{test.totalMarks} marks</span>
                      </div>

                      {test.companyPptUrl && (
                        <a href={test.companyPptUrl} target="_blank" rel="noopener noreferrer"
                          className="mt-2 text-xs text-brand-purple hover:underline flex items-center gap-1 w-fit">
                          <Download size={12} /> Download Company Presentation
                        </a>
                      )}

                      {test.jobOpening && (
                        <div className="mt-2">
                          <div className="text-xs text-gray-500 mb-1">Required Skills:</div>
                          <div className="flex flex-wrap gap-1">
                            {test.jobOpening.requiredSkills.map((s: string) => (
                              <span key={s} className="badge-purple text-xs">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {isSubmitted ? (
                        <span className="badge-green">Submitted &#x2713;</span>
                      ) : (
                        <Link href={`/student/walkin-test/${test.id}`}
                          className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                          Start Test
                        </Link>
                      )}
                    </div>
                  </div>

                  {isSubmitted && attempt?.totalScore != null && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <span className="text-sm font-medium text-brand-purple">
                        Score: {attempt.totalScore} / {test.totalMarks}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Scheduled Tests */}
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <ClipboardList size={18} className="text-brand-purple" /> Test Schedule
        </h2>
        <div className="space-y-4">
          {schedules.map(schedule => {
            const attempt = schedule.attempts[0]
            const isLive = now >= new Date(schedule.scheduledAt) && now <= new Date(schedule.endsAt)
            const isFuture = now < new Date(schedule.scheduledAt)
            const isSubmitted = attempt?.isSubmitted

            return (
              <div key={schedule.id} className={`p-4 rounded-xl border ${isLive ? 'border-green-300 bg-green-50' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-800">{schedule.test.title}</h3>
                    {schedule.test.jobOpening && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Position: {schedule.test.jobOpening.title}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {new Date(schedule.scheduledAt).toLocaleString()}
                      </span>
                      <span>{schedule.test.durationMinutes} min</span>
                      <span>{schedule.test.totalMarks} marks</span>
                    </div>

                    {schedule.test.companyPptUrl && (
                      <a href={schedule.test.companyPptUrl} target="_blank" rel="noopener noreferrer"
                        className="mt-2 text-xs text-brand-purple hover:underline flex items-center gap-1 w-fit">
                        <Download size={12} /> Download Company Presentation
                      </a>
                    )}

                    {schedule.test.jobOpening && (
                      <div className="mt-2">
                        <div className="text-xs text-gray-500 mb-1">Required Skills:</div>
                        <div className="flex flex-wrap gap-1">
                          {schedule.test.jobOpening.requiredSkills.map((s: string) => (
                            <span key={s} className="badge-purple text-xs">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {isSubmitted ? (
                      <span className="badge-green">Submitted &#x2713;</span>
                    ) : isLive ? (
                      <Link href={`/student/test/${schedule.id}`}
                        className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                        Start Test
                      </Link>
                    ) : isFuture ? (
                      <span className="badge-yellow">Scheduled</span>
                    ) : (
                      <span className="badge-red">Expired</span>
                    )}
                  </div>
                </div>

                {isSubmitted && attempt.totalScore != null && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <span className="text-sm font-medium text-brand-purple">
                      Score: {attempt.totalScore} / {schedule.test.totalMarks}
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {schedules.length === 0 && walkInTests.length === 0 && (
            <div className="text-center py-10 text-gray-400">
              <ClipboardList size={36} className="mx-auto mb-2 text-gray-300" />
              <p>No tests scheduled yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
