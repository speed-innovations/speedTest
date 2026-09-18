/**
 * DESTRUCTIVE one-off: wipe ALL questions and ALL candidates.
 *
 * Deletes every Question and every candidate (StudentProfile + their STUDENT
 * User) together with all rows that reference them, in foreign-key order so no
 * constraint is violated. Coordinators, admins, colleges, tests, schedules,
 * job openings and shortlist criteria are LEFT INTACT.
 *
 * DATABASE_URL must point at the database you intend to wipe. This is
 * irreversible - take a backup first.
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/wipe-questions-candidates.ts          # dry run: counts only
 *   npx ts-node --project scripts/tsconfig.json scripts/wipe-questions-candidates.ts --yes    # actually delete
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

// Prefer the direct (session, :5432) connection: interactive $transaction is
// unreliable over the pgBouncer transaction pooler (:6543).
const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL
const prisma = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
const CONFIRM = process.argv.includes('--yes')

async function counts() {
  const [
    walkInResponse, candidateResponse, testQuestion, walkInEligible,
    walkInAttempt, testAttempt, question, studentProfile, studentUser,
  ] = await Promise.all([
    prisma.walkInResponse.count(),
    prisma.candidateResponse.count(),
    prisma.testQuestion.count(),
    prisma.walkInEligibleStudent.count(),
    prisma.walkInAttempt.count(),
    prisma.testAttempt.count(),
    prisma.question.count(),
    prisma.studentProfile.count(),
    prisma.user.count({ where: { role: 'STUDENT' } }),
  ])
  return {
    walkInResponse, candidateResponse, testQuestion, walkInEligible,
    walkInAttempt, testAttempt, question, studentProfile, studentUser,
  }
}

async function main() {
  const url = CONNECTION ?? ''
  const host = url.replace(/^.*@/, '').replace(/\/.*$/, '') || '(unknown)'
  const ref = (url.match(/\/\/([^:]+):/)?.[1]) ?? '(unknown)'
  console.log(`target: ${host}  ref=${ref}`)
  console.log('before:', await counts())

  if (!CONFIRM) {
    console.log('\nDRY RUN - nothing deleted. Re-run with --yes to execute.')
    return
  }

  // Children first, then parents. Everything below runs in one transaction so a
  // failure leaves the database untouched rather than half-wiped.
  const deleted = await prisma.$transaction(async (tx) => {
    const walkInResponse = await tx.walkInResponse.deleteMany()          // -> WalkInAttempt, Question
    const candidateResponse = await tx.candidateResponse.deleteMany()    // -> TestAttempt, Question
    const testQuestion = await tx.testQuestion.deleteMany()              // -> Test, Question
    const walkInEligible = await tx.walkInEligibleStudent.deleteMany()   // -> Test, StudentProfile
    const walkInAttempt = await tx.walkInAttempt.deleteMany()            // -> StudentProfile, User
    const testAttempt = await tx.testAttempt.deleteMany()                // -> StudentProfile, User
    const question = await tx.question.deleteMany()                      // now unreferenced
    const studentProfile = await tx.studentProfile.deleteMany()         // now unreferenced
    const studentUser = await tx.user.deleteMany({ where: { role: 'STUDENT' } })
    return {
      walkInResponse, candidateResponse, testQuestion, walkInEligible,
      walkInAttempt, testAttempt, question, studentProfile, studentUser,
    }
  })

  console.log('\ndeleted:', Object.fromEntries(
    Object.entries(deleted).map(([k, v]) => [k, v.count]),
  ))
  console.log('after:', await counts())
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
