import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

/**
 * The student proctoring routes, called as handlers with a stubbed session.
 * What is pinned is server authority: a candidate can only ever touch their
 * own live session, whatever ids they put in the body.
 */
const getServerSession = vi.fn()
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}))

import { prisma } from '@/lib/db'
import { POST as eventsPost } from '@/app/api/student/proctoring/events/route'
import { POST as heartbeatPost } from '@/app/api/student/proctoring/heartbeat/route'
import { POST as sessionPost } from '@/app/api/student/proctoring/session/route'
import { resetRateLimitsForTests } from '@/lib/proctoring/rate-limit'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'

const TAG = `routes-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
const userIds: string[] = []
const people: Record<'a' | 'b', { email: string; attemptId: string; sessionId: string }> = {
  a: { email: '', attemptId: '', sessionId: '' },
  b: { email: '', attemptId: '', sessionId: '' },
}

function post(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

const as = (who: 'a' | 'b') => getServerSession.mockResolvedValue({ user: { email: people[who].email, role: 'STUDENT' } })
const ref = (who: 'a' | 'b') => ({ attemptId: people[who].attemptId, kind: 'scheduled', parentId: scheduleId })
const event = (id: string, type = 'LOOKING_LEFT') => ({ clientEventId: id, type, startedAt: new Date().toISOString() })
const HEALTH = {
  clientState: 'ACTIVE', camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE',
  gazeMonitor: 'RUNNING', clientTimestamp: new Date().toISOString(),
}

beforeAll(async () => {
  collegeId = (await prisma.college.create({ data: { name: `${TAG}-college` } })).id
  testId = (await prisma.test.create({
    data: { title: TAG, durationMinutes: 60, proctoringEnabled: true, assessmentConfig: [] },
  })).id
  scheduleId = (await prisma.testSchedule.create({
    data: { testId, collegeId, scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
  })).id
  for (const who of ['a', 'b'] as const) {
    const email = `${TAG}-${who}@example.test`
    const user = await prisma.user.create({ data: { email, name: TAG, password: 'x', role: 'STUDENT' } })
    userIds.push(user.id)
    const profile = await prisma.studentProfile.create({ data: { userId: user.id, collegeId, fullName: TAG, email } })
    const attempt = await prisma.testAttempt.create({
      data: { scheduleId, studentId: profile.id, userId: user.id, questionIds: [] },
    })
    const session = await prisma.proctoringSession.create({
      data: {
        testAttemptId: attempt.id, status: 'ACTIVE', startedAt: new Date(), lastHeartbeatAt: new Date(),
        retentionExpiresAt: new Date(Date.now() + 72 * 3_600_000),
      },
    })
    people[who] = { email, attemptId: attempt.id, sessionId: session.id }
  }
})

afterAll(async () => {
  await prisma.proctoringSession.deleteMany({ where: { testAttemptId: { in: [people.a.attemptId, people.b.attemptId] } } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

beforeEach(() => {
  getServerSession.mockReset()
  resetRateLimitsForTests()
  process.env.PROCTORING_ENABLED = 'true'
  process.env.PROCTORING_OPERATIONAL = 'true'
  resetProctoringConfigForTests()
})

const countFor = (who: 'a' | 'b') => prisma.proctoringEvent.count({ where: { proctoringSessionId: people[who].sessionId } })

describe('POST /api/student/proctoring/events', () => {
  it('stores events for the caller\'s own live session', async () => {
    as('a')
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('a'), sessionId: people.a.sessionId, events: [event('evt-route-own-01')],
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).accepted).toBe(1)
  })

  it('refuses another candidate\'s session id with 404 and stores nothing anywhere', async () => {
    as('a')
    const before = [await countFor('a'), await countFor('b')]
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('a'), sessionId: people.b.sessionId, events: [event('evt-route-fake-01')],
    }))
    expect(res.status).toBe(404)
    expect([await countFor('a'), await countFor('b')]).toEqual(before)
  })

  it('refuses another candidate\'s attempt with 404', async () => {
    as('a')
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('b'), sessionId: people.b.sessionId, events: [event('evt-route-fake-02')],
    }))
    expect(res.status).toBe(404)
  })

  it('refuses a server-only event type from a client', async () => {
    as('a')
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('a'), sessionId: people.a.sessionId, events: [event('evt-route-srv-01', 'HEARTBEAT_MISSED')],
    }))
    expect(res.status).toBe(400)
  })

  it('rate-limits a client streaming batches', async () => {
    as('a')
    let last = 0
    for (let i = 0; i < 31; i++) {
      const res = await eventsPost(post('/api/student/proctoring/events', {
        ...ref('a'), sessionId: people.a.sessionId, events: [event(`evt-route-rate-${i}`)],
      }))
      last = res.status
    }
    expect(last).toBe(429)
  })

  it('refuses an unauthenticated caller', async () => {
    getServerSession.mockResolvedValue(null)
    const res = await eventsPost(post('/api/student/proctoring/events', {
      ...ref('a'), sessionId: people.a.sessionId, events: [event('evt-route-anon-01')],
    }))
    expect(res.status).toBe(401)
  })
})

describe('POST /api/student/proctoring/heartbeat', () => {
  it('records health for the caller\'s own session', async () => {
    as('a')
    const res = await heartbeatPost(post('/api/student/proctoring/heartbeat', {
      ...ref('a'), sessionId: people.a.sessionId, ...HEALTH,
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, session: { sessionId: people.a.sessionId, status: 'ACTIVE' } })
  })

  it('marks the session DEGRADED server-side when the camera is reported stopped', async () => {
    as('a')
    await heartbeatPost(post('/api/student/proctoring/heartbeat', {
      ...ref('a'), sessionId: people.a.sessionId, ...HEALTH, camera: 'ENDED',
    }))
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: people.a.sessionId } })).status).toBe('DEGRADED')
  })

  it('refuses a mismatched session id with 404', async () => {
    as('a')
    const res = await heartbeatPost(post('/api/student/proctoring/heartbeat', {
      ...ref('a'), sessionId: people.b.sessionId, ...HEALTH,
    }))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/student/proctoring/session', () => {
  it('returns operational config only - no detection threshold ever leaves the server', async () => {
    as('b')
    const res = await sessionPost(post('/api/student/proctoring/session', ref('b')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body.config).sort()).toEqual(['heartbeatIntervalMs', 'screenRequired'])
    expect(body.resumed).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/gaze|warningMs|cooldown|yaw|pitch|threshold/i)
  })
})
