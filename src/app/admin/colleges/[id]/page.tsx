import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Building2, Users, Mail, Phone, MapPin, Pencil } from 'lucide-react'
import StudentTable from '@/components/admin/StudentTable'

export default async function CollegeDetailPage(ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const college = await prisma.college.findUnique({
    where: { id: params.id },
    include: {
      coordinators: { where: { isActive: true }, select: { id: true, name: true, email: true } },
      students: {
        select: { id: true, userId: true, fullName: true, email: true, status: true, graduationDegree: true },
        orderBy: { fullName: 'asc' }
      },
      testSchedules: {
        where: { isActive: true },
        include: { test: true, _count: { select: { attempts: true } } },
        orderBy: { scheduledAt: 'desc' },
        take: 10
      }
    }
  })

  if (!college) return notFound()

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <Link href="/admin/colleges" className="text-sm text-gray-500 hover:text-brand-purple flex items-center gap-1 mb-4">
          <ArrowLeft size={15} /> Back to Colleges
        </Link>
        <div className="speed-accent w-10 mb-3" />
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{college.name}</h1>
            {(college.city || college.state) && (
              <p className="text-gray-500 text-sm mt-1 flex items-center gap-1">
                <MapPin size={13} /> {[college.city, college.state].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={college.isActive ? 'badge-green' : 'badge-red'}>
              {college.isActive ? 'Active' : 'Inactive'}
            </span>
            <Link href={`/admin/colleges/${college.id}/edit`} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1">
              <Pencil size={13} /> Edit
            </Link>
          </div>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <div className="text-3xl font-bold text-brand-purple">{college.students.length}</div>
          <div className="text-sm text-gray-500 mt-1">Students</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-brand-teal-dark">{college.coordinators.length}</div>
          <div className="text-sm text-gray-500 mt-1">Coordinators</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold" style={{ color: '#007DA6' }}>{college.testSchedules.length}</div>
          <div className="text-sm text-gray-500 mt-1">Test Schedules</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Contact Info */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Building2 size={17} className="text-brand-purple" /> College Details
          </h2>
          <div className="space-y-3">
            {college.address && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <span className="text-gray-600">{college.address}</span>
              </div>
            )}
            {college.contactEmail && (
              <div className="flex items-center gap-2 text-sm">
                <Mail size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-gray-600">{college.contactEmail}</span>
              </div>
            )}
            {college.contactPhone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-gray-600">{college.contactPhone}</span>
              </div>
            )}
            {!college.address && !college.contactEmail && !college.contactPhone && (
              <p className="text-sm text-gray-400">No contact details added</p>
            )}
          </div>
        </div>

        {/* Coordinators */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Users size={17} className="text-brand-purple" /> Coordinators
          </h2>
          {college.coordinators.length > 0 ? (
            <div className="space-y-2">
              {college.coordinators.map(c => (
                <div key={c.id} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-brand-purple/10 flex items-center justify-center text-brand-purple text-xs font-bold">
                    {c.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-800">{c.name}</div>
                    <div className="text-xs text-gray-500">{c.email}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No coordinators assigned</p>
          )}
        </div>
      </div>

      {/* Students */}
      <div className="card mb-6">
        <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Users size={17} className="text-brand-purple" /> Students ({college.students.length})
        </h2>
        {college.students.length > 0 ? (
          <StudentTable students={college.students} />
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">No students registered yet</p>
        )}
      </div>

      {/* Recent Schedules */}
      <div className="card">
        <h2 className="font-semibold text-gray-700 mb-4">Recent Test Schedules</h2>
        {college.testSchedules.length > 0 ? (
          <div className="space-y-2">
            {college.testSchedules.map(s => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-gray-800">{s.test.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {new Date(s.scheduledAt).toLocaleString()} &ndash; {new Date(s.endsAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Users size={13} /> {s._count.attempts} attempts
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">No test schedules yet</p>
        )}
      </div>
    </div>
  )
}
