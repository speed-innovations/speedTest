/**
 * End-to-end concurrency check: N students sitting the same exam at once.
 *
 * Seeds its own college, test, schedule and students (everything tagged with
 * LOADTEST_TAG so it can be removed again), then drives the real HTTP API of a
 * running deployment - login, load, start, autosave, violation, submit - with
 * every student in flight simultaneously. Reports per-endpoint latency
 * percentiles and every non-2xx, then re-reads the database to prove no write
 * was dropped under load.
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/loadtest.ts --url https://<host> --students 30
 *   npx ts-node --project scripts/tsconfig.json scripts/loadtest.ts --cleanup
 *
 * DATABASE_URL must point at the same database the deployment uses.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

/** Every row this script creates carries the tag, so cleanup is exact. */
const LOADTEST_TAG = 'LOADTEST'
const EMAIL_DOMAIN = 'loadtest.invalid'
const PASSWORD = 'LoadTest@12345'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const BASE_URL = (arg('url') ?? 'http://localhost:3000').replace(/\/$/, '')
const STUDENTS = Number(arg('students', '30'))
const QUESTIONS_PER_AREA = Number(arg('questions', '30'))
const SAVE_ROUNDS = Number(arg('saves', '6'))
// Milliseconds between one student logging in and the next. 0 is the harshest
// case (a whole hall hitting Sign in within the same tick); a few hundred ms
// is what a proctored start actually looks like.
const LOGIN_STAGGER_MS = Number(arg('stagger', '0'))

// ---------------------------------------------------------------- metrics

interface Sample { ms: number; ok: boolean; status: number }
const samples = new Map<string, Sample[]>()

function record(label: string, ms: number, status: number) {
  if (!samples.has(label)) samples.set(label, [])
  samples.get(label)!.push({ ms, ok: status >= 200 && status < 300, status })
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/** Prints the latency table; returns false if any call was not a 2xx. */
function report(): boolean {
  const rows: Record<string, unknown>[] = []
  let anyFailure = false
  for (const [label, list] of samples) {
    const times = list.map(s => s.ms).sort((a, b) => a - b)
    const failures = list.filter(s => !s.ok)
    if (failures.length > 0) anyFailure = true
    rows.push({
      endpoint: label,
      calls: list.length,
      failed: failures.length,
      p50: pct(times, 50),
      p95: pct(times, 95),
      max: times[times.length - 1],
      statuses: [...new Set(list.map(s => s.status))].join(','),
    })
  }
  console.table(rows)
  return !anyFailure
}

// ---------------------------------------------------------------- http

/** Minimal cookie jar: one per student, so sessions never cross. */
class Jar {
  private jar = new Map<string, string>()

  absorb(res: Response) {
    // getSetCookie keeps multiple Set-Cookie headers separate; the joined
    // `get` would split them wrongly on commas inside Expires dates.
    const raw: string[] = (res.headers as any).getSetCookie?.() ?? []
    for (const line of raw) {
      const [pair] = line.split(';')
      const idx = pair.indexOf('=')
      if (idx > 0) this.jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
    }
  }

  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

async function call(
  jar: Jar,
  label: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: any }> {
  const started = Date.now()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { cookie: jar.header(), ...(init.headers ?? {}) },
  })
  jar.absorb(res)
  const text = await res.text()
  record(label, Date.now() - started, res.status)
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = text.slice(0, 200) }
  return { status: res.status, body }
}

/** NextAuth credentials sign-in: CSRF token, then the callback endpoint. */
async function login(jar: Jar, email: string): Promise<void> {
  const csrf = await call(jar, 'auth/csrf', '/api/auth/csrf')
  const token = csrf.body?.csrfToken
  if (!token) throw new Error(`no csrfToken (status ${csrf.status})`)

  const form = new URLSearchParams({
    csrfToken: token,
    email,
    password: PASSWORD,
    json: 'true',
    redirect: 'false',
  })
  const res = await call(jar, 'auth/login', '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (res.status >= 400) {
    throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`)
  }

  const session = await call(jar, 'auth/session', '/api/auth/session')
  if (!session.body?.user?.email) {
    throw new Error(`no session for ${email}: ${JSON.stringify(session.body)}`)
  }
}

// ---------------------------------------------------------------- seeding

async function ensureQuestions(areas: string[]) {
  for (const area of areas) {
    const have = await prisma.question.count({ where: { area: area as any, isActive: true } })
    if (have >= QUESTIONS_PER_AREA) continue
    const missing = QUESTIONS_PER_AREA - have
    await prisma.question.createMany({
      data: Array.from({ length: missing }, (_, i) => ({
        area: area as any,
        questionText: `[${LOADTEST_TAG}] ${area} question ${i + 1}`,
        optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
        correctAnswer: ['A', 'B', 'C', 'D'][i % 4],
        weightage: 1,
        difficulty: ['EASY', 'MEDIUM', 'HARD'][i % 3],
        tags: [LOADTEST_TAG],
      })),
    })
    console.log(`  seeded ${missing} ${area} questions`)
  }
}

async function seed() {
  const areas = ['APTITUDE', 'COMMUNICATION']
  await ensureQuestions(areas)

  const college = await prisma.college.upsert({
    where: { id: 'loadtest-college' },
    update: {},
    create: { id: 'loadtest-college', name: `${LOADTEST_TAG} College` },
  })

  const test = await prisma.test.upsert({
    where: { id: 'loadtest-test' },
    update: { durationMinutes: 60 },
    create: {
      id: 'loadtest-test',
      title: `${LOADTEST_TAG} Exam`,
      durationMinutes: 60,
      status: 'ACTIVE',
      assessmentConfig: areas.map(area => ({ area, count: 20, marks: 1 })),
    },
  })

  // A fresh schedule each run, so a rerun is never blocked by submitted attempts.
  const schedule = await prisma.testSchedule.create({
    data: {
      testId: test.id,
      collegeId: college.id,
      scheduledAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3 * 3600_000),
    },
  })

  // One hash for all of them: bcrypt at cost 12 is ~300ms a call.
  const hash = await bcrypt.hash(PASSWORD, 12)
  const emails: string[] = []
  for (let i = 0; i < STUDENTS; i++) {
    const email = `loadtest-${i}@${EMAIL_DOMAIN}`
    emails.push(email)
    const user = await prisma.user.upsert({
      where: { email },
      update: { password: hash, isActive: true, mustResetPassword: false, collegeId: college.id },
      create: {
        email, name: `${LOADTEST_TAG} Student ${i}`, password: hash,
        role: 'STUDENT', collegeId: college.id, mustResetPassword: false,
      },
    })
    await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: { collegeId: college.id },
      create: { userId: user.id, collegeId: college.id, fullName: user.name, email },
    })
  }

  console.log(`seeded: ${STUDENTS} students, schedule ${schedule.id}`)
  return { scheduleId: schedule.id, emails }
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true, studentProfile: { select: { id: true } } },
  })
  const studentIds = users.map(u => u.studentProfile?.id).filter((x): x is string => !!x)
  const attempts = await prisma.testAttempt.findMany({
    where: { studentId: { in: studentIds } },
    select: { id: true },
  })
  await prisma.candidateResponse.deleteMany({ where: { attemptId: { in: attempts.map(a => a.id) } } })
  await prisma.testAttempt.deleteMany({ where: { studentId: { in: studentIds } } })
  await prisma.walkInResponse.deleteMany({ where: { attempt: { studentId: { in: studentIds } } } })
  await prisma.walkInAttempt.deleteMany({ where: { studentId: { in: studentIds } } })
  await prisma.studentProfile.deleteMany({ where: { id: { in: studentIds } } })
  await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } })
  // Schedules can also be left behind by probe runs whose students are already
  // gone, so clear attempts by schedule before dropping the schedules.
  const strays = await prisma.testSchedule.findMany({
    where: { OR: [{ collegeId: 'loadtest-college' }, { testId: 'loadtest-test' }] },
    select: { id: true },
  })
  const strayIds = strays.map(s => s.id)
  await prisma.candidateResponse.deleteMany({ where: { attempt: { scheduleId: { in: strayIds } } } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId: { in: strayIds } } })
  await prisma.testSchedule.deleteMany({ where: { id: { in: strayIds } } })
  await prisma.walkInEligibleStudent.deleteMany({ where: { testId: 'loadtest-test' } })
  await prisma.walkInTestCollege.deleteMany({ where: { testId: 'loadtest-test' } })
  await prisma.test.deleteMany({ where: { id: 'loadtest-test' } })
  await prisma.college.deleteMany({ where: { id: 'loadtest-college' } })
  await prisma.question.deleteMany({ where: { tags: { has: LOADTEST_TAG } } })
  console.log(`cleaned up ${users.length} load-test students and their fixtures`)
}

// ---------------------------------------------------------------- barrier

/**
 * Students trickle in - the proctor lets them log in one at a time - but once
 * they are all in they answer simultaneously for the length of the paper.
 * Without this the stagger would also stagger the exam, and the run would
 * never put more than one student on the answer endpoints at once, which is
 * the thing worth measuring.
 */
function makeBarrier(expected: number) {
  let arrived = 0
  let release: () => void
  const gate = new Promise<void>(r => { release = r })
  return {
    async wait() {
      if (++arrived >= expected) release()
      // A student who cannot start must not wedge everyone behind them.
      await Promise.race([gate, new Promise(r => setTimeout(r, 120_000))])
    },
  }
}

let barrier: { wait(): Promise<void> }

// ---------------------------------------------------------------- one exam

interface Outcome { email: string; ok: boolean; error?: string; score?: number; answered?: number }

async function sitExam(email: string, scheduleId: string, index: number): Promise<Outcome> {
  const jar = new Jar()
  try {
    if (LOGIN_STAGGER_MS > 0) await new Promise(r => setTimeout(r, index * LOGIN_STAGGER_MS))
    await login(jar, email)

    const load = await call(jar, 'test GET', `/api/student/test/${scheduleId}`)
    if (load.status !== 200) throw new Error(`load ${load.status}: ${JSON.stringify(load.body)}`)

    const start = await call(jar, 'test start', `/api/student/test/${scheduleId}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    if (start.status !== 200) throw new Error(`start ${start.status}: ${JSON.stringify(start.body)}`)

    const attemptId: string = start.body.attemptId
    const questions: { id: string }[] = start.body.questions ?? []
    if (questions.length === 0) throw new Error('start returned no questions')

    // Everyone is now sitting the paper; answer together from here.
    await barrier.wait()

    // Autosave the way the UI does: batches of answers, spaced out.
    const answers: Record<string, string> = {}
    const perRound = Math.ceil(questions.length / SAVE_ROUNDS)
    for (let round = 0; round < SAVE_ROUNDS; round++) {
      const batch: Record<string, string> = {}
      for (const q of questions.slice(round * perRound, (round + 1) * perRound)) {
        const a = ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)]
        batch[q.id] = a
        answers[q.id] = a
      }
      if (Object.keys(batch).length === 0) continue
      const save = await call(jar, 'test save', `/api/student/test/${scheduleId}/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attemptId, answers: batch }),
      })
      if (save.status !== 200) throw new Error(`save ${save.status}: ${JSON.stringify(save.body)}`)
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500))
    }

    // One tab-switch report, as a real sitting would produce.
    const violation = await call(jar, 'test violation', `/api/student/test/${scheduleId}/violation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attemptId, violation: { questionId: questions[0].id, type: 'TAB_SWITCH' } }),
    })
    if (violation.status !== 200) {
      throw new Error(`violation ${violation.status}: ${JSON.stringify(violation.body)}`)
    }

    const submit = await call(jar, 'test submit', `/api/student/test/${scheduleId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attemptId, answers, violations: [] }),
    })
    if (submit.status !== 200 || !submit.body?.success) {
      throw new Error(`submit ${submit.status}: ${JSON.stringify(submit.body)}`)
    }

    return { email, ok: true, score: submit.body.totalScore, answered: Object.keys(answers).length }
  } catch (err: any) {
    return { email, ok: false, error: err.message }
  }
}

// ---------------------------------------------------------------- main

async function main() {
  if (flag('cleanup')) { await cleanup(); return }

  console.log(`target:   ${BASE_URL}`)
  console.log(`students: ${STUDENTS}, save rounds: ${SAVE_ROUNDS}, login stagger: ${LOGIN_STAGGER_MS}ms`)

  const { scheduleId, emails } = await seed()
  barrier = makeBarrier(STUDENTS)

  console.log('\nall students starting simultaneously...')
  const wall = Date.now()
  const outcomes = await Promise.all(emails.map((e, i) => sitExam(e, scheduleId, i)))
  const elapsed = Date.now() - wall

  console.log(`\nwall clock: ${(elapsed / 1000).toFixed(1)}s`)
  const failed = outcomes.filter(o => !o.ok)
  console.log(`completed:  ${outcomes.length - failed.length}/${outcomes.length}`)
  for (const f of failed) console.error(`  FAILED ${f.email}: ${f.error}`)

  const latencyOk = report()

  // Re-read from the database: a dropped write under load is the failure this
  // whole exercise exists to catch, and a 200 alone does not rule it out.
  const attempts = await prisma.testAttempt.findMany({
    where: { scheduleId },
    select: {
      id: true, isSubmitted: true, totalScore: true, violations: true,
      _count: { select: { responses: true } },
    },
  })
  const unsubmitted = attempts.filter(a => !a.isSubmitted)
  const graded = attempts.filter(a => a.totalScore !== null)
  const withViolation = attempts.filter(a => Array.isArray(a.violations) && a.violations.length > 0)
  console.log(
    `\nattempts: ${attempts.length}, submitted: ${attempts.length - unsubmitted.length}, ` +
    `graded: ${graded.length}, violation recorded: ${withViolation.length}`
  )

  if (attempts.length > 0) {
    const counts = attempts.map(a => a._count.responses)
    console.log(`responses per attempt: min ${Math.min(...counts)}, max ${Math.max(...counts)}`)
  }

  const pass =
    failed.length === 0 &&
    latencyOk &&
    attempts.length === STUDENTS &&
    unsubmitted.length === 0 &&
    graded.length === attempts.length &&
    withViolation.length === STUDENTS

  console.log(pass ? '\nPASS' : '\nFAIL')
  if (!pass) process.exitCode = 1
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
