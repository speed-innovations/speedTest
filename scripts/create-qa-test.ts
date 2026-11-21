/**
 * Create the QA Engineering walk-in assessment.
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/create-qa-test.ts          # dry run
 *   npx ts-node --project scripts/tsconfig.json scripts/create-qa-test.ts --yes    # create
 *
 * Writes the same row POST /api/admin/tests writes for a walk-in test (status
 * ACTIVE, isWalkIn true), so it behaves exactly like one made in the builder.
 * A script rather than the UI because the admin UI needs an interactive login.
 *
 * Scoring, from the answer key: 70 questions x 1 mark = 70. Result guide -
 * 52-70 Strong, 38-51 Average, below 38 Not recommended - so passing is 38, the
 * floor of "Average". Duration is not in the key: 70 minutes, one per question.
 *
 * The config draws all 70 QA_ENGINEERING questions (all MEDIUM), so every
 * candidate gets the full paper, in shuffled order. Refuses to run unless the
 * bank holds exactly that: 70 active, MEDIUM, 1-mark questions in the area.
 *
 * Idempotent on title: an existing test with the same title is left untouched.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL
const prisma = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
const CONFIRM = process.argv.includes('--yes')

const AREA = 'QA_ENGINEERING' as const
const QUESTION_COUNT = 70

const TEST = {
  title: 'QA Engineering Assessment',
  description:
    'Objective test for QA Engineering roles: 70 questions, 1 mark each, across 14 topics ' +
    '(testing fundamentals, test design, defect management, API, SQL, automation, performance, ' +
    'security, CI/CD, AI-assisted testing and end-to-end scenarios). ' +
    'Result guide: 52-70 Strong, 38-51 Average, below 38 Not recommended.',
  durationMinutes: 70,
  totalMarks: 70,
  passingMarks: 38,
  isWalkIn: true,
  status: 'ACTIVE' as const, // what the create route sets for a walk-in test
  proctoringEnabled: false,
  jobOpeningId: null,
  assessmentConfig: [{ area: AREA, count: QUESTION_COUNT, easyPct: 0, mediumPct: 100, hardPct: 0 }],
}

async function main() {
  const host = (CONNECTION ?? '').replace(/^.*@/, '').replace(/\/.*$/, '')
  console.log(`Target: ${host}`)

  // The paper only works if the bank can serve every question the config asks for.
  const bank = await prisma.question.findMany({
    where: { area: AREA, isActive: true },
    select: { difficulty: true, weightage: true },
  })
  const medium = bank.filter(q => q.difficulty === 'MEDIUM').length
  const marks = bank.reduce((s, q) => s + q.weightage, 0)
  console.log(`Bank: ${bank.length} active ${AREA} questions, ${medium} MEDIUM, ${marks} total marks`)
  if (bank.length !== QUESTION_COUNT || medium !== QUESTION_COUNT || marks !== TEST.totalMarks) {
    console.error(`Refusing: expected ${QUESTION_COUNT} active MEDIUM questions worth ${TEST.totalMarks}. Run seed-qa.ts first.`)
    process.exit(1)
  }
  if (TEST.passingMarks > TEST.totalMarks) throw new Error('passingMarks exceeds totalMarks')

  const existing = await prisma.test.findFirst({ where: { title: TEST.title } })
  if (existing) {
    console.log(`Test already exists (id ${existing.id}, status ${existing.status}, walk-in ${existing.isWalkIn}) - nothing to do.`)
    return
  }

  console.log('Will create:', JSON.stringify(TEST, null, 2))
  if (!CONFIRM) {
    console.log('\nDry run - nothing written. Re-run with --yes to create.')
    return
  }

  const created = await prisma.test.create({ data: TEST })
  const back = await prisma.test.findUniqueOrThrow({ where: { id: created.id } })
  const cfg = back.assessmentConfig as Array<{ area: string; count: number }>
  const ok = back.isWalkIn && back.status === 'ACTIVE' && !back.proctoringEnabled &&
    back.durationMinutes === 70 && back.totalMarks === 70 && back.passingMarks === 38 &&
    cfg.length === 1 && cfg[0].area === AREA && cfg[0].count === QUESTION_COUNT
  if (!ok) {
    console.error('READ-BACK MISMATCH:', back)
    process.exit(1)
  }
  console.log(`Created and verified: ${back.title} (id ${back.id})`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
