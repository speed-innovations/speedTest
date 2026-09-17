import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * Authorization and integrity helpers for student test attempts.
 *
 * Every attempt-scoped route takes an `attemptId` from the request body. Without
 * these checks any signed-in student can act on any other student's attempt, so
 * ownership must be verified server-side on every single call.
 */

/** Thrown by the require* helpers; convert with `errorResponse`. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * Convert a thrown error into a response.
 *
 * HttpError becomes its own status and message; anything else is logged and
 * reported as a generic 500, so internal failures never leak to the client.
 */
export function errorResponse(err: unknown, label: string, fallback: string): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error(`${label}:`, err)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export interface StudentContext {
  userId: string
  studentId: string
  collegeId: string
}

/** Resolve the signed-in STUDENT and their profile. */
export async function requireStudent(): Promise<StudentContext> {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'STUDENT') {
    throw new HttpError(401, 'Unauthorized')
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user!.email! },
    select: { id: true, studentProfile: { select: { id: true, collegeId: true } } },
  })
  if (!user?.studentProfile) {
    throw new HttpError(404, 'Student profile not found')
  }
  return {
    userId: user.id,
    studentId: user.studentProfile.id,
    collegeId: user.studentProfile.collegeId,
  }
}

function assertAttemptId(attemptId: unknown): string {
  if (typeof attemptId !== 'string' || attemptId.length === 0) {
    throw new HttpError(400, 'Missing attemptId')
  }
  return attemptId
}

/**
 * Load a scheduled attempt, asserting it belongs to `studentId` and to the
 * schedule named in the URL. Both checks matter: the first stops cross-student
 * tampering, the second stops an attempt from one schedule being driven through
 * another schedule's route.
 */
export async function requireScheduledAttempt(
  attemptId: unknown,
  scheduleId: string,
  studentId: string
) {
  const id = assertAttemptId(attemptId)
  const attempt = await prisma.testAttempt.findUnique({
    where: { id },
    include: { schedule: { include: { test: true } } },
  })
  if (!attempt) throw new HttpError(404, 'Attempt not found')
  if (attempt.studentId !== studentId || attempt.scheduleId !== scheduleId) {
    // Deliberately identical to the not-found message: do not confirm that an
    // attempt id exists to someone who does not own it.
    throw new HttpError(404, 'Attempt not found')
  }
  return attempt
}

/** Walk-in equivalent of `requireScheduledAttempt`. */
export async function requireWalkInAttempt(
  attemptId: unknown,
  testId: string,
  studentId: string
) {
  const id = assertAttemptId(attemptId)
  const attempt = await prisma.walkInAttempt.findUnique({
    where: { id },
    include: { test: true },
  })
  if (!attempt) throw new HttpError(404, 'Attempt not found')
  if (attempt.studentId !== studentId || attempt.testId !== testId) {
    throw new HttpError(404, 'Attempt not found')
  }
  return attempt
}

/** Clock skew and in-flight request allowance past the hard deadline. */
export const SUBMIT_GRACE_MS = 60_000

/** True if the attempt has an expiry and we are past it (plus grace). */
export function isPastDeadline(expiresAt: Date | null, graceMs = SUBMIT_GRACE_MS): boolean {
  if (!expiresAt) return false
  return Date.now() > expiresAt.getTime() + graceMs
}

/** Whole seconds left, floored at 0. Null expiry means "not started". */
export function remainingSeconds(expiresAt: Date | null): number {
  if (!expiresAt) return 0
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
}

const VALID_OPTIONS = new Set(['A', 'B', 'C', 'D'])

/**
 * Reduce a client-supplied answer map to what is actually gradeable: only
 * questions assigned to this attempt, only well-formed option letters.
 *
 * Grading must never be driven by the raw request body — a client that can name
 * arbitrary question ids can award itself marks for questions it was never served.
 */
export function sanitizeAnswers(
  raw: unknown,
  assignedQuestionIds: string[]
): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const assigned = new Set(assignedQuestionIds)
  const clean: Record<string, string> = {}
  for (const [questionId, answer] of Object.entries(raw as Record<string, unknown>)) {
    if (!assigned.has(questionId)) continue
    if (typeof answer !== 'string') continue
    const normalized = answer.trim().toUpperCase()
    if (!VALID_OPTIONS.has(normalized)) continue
    clean[questionId] = normalized
  }
  return clean
}

/** Read an attempt's persisted question set defensively (it is a Json column). */
export function assignedQuestionIds(questionIds: unknown): string[] {
  if (!Array.isArray(questionIds)) return []
  return questionIds.filter((id): id is string => typeof id === 'string')
}
