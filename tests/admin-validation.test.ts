import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

/**
 * Validation on the retrofitted admin write routes.
 *
 * Two kinds of assertion here. The schema cases pin what is now rejected -
 * notably `correctAnswer: 'E'`, which today would silently mark every candidate
 * wrong on that question with no error raised anywhere. The route cases pin
 * what must keep working: these endpoints take partial bodies from the admin UI
 * and a validation change that broke that would be discovered by an
 * administrator mid-edit, not by a test.
 *
 * The last case reads every assessmentConfig in the database. A schema that
 * rejects live data is a schema that breaks the admin UI on the next edit of an
 * existing test.
 */

const getServerSession = vi.fn()
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}))

import { prisma } from '@/lib/db'
import {
  assessmentConfigSchema,
  testCreateSchema,
  testUpdateSchema,
  collegeCreateSchema,
  questionCreateSchema,
  jobOpeningCreateSchema,
  jobOpeningUpdateSchema,
} from '@/lib/schemas/admin'
import { PUT as testPut } from '@/app/api/admin/tests/[id]/route'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'
import { POST as questionPost } from '@/app/api/admin/questions/route'
import { POST as collegePost } from '@/app/api/admin/colleges/route'

const TAG = `admin-val-${Date.now()}`
let adminEmail = ''
let studentEmail = ''
let jobOpeningId = ''
const userIds: string[] = []
const testIds: string[] = []
const collegeIds: string[] = []
const questionIds: string[] = []

const VALID_TEST = {
  title: `${TAG}-test`,
  durationMinutes: 30,
  totalMarks: 10,
  passingMarks: 5,
  assessmentConfig: [{ area: 'APTITUDE', count: 5, easyPct: 30, mediumPct: 50, hardPct: 20 }],
}

function asAdmin() {
  getServerSession.mockResolvedValue({ user: { email: adminEmail, role: 'APP_ADMIN' } })
}

function req(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: { email: `${TAG}-admin@example.test`, name: `${TAG}-a`, password: 'x', role: 'APP_ADMIN' },
  })
  userIds.push(admin.id)
  adminEmail = admin.email

  const student = await prisma.user.create({
    data: { email: `${TAG}-student@example.test`, name: `${TAG}-s`, password: 'x', role: 'STUDENT' },
  })
  userIds.push(student.id)
  studentEmail = student.email

  const job = await prisma.jobOpening.create({ data: { title: `${TAG}-job` } })
  jobOpeningId = job.id
})

afterAll(async () => {
  await prisma.question.deleteMany({ where: { id: { in: questionIds } } })
  await prisma.test.deleteMany({ where: { id: { in: testIds } } })
  await prisma.jobOpening.deleteMany({ where: { id: jobOpeningId } })
  await prisma.college.deleteMany({ where: { id: { in: collegeIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

beforeEach(() => {
  getServerSession.mockReset()
  // Enabling proctoring on a test is refused while the deployment switch is
  // off; these cases exercise the update itself, so switch it on.
  process.env.PROCTORING_ENABLED = 'true'
  resetProctoringConfigForTests()
})

describe('testCreateSchema', () => {
  it('accepts a valid payload', () => {
    expect(testCreateSchema.safeParse(VALID_TEST).success).toBe(true)
  })

  it('rejects passingMarks above totalMarks', () => {
    const r = testCreateSchema.safeParse({ ...VALID_TEST, passingMarks: 11 })
    expect(r.success).toBe(false)
  })

  it('rejects an unknown assessment area', () => {
    const r = testCreateSchema.safeParse({
      ...VALID_TEST,
      assessmentConfig: [{ area: 'ASTROLOGY', count: 5 }],
    })
    expect(r.success).toBe(false)
  })

  it('strips an unexpected field rather than passing it to Prisma', () => {
    const r = testCreateSchema.safeParse({ ...VALID_TEST, isAdmin: true, sneaky: 'x' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect('isAdmin' in r.data).toBe(false)
      expect('sneaky' in r.data).toBe(false)
    }
  })

  it('allows a partial update, and only checks the marks rule when both are sent', () => {
    // The admin UI sends single-field bodies. A strict update schema would
    // break the tests list's toggles.
    expect(testUpdateSchema.safeParse({ proctoringEnabled: true }).success).toBe(true)
    expect(testUpdateSchema.safeParse({ passingMarks: 9999 }).success).toBe(true)
    expect(testUpdateSchema.safeParse({ passingMarks: 20, totalMarks: 10 }).success).toBe(false)
  })
})

describe('assessmentConfigSchema', () => {
  it('rejects difficulty percentages that do not sum to 100', () => {
    const r = assessmentConfigSchema.safeParse([
      { area: 'APTITUDE', count: 5, easyPct: 30, mediumPct: 30, hardPct: 20 },
    ])
    expect(r.success).toBe(false)
  })

  it('accepts percentages absent entirely, for legacy rows', () => {
    expect(assessmentConfigSchema.safeParse([{ area: 'APTITUDE', count: 5 }]).success).toBe(true)
  })

  it('rejects a partial mix', () => {
    const r = assessmentConfigSchema.safeParse([{ area: 'APTITUDE', count: 5, easyPct: 100 }])
    expect(r.success).toBe(false)
  })

  it('preserves the legacy marks field instead of stripping it', () => {
    // Nothing reads it, but silently rewriting a stored row as a side effect
    // of an unrelated edit is not something a validation change should do.
    const r = assessmentConfigSchema.safeParse([{ area: 'APTITUDE', count: 3, marks: 1 }])
    expect(r.success).toBe(true)
    if (r.success) expect(r.data[0].marks).toBe(1)
  })

  it('accepts every real assessmentConfig already in the database', async (ctx) => {
    const tests = await prisma.test.findMany({ select: { id: true, assessmentConfig: true } })

    // Empty arrays are excluded deliberately, not to make this pass. The schema
    // requires at least one area on purpose - a test with no areas builds an
    // empty paper, which is exactly the "malformed config only surfaces when a
    // candidate tries to start" failure this part exists to catch. The only
    // source of an empty one is tests/responses.test.ts:47, a minimal fixture
    // that never builds a paper, and vitest may be running it right now.
    const real = tests.filter(t => Array.isArray(t.assessmentConfig) && t.assessmentConfig.length > 0)

    // This checks live data, so it needs some. CI's throwaway database holds
    // only the seeded questions and no tests; skip there, visibly, rather than
    // pass on nothing. Against a real bank (local or a production snapshot) it runs.
    if (real.length === 0) ctx.skip()

    for (const t of real) {
      const r = assessmentConfigSchema.safeParse(t.assessmentConfig)
      expect(
        r.success,
        `test ${t.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`
      ).toBe(true)
    }
  })

  it('rejects an empty config, which is what keeps a paper from being empty', () => {
    expect(assessmentConfigSchema.safeParse([]).success).toBe(false)
  })
})

describe('questionCreateSchema', () => {
  it("rejects correctAnswer 'E'", () => {
    // gradeAttempt compares against correctAnswer.trim().toUpperCase(), so 'E'
    // would mark every candidate wrong on this question and raise nothing.
    const r = questionCreateSchema.safeParse({
      area: 'APTITUDE', questionText: 'q', optionA: 'a', optionB: 'b',
      optionC: 'c', optionD: 'd', correctAnswer: 'E',
    })
    expect(r.success).toBe(false)
  })

  it("rejects lowercase correctAnswer 'a'", () => {
    const r = questionCreateSchema.safeParse({
      area: 'APTITUDE', questionText: 'q', optionA: 'a', optionB: 'b',
      optionC: 'c', optionD: 'd', correctAnswer: 'a',
    })
    expect(r.success).toBe(false)
  })

  it('rejects an empty option', () => {
    const r = questionCreateSchema.safeParse({
      area: 'APTITUDE', questionText: 'q', optionA: '', optionB: 'b',
      optionC: 'c', optionD: 'd', correctAnswer: 'A',
    })
    expect(r.success).toBe(false)
  })
})

describe('collegeCreateSchema', () => {
  it('rejects a malformed contactEmail but accepts an empty string', () => {
    expect(collegeCreateSchema.safeParse({ name: 'X', contactEmail: 'not-an-email' }).success).toBe(false)
    // The form posts '' for an untouched field and the route maps it to null.
    expect(collegeCreateSchema.safeParse({ name: 'X', contactEmail: '' }).success).toBe(true)
    expect(collegeCreateSchema.safeParse({ name: 'X' }).success).toBe(true)
  })

  it('rejects a missing name', () => {
    expect(collegeCreateSchema.safeParse({ city: 'Pune' }).success).toBe(false)
  })
})

describe('the retrofitted routes', () => {
  it('rejects a bad body with 400 and no Prisma detail', async () => {
    asAdmin()
    const res = await questionPost(req('http://localhost/api/admin/questions', 'POST', {
      area: 'APTITUDE', questionText: 'q', optionA: 'a', optionB: 'b',
      optionC: 'c', optionD: 'd', correctAnswer: 'E',
    }) as never)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    // A validation message names the field. What it must never carry is Prisma
    // or driver internals, which is what the old `err.message` 500 leaked.
    expect(body.error).not.toMatch(/prisma|invocation|postgres/i)
  })

  it('returns 403 for an authenticated non-admin, not 401', async () => {
    getServerSession.mockResolvedValue({ user: { email: studentEmail, role: 'STUDENT' } })
    const res = await collegePost(req('http://localhost/api/admin/colleges', 'POST', { name: 'X' }) as never)
    expect(res.status).toBe(403)
  })

  it('creates a college and keeps the response shape', async () => {
    asAdmin()
    const res = await collegePost(req('http://localhost/api/admin/colleges', 'POST', {
      name: `${TAG}-college`, city: 'Pune', contactEmail: '',
    }) as never)

    expect(res.status).toBe(201)
    const college = await res.json()
    collegeIds.push(college.id)
    expect(college.name).toBe(`${TAG}-college`)
    // '' maps to null, exactly as the route did before.
    expect(college.contactEmail).toBeNull()
    expect(college.isActive).toBe(true)
  })

  it('does not clear jobOpeningId on a single-field PUT', async () => {
    // The regression this retrofit fixes. The route used to read
    // `jobOpeningId: body.jobOpeningId || null`, so every toggle from the tests
    // list - walk-in and, since Part 10, proctoring - silently unlinked the
    // test's job opening. Verified against the old code before changing it.
    const test = await prisma.test.create({
      data: {
        title: `${TAG}-partial`, durationMinutes: 10, totalMarks: 10, passingMarks: 5,
        assessmentConfig: [{ area: 'APTITUDE', count: 1 }],
        jobOpeningId, description: 'keep me',
      },
    })
    testIds.push(test.id)

    asAdmin()
    const res = await testPut(
      req(`http://localhost/api/admin/tests/${test.id}`, 'PUT', { proctoringEnabled: true }) as never,
      { params: Promise.resolve({ id: test.id }) }
    )
    expect(res.status).toBe(200)

    const after = await prisma.test.findUniqueOrThrow({ where: { id: test.id } })
    expect(after.jobOpeningId).toBe(jobOpeningId)
    expect(after.proctoringEnabled).toBe(true)
    expect(after.description).toBe('keep me')
    expect(after.durationMinutes).toBe(10)
  })

  it('still clears jobOpeningId when null is sent deliberately', async () => {
    const test = await prisma.test.create({
      data: {
        title: `${TAG}-clear`, durationMinutes: 10, totalMarks: 10, passingMarks: 5,
        assessmentConfig: [{ area: 'APTITUDE', count: 1 }],
        jobOpeningId,
      },
    })
    testIds.push(test.id)

    asAdmin()
    const res = await testPut(
      req(`http://localhost/api/admin/tests/${test.id}`, 'PUT', { jobOpeningId: null }) as never,
      { params: Promise.resolve({ id: test.id }) }
    )
    expect(res.status).toBe(200)

    // Absent means leave alone; null means clear. Both have to work.
    const after = await prisma.test.findUniqueOrThrow({ where: { id: test.id } })
    expect(after.jobOpeningId).toBeNull()
  })
})

/**
 * The payloads the admin forms actually build.
 *
 * A validation change is exactly the kind that passes every route test and then
 * breaks a form, because the form sends a shape nobody wrote a test for -
 * empty strings for untouched optional fields, a null where the schema wanted a
 * string, a field the form does not send at all. Each case below mirrors a real
 * submit handler, so a schema that would break a form fails here instead of in
 * front of an administrator.
 *
 * Sources, so these can be re-checked when a form changes:
 *   src/app/admin/tests/new/page.tsx          (spreads ...form, overrides 4 keys)
 *   src/app/admin/tests/[id]/edit/page.tsx    (same, plus status)
 *   src/components/admin/CollegeForm.tsx      (posts form verbatim)
 *   src/app/admin/question-bank/page.tsx      (emptyQ() shape)
 *   src/app/admin/job-openings/page.tsx       (posts form verbatim, PATCH isActive)
 */
describe('the payloads the admin forms actually send', () => {
  it('accepts the new-test form, with its empty strings and null job opening', () => {
    // form.jobOpeningId defaults to '' and the handler sends `|| null`.
    const payload = {
      title: 'Campus Drive 2026',
      description: '',
      durationMinutes: 60,
      passingMarks: 40,
      isWalkIn: false,
      proctoringEnabled: false,
      totalMarks: 100,
      assessmentConfig: [{ area: 'APTITUDE', count: 20, easyPct: 30, mediumPct: 50, hardPct: 20 }],
      jobOpeningId: null,
    }
    const r = testCreateSchema.safeParse(payload)
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true)
  })

  it('accepts the edit-test form, which also sends status', () => {
    const payload = {
      title: 'Campus Drive 2026',
      description: 'updated',
      durationMinutes: 90,
      passingMarks: 40,
      isWalkIn: true,
      proctoringEnabled: true,
      status: 'ACTIVE',
      totalMarks: 100,
      assessmentConfig: [{ area: 'PYTHON', count: 10, easyPct: 30, mediumPct: 50, hardPct: 20 }],
      jobOpeningId: null,
    }
    const r = testUpdateSchema.safeParse(payload)
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true)
  })

  it('accepts the college form with every optional field left empty', () => {
    const payload = {
      name: 'MIT College of Engineering',
      address: '', city: '', state: '', contactEmail: '', contactPhone: '',
      isActive: true,
    }
    const r = collegeCreateSchema.safeParse(payload)
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true)
  })

  it("accepts the question-bank form's emptyQ() shape once filled in", () => {
    const payload = {
      area: 'APTITUDE',
      questionText: 'What is 2 + 2?',
      optionA: '3', optionB: '4', optionC: '5', optionD: '6',
      correctAnswer: 'A',
      weightage: 1,
      difficulty: 'MEDIUM',
    }
    const r = questionCreateSchema.safeParse(payload)
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true)
  })

  it('accepts the job-openings form and its PATCH body', () => {
    const create = jobOpeningCreateSchema.safeParse({
      title: 'Graduate Trainee',
      description: '', location: '', openings: 1,
      requiredSkills: [], niceToHaveSkills: [],
    })
    expect(create.success, JSON.stringify(create.success ? '' : create.error.issues)).toBe(true)

    // The activate/deactivate toggle sends this one field alone.
    expect(jobOpeningUpdateSchema.safeParse({ isActive: false }).success).toBe(true)
  })
})
