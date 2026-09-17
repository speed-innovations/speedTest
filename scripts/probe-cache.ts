/**
 * Decides whether the Worker's stale reads come from Hyperdrive query caching.
 *
 * Creates an attempt through the load route, then calls /start twice: once
 * immediately, and once after the Hyperdrive cache max-age has elapsed. If the
 * second call succeeds while the first fails, the read was served from cache.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const BASE = (process.argv[process.argv.indexOf('--url') + 1] ?? '').replace(/\/$/, '')
const WAIT_SECONDS = Number(process.argv[process.argv.indexOf('--wait') + 1] || 75)
const PASSWORD = 'LoadTest@12345'

const jar = new Map<string, string>()
function cookies() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }

async function req(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init, redirect: 'manual',
    headers: { cookie: cookies(), ...(init.headers ?? {}) },
  })
  for (const line of (res.headers as any).getSetCookie?.() ?? []) {
    const [pair] = (line as string).split(';')
    const i = pair.indexOf('=')
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = text.slice(0, 120) }
  return { status: res.status, body }
}

async function main() {
  const email = `probe-${Date.now()}@loadtest.invalid`
  const college = await prisma.college.upsert({
    where: { id: 'loadtest-college' }, update: {},
    create: { id: 'loadtest-college', name: 'LOADTEST College' },
  })
  const test = await prisma.test.upsert({
    where: { id: 'loadtest-test' }, update: {},
    create: {
      id: 'loadtest-test', title: 'LOADTEST Exam', durationMinutes: 60, status: 'ACTIVE',
      assessmentConfig: [{ area: 'APTITUDE', count: 5, marks: 1 }],
    },
  })
  const schedule = await prisma.testSchedule.create({
    data: {
      testId: test.id, collegeId: college.id,
      scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3 * 3600_000),
    },
  })
  const user = await prisma.user.create({
    data: {
      email, name: 'probe', password: await bcrypt.hash(PASSWORD, 12),
      role: 'STUDENT', collegeId: college.id, mustResetPassword: false,
    },
  })
  await prisma.studentProfile.create({
    data: { userId: user.id, collegeId: college.id, fullName: 'probe', email },
  })

  const csrf = await req('/api/auth/csrf')
  await req('/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken: csrf.body.csrfToken, email, password: PASSWORD, json: 'true', redirect: 'false',
    }).toString(),
  })

  const load = await req(`/api/student/test/${schedule.id}`)
  console.log('load:', load.status, 'attemptId:', load.body?.attemptId)

  const first = await req(`/api/student/test/${schedule.id}/start`, { method: 'POST' })
  console.log('start immediately:', first.status, JSON.stringify(first.body).slice(0, 120))

  console.log(`waiting ${WAIT_SECONDS}s for any read cache to expire...`)
  await new Promise(r => setTimeout(r, WAIT_SECONDS * 1000))

  const second = await req(`/api/student/test/${schedule.id}/start`, { method: 'POST' })
  console.log('start after wait:', second.status, JSON.stringify(second.body).slice(0, 120))

  console.log(
    first.status !== 200 && second.status === 200
      ? '\nVERDICT: stale read expires with time -> Hyperdrive query caching is the cause.'
      : '\nVERDICT: not a time-based cache; look elsewhere.'
  )

  await prisma.candidateResponse.deleteMany({ where: { attempt: { scheduleId: schedule.id } } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId: schedule.id } })
  await prisma.testSchedule.delete({ where: { id: schedule.id } })
  await prisma.studentProfile.deleteMany({ where: { userId: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
