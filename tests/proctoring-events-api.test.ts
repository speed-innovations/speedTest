import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { ingestEvents, MAX_EVENTS_PER_SESSION, recordServerEvent } from '@/lib/proctoring/events'
import type { IncomingEvent } from '@/lib/proctoring/schemas'
import { eventBatchSchema } from '@/lib/proctoring/schemas'

/**
 * Event ingest against a real database.
 *
 * The behaviour that matters is dedup. The client retries a failed batch, and a
 * batch that succeeded but whose response was lost gets retried too - the server
 * cannot tell those apart. Without server-side dedup one dropped response
 * inflates a candidate's gaze-warning count, and that count is evidence a human
 * will read.
 */

const TAG = `events-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
let attemptId = ''
let sessionId = ''
const userIds: string[] = []

const ASSIGNED = ['assigned-question-1', 'assigned-question-2']

beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college` } })
  collegeId = college.id
  const test = await prisma.test.create({
    data: {
      title: `${TAG}-test`,
      durationMinutes: 60,
      proctoringEnabled: true,
      assessmentConfig: [{ area: 'APTITUDE', count: 1 }],
    },
  })
  testId = test.id
  const schedule = await prisma.testSchedule.create({
    data: {
      testId,
      collegeId,
      scheduledAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
    },
  })
  scheduleId = schedule.id

  const user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: TAG, password: 'x', role: 'STUDENT' },
  })
  userIds.push(user.id)
  const profile = await prisma.studentProfile.create({
    data: { userId: user.id, collegeId, fullName: TAG, email: `${TAG}@example.test` },
  })
  const attempt = await prisma.testAttempt.create({
    data: { scheduleId, studentId: profile.id, userId: user.id, questionIds: ASSIGNED },
  })
  attemptId = attempt.id

  const session = await prisma.proctoringSession.create({
    data: {
      testAttemptId: attemptId,
      status: 'ACTIVE',
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      retentionExpiresAt: new Date(Date.now() + 72 * 3_600_000),
    },
  })
  sessionId = session.id
})

afterAll(async () => {
  await prisma.proctoringEvent.deleteMany({ where: { proctoringSessionId: sessionId } })
  await prisma.proctoringSession.deleteMany({ where: { id: sessionId } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.proctoringEvent.deleteMany({ where: { proctoringSessionId: sessionId } })
  await prisma.proctoringSession.update({
    where: { id: sessionId },
    data: { gazeWarningCount: 0 },
  })
})

let n = 0
function gaze(id?: string): IncomingEvent {
  return {
    clientEventId: id ?? `evt-${TAG}-${n++}`,
    type: 'LOOKING_LEFT',
    direction: 'LEFT',
    startedAt: new Date().toISOString(),
  }
}

describe('ingestEvents', () => {
  it('stores a batch and reports the accepted count', async () => {
    const r = await ingestEvents(sessionId, [gaze(), gaze(), gaze()], ASSIGNED)
    expect(r).toEqual({ accepted: 3, duplicates: 0, capped: false })
    expect(await prisma.proctoringEvent.count({ where: { proctoringSessionId: sessionId } })).toBe(3)
  })

  it('does not inflate the gaze count when a batch is replayed', async () => {
    const batch = [gaze('evt-replay-aaaa')]
    const first = await ingestEvents(sessionId, batch, [])
    const second = await ingestEvents(sessionId, batch, [])

    expect(first.accepted).toBe(1)
    expect(second.accepted).toBe(0)
    expect(second.duplicates).toBe(1)

    const rows = await prisma.proctoringEvent.count({ where: { proctoringSessionId: sessionId } })
    expect(rows).toBe(1)

    const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(s.gazeWarningCount).toBe(1) // not 2
  })

  it('stores only the new events from a partially overlapping batch', async () => {
    const shared = gaze('evt-overlap-aaa1')
    await ingestEvents(sessionId, [shared], ASSIGNED)
    const r = await ingestEvents(sessionId, [shared, gaze('evt-overlap-aaa2')], ASSIGNED)
    expect(r).toEqual({ accepted: 1, duplicates: 1, capped: false })
    expect(await prisma.proctoringEvent.count({ where: { proctoringSessionId: sessionId } })).toBe(2)
  })

  it('does not count non-gaze events towards the gaze tally', async () => {
    await ingestEvents(sessionId, [{
      clientEventId: 'evt-tabhidden-01',
      type: 'TAB_HIDDEN',
      startedAt: new Date().toISOString(),
    }], ASSIGNED)
    const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(s.gazeWarningCount).toBe(0)
  })

  it('keeps a questionId that is in the assigned set', async () => {
    const r = await ingestEvents(sessionId, [{
      ...gaze('evt-assigned-0001'),
      questionId: ASSIGNED[0],
    }], ASSIGNED)
    expect(r.accepted).toBe(1)
    const row = await prisma.proctoringEvent.findFirstOrThrow({
      where: { proctoringSessionId: sessionId, clientEventId: 'evt-assigned-0001' },
    })
    expect(row.questionId).toBe(ASSIGNED[0])
  })

  it('nulls an unassigned questionId rather than rejecting the event', async () => {
    // The observation is still evidence even when we cannot say which question
    // it happened on. Dropping the event would lose that.
    const r = await ingestEvents(sessionId, [{
      ...gaze('evt-unassigned-001'),
      questionId: 'some-other-attempts-question',
    }], ASSIGNED)
    expect(r.accepted).toBe(1)
    const row = await prisma.proctoringEvent.findFirstOrThrow({
      where: { proctoringSessionId: sessionId, clientEventId: 'evt-unassigned-001' },
    })
    expect(row.questionId).toBeNull()
  })

  it('stamps receivedAt server-side even when startedAt is implausible', async () => {
    // A candidate's clock can be wrong, or set wrong on purpose. The server's
    // own receipt time is what a reviewer can rely on.
    const before = Date.now()
    await ingestEvents(sessionId, [{
      ...gaze('evt-badclock-0001'),
      startedAt: new Date('2001-01-01T00:00:00.000Z').toISOString(),
    }], ASSIGNED)
    const row = await prisma.proctoringEvent.findFirstOrThrow({
      where: { proctoringSessionId: sessionId, clientEventId: 'evt-badclock-0001' },
    })
    expect(row.startedAt.getUTCFullYear()).toBe(2001)
    expect(row.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('stores bounded metadata as given', async () => {
    await ingestEvents(sessionId, [{
      ...gaze('evt-metadata-0001'),
      metadata: { reason: 'sustained', frames: 9, recovered: false },
    }], ASSIGNED)
    const row = await prisma.proctoringEvent.findFirstOrThrow({
      where: { proctoringSessionId: sessionId, clientEventId: 'evt-metadata-0001' },
    })
    expect(row.metadata).toEqual({ reason: 'sustained', frames: 9, recovered: false })
  })

  it('stores endedAt, duration and confidence for an episode', async () => {
    const start = new Date(Date.now() - 3000)
    await ingestEvents(sessionId, [{
      clientEventId: 'evt-episode-00001',
      type: 'FACE_MISSING',
      startedAt: start.toISOString(),
      endedAt: new Date(start.getTime() + 2600).toISOString(),
      durationMs: 2600,
      confidence: 0.9,
    }], ASSIGNED)
    const row = await prisma.proctoringEvent.findFirstOrThrow({
      where: { proctoringSessionId: sessionId, clientEventId: 'evt-episode-00001' },
    })
    expect(row.endedAt!.getTime() - row.startedAt.getTime()).toBe(2600)
    expect(row.durationMs).toBe(2600)
    expect(row.confidence).toBeCloseTo(0.9)
  })

  it('derives severity server-side from the type', async () => {
    await ingestEvents(sessionId, [
      { clientEventId: 'evt-sev-blur-001', type: 'WINDOW_BLUR', startedAt: new Date().toISOString() },
      { clientEventId: 'evt-sev-scrn-001', type: 'SCREEN_SHARE_INTERRUPTED', startedAt: new Date().toISOString() },
    ], ASSIGNED)
    const rows = await prisma.proctoringEvent.findMany({
      where: { proctoringSessionId: sessionId, clientEventId: { in: ['evt-sev-blur-001', 'evt-sev-scrn-001'] } },
      orderBy: { clientEventId: 'asc' },
    })
    expect(rows.map(r => r.severity)).toEqual(['INFO', 'WARN'])
  })

  it('stops storing at the per-session ceiling', async () => {
    const filler = []
    for (let i = 0; i < MAX_EVENTS_PER_SESSION - 2; i++) {
      filler.push({ proctoringSessionId: sessionId, clientEventId: `fill-${i}`, type: 'WINDOW_BLUR' as const, startedAt: new Date() })
    }
    await prisma.proctoringEvent.createMany({ data: filler })
    const r = await ingestEvents(sessionId, [gaze(), gaze(), gaze(), gaze()], ASSIGNED)
    expect(r).toMatchObject({ accepted: 2, capped: true })
    expect(await prisma.proctoringEvent.count({ where: { proctoringSessionId: sessionId } })).toBe(MAX_EVENTS_PER_SESSION)
    expect((await ingestEvents(sessionId, [gaze()], ASSIGNED)).accepted).toBe(0)
  })

  it('records a server event once, however often it is observed', async () => {
    const at = new Date()
    const e = { clientEventId: `srv-test-${sessionId}`, type: 'HEARTBEAT_MISSED' as const, startedAt: at }
    expect(await recordServerEvent(sessionId, e)).toBe(true)
    expect(await recordServerEvent(sessionId, e)).toBe(false)
  })
})

describe('eventBatchSchema', () => {
  const base = { attemptId: 'a1', kind: 'scheduled', parentId: 'p1', sessionId: 's1' }
  const ok = { clientEventId: 'evt-schema-00001', type: 'LOOKING_DOWN', startedAt: new Date().toISOString() }

  it('accepts a well-formed metadata event', () => {
    expect(eventBatchSchema.safeParse({ ...base, events: [ok] }).success).toBe(true)
  })

  it('rejects a server-only type from a client', () => {
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, type: 'HEARTBEAT_MISSED' }] }).success).toBe(false)
  })

  it('rejects retired media and gaze names', () => {
    const retired = ['UPLOAD_FAILURE', 'GAZE_LEFT', 'PHONE_DETECTED']
    retired.forEach(type => {
      expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, type }] }).success).toBe(false)
    })
  })

  it('rejects anything shaped like media in metadata', () => {
    const frame = 'data:image/jpeg;base64,' + 'A'.repeat(4000)
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, metadata: { frame } }] }).success).toBe(false)
  })

  it('rejects the reserved srv- id prefix', () => {
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, clientEventId: 'srv-hb-x-123' }] }).success).toBe(false)
  })

  it('rejects an end before the start and an out-of-range confidence', () => {
    const start = new Date()
    const before = new Date(start.getTime() - 1000).toISOString()
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, startedAt: start.toISOString(), endedAt: before }] }).success).toBe(false)
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, confidence: 1.5 }] }).success).toBe(false)
  })

  it('caps metadata keys', () => {
    const metadata: Record<string, number> = {}
    for (let i = 0; i < 13; i++) metadata[`k${i}`] = i
    expect(eventBatchSchema.safeParse({ ...base, events: [{ ...ok, metadata }] }).success).toBe(false)
  })
})
