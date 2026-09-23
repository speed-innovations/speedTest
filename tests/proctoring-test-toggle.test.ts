import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

/**
 * The admin toggle for Test.proctoringEnabled.
 *
 * This column decides whether a candidate is recorded, and until now nothing in
 * the product could set it - it could only be changed by writing to the
 * database by hand, which meant the feature could not be switched on in
 * production at all.
 *
 * The case that matters most here is the partial update. The tests list sends
 * single-field PUTs (the walk-in toggle sends only isWalkIn and status), so a
 * PUT that omits proctoringEnabled must leave it exactly as it was. Getting
 * that wrong would silently un-proctor a test the moment someone flipped
 * walk-in mode.
 */

const getServerSession = vi.fn()
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}))

import { prisma } from '@/lib/db'
import { POST } from '@/app/api/admin/tests/route'
import { PUT } from '@/app/api/admin/tests/[id]/route'

const TAG = `toggle-test-${Date.now()}`
const createdTestIds: string[] = []
let adminEmail = ''
let studentEmail = ''
const userIds: string[] = []

function asAdmin() {
  getServerSession.mockResolvedValue({ user: { email: adminEmail, role: 'APP_ADMIN' } })
}

function post(body: unknown): Promise<Response> {
  return POST(new Request('http://localhost/api/admin/tests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never)
}

function put(id: string, body: unknown): Promise<Response> {
  return PUT(
    new Request(`http://localhost/api/admin/tests/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) }
  )
}

const BASE = {
  title: `${TAG}-base`,
  durationMinutes: 30,
  totalMarks: 10,
  passingMarks: 5,
  assessmentConfig: [{ area: 'APTITUDE', count: 1 }],
}

async function createTest(extra: Record<string, unknown> = {}) {
  asAdmin()
  const res = await post({ ...BASE, ...extra })
  expect(res.status).toBe(201)
  const test = await res.json()
  createdTestIds.push(test.id)
  return test
}

async function readFlag(id: string): Promise<boolean> {
  const row = await prisma.test.findUniqueOrThrow({
    where: { id },
    select: { proctoringEnabled: true },
  })
  return row.proctoringEnabled
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: { email: `${TAG}-admin@example.test`, name: `${TAG}-admin`, password: 'x', role: 'APP_ADMIN' },
  })
  userIds.push(admin.id)
  adminEmail = admin.email

  const student = await prisma.user.create({
    data: { email: `${TAG}-student@example.test`, name: `${TAG}-student`, password: 'x', role: 'STUDENT' },
  })
  userIds.push(student.id)
  studentEmail = student.email
})

afterAll(async () => {
  await prisma.test.deleteMany({ where: { id: { in: createdTestIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
})

beforeEach(() => {
  getServerSession.mockReset()
})

describe('POST /api/admin/tests', () => {
  it('creates an unproctored test by default', async () => {
    const test = await createTest()
    expect(await readFlag(test.id)).toBe(false)
  })

  it('creates a proctored test when the flag is sent', async () => {
    const test = await createTest({ title: `${TAG}-on`, proctoringEnabled: true })
    expect(await readFlag(test.id)).toBe(true)
  })

  it('rejects a non-boolean proctoringEnabled outright', async () => {
    // Part 12 tightened this. It used to be accepted and silently ignored
    // (=== true, so a stringified checkbox could not switch on recording);
    // zod now rejects the request instead, which is strictly better - a form
    // sending the wrong type finds out, rather than quietly creating an
    // unproctored test the admin believes is proctored.
    asAdmin()
    for (const bad of ['true', 'false', 1]) {
      const res = await post({ ...BASE, title: `${TAG}-bad-${String(bad)}`, proctoringEnabled: bad })
      expect(res.status).toBe(400)
      asAdmin()
    }
    expect(await prisma.test.count({ where: { title: { startsWith: `${TAG}-bad-` } } })).toBe(0)
  })

  it('rejects a non-admin', async () => {
    getServerSession.mockResolvedValue({ user: { email: studentEmail, role: 'STUDENT' } })
    const res = await post({ ...BASE, title: `${TAG}-denied`, proctoringEnabled: true })

    // 403 since Part 12's retrofit: the caller is signed in, just not an admin.
    // The old inline check conflated that with "not signed in" and said 401.
    expect(res.status).toBe(403)
    expect(await prisma.test.count({ where: { title: `${TAG}-denied` } })).toBe(0)
  })
})

describe('PUT /api/admin/tests/[id]', () => {
  it('turns proctoring on and back off', async () => {
    const test = await createTest({ title: `${TAG}-flip` })

    asAdmin()
    expect((await put(test.id, { proctoringEnabled: true })).status).toBe(200)
    expect(await readFlag(test.id)).toBe(true)

    asAdmin()
    expect((await put(test.id, { proctoringEnabled: false })).status).toBe(200)
    expect(await readFlag(test.id)).toBe(false)
  })

  it('leaves the flag alone when the field is omitted', async () => {
    const test = await createTest({ title: `${TAG}-partial`, proctoringEnabled: true })

    // Exactly what the tests list sends when an admin flips walk-in mode.
    asAdmin()
    const res = await put(test.id, { isWalkIn: true, status: 'ACTIVE' })
    expect(res.status).toBe(200)

    // The regression this file exists for: flipping an unrelated toggle must
    // not silently un-proctor the test.
    expect(await readFlag(test.id)).toBe(true)

    const row = await prisma.test.findUniqueOrThrow({ where: { id: test.id } })
    expect(row.isWalkIn).toBe(true)
    // And the partial PUT must not have wiped the fields it also omitted.
    expect(row.title).toBe(`${TAG}-partial`)
    expect(row.durationMinutes).toBe(30)
  })

  it('rejects a non-boolean without touching the stored flag', async () => {
    const test = await createTest({ title: `${TAG}-junk`, proctoringEnabled: true })

    asAdmin()
    // Rejected since Part 12 rather than silently treated as "not sent". What
    // still matters either way: the stored column is not disturbed.
    expect((await put(test.id, { proctoringEnabled: 'false' })).status).toBe(400)
    expect(await readFlag(test.id)).toBe(true)
  })

  it('rejects a non-admin', async () => {
    const test = await createTest({ title: `${TAG}-put-denied` })

    getServerSession.mockResolvedValue({ user: { email: studentEmail, role: 'STUDENT' } })
    const res = await put(test.id, { proctoringEnabled: true })

    // 403 since Part 12's retrofit - signed in, but not an admin.
    expect(res.status).toBe(403)
    expect(await readFlag(test.id)).toBe(false)
  })
})
