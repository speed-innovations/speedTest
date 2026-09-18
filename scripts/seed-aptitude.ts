/**
 * One-off: insert a batch of APTITUDE questions into the Question bank.
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/seed-aptitude.ts          # dry run
 *   npx ts-node --project scripts/tsconfig.json scripts/seed-aptitude.ts --yes    # insert
 *
 * Writes through DIRECT_URL (session, :5432), not the pgBouncer pooler.
 */
import 'dotenv/config'
import { PrismaClient, AssessmentArea } from '@prisma/client'

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL
const prisma = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
const CONFIRM = process.argv.includes('--yes')

type Q = {
  questionText: string
  optionA: string; optionB: string; optionC: string; optionD: string
  correctAnswer: 'A' | 'B' | 'C' | 'D'
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
}

const QUESTIONS: Q[] = [
  {
    questionText: 'Type A, 12 kg of rice worth Rs. 40/kg is mixed with Type B rice worth Rs. 24/kg. What should be the quantity of Type B rice, if the mixture is sold at Rs. 45/kg with 25% profit added in it?',
    optionA: '18 Kg', optionB: '48 Kg', optionC: '4 Kg', optionD: "can't say",
    correctAnswer: 'C', difficulty: 'MEDIUM',
  },
  {
    questionText: 'A person spends 1/7th of his salary on travel, 1/3rd of the remaining on food, he then spends 1/4th of the remaining on rent. Finally he puts 1/6th of the remaining as a monthly savings, after which he has 25000 left. What is his salary (in Rs.)?',
    optionA: '70,000', optionB: '14,000', optionC: '84,000', optionD: '26,000',
    correctAnswer: 'A', difficulty: 'MEDIUM',
  },
  {
    questionText: 'Point C(x,y) divides the distance AB with point A(8,12) and point B(16,18) in a ratio of 3:5, with AC being shorter than BC. What are the co-ordinates of C?',
    optionA: '(12,15)', optionB: '(14.5, 12.5)', optionC: '(13,16.5)', optionD: '(11,14.25)',
    correctAnswer: 'D', difficulty: 'MEDIUM',
  },
  {
    questionText: 'How many terms of the sequence -12, -8, -4, … and so on, are needed to make a sum of 120?',
    optionA: '11', optionB: '12', optionC: '10', optionD: '13',
    correctAnswer: 'B', difficulty: 'MEDIUM',
  },
  {
    questionText: 'The value of a machine depreciates from Rs 32,768 to Rs 21,952 in three years. What is the rate % of depreciation?',
    optionA: '11%', optionB: '12.25%', optionC: '12.5%', optionD: '33%',
    correctAnswer: 'C', difficulty: 'MEDIUM',
  },
  {
    questionText: 'A TV set listed at Rs 3200 is sold to a retailer at a successive discount of 25% and 15%. The retailer desires a profit of 20%, after allowing a discount of 10% to the customer. At what price should he list the TV set (in Rs.)?',
    optionA: '2720', optionB: '2448', optionC: '2040', optionD: '2133',
    correctAnswer: 'A', difficulty: 'HARD',
  },
  {
    // NOTE: original said "10 out of 12"; that yields 56, which is not an
    // option. The options fit "10 out of 13" (answer 196), so corrected here.
    questionText: 'A student is to answer 10 out of 13 questions in an examination such that he must choose at least 4 from the first five questions. The number of choices available to him is',
    optionA: '140', optionB: '280', optionC: '196', optionD: '346',
    correctAnswer: 'C', difficulty: 'HARD',
  },
  {
    questionText: 'A rectangular playground with the dimension of 50m X 30m is surrounded by a 5 m wide road on all the sides. What is the area of the road?',
    optionA: '600 sq. m.', optionB: '500 sq. m.', optionC: '450 sq. m.', optionD: '900 sq. m.',
    correctAnswer: 'D', difficulty: 'EASY',
  },
  {
    questionText: "It takes 5 sec. for a clock to strike at 5 o'clock. If the striking intervals are uniform, how much time will it take to strike 9 o'clock (in sec.)?",
    optionA: '9', optionB: '10', optionC: '11', optionD: '12',
    correctAnswer: 'B', difficulty: 'EASY',
  },
  {
    questionText: 'From the top of a tower which is 240m high, if the angle of depression of a point on the ground is 30°, then the distance of the point from the foot of the tower is',
    optionA: '40√3', optionB: '80√3', optionC: '120√3', optionD: '240√3',
    correctAnswer: 'D', difficulty: 'EASY',
  },
]

async function main() {
  const host = (CONNECTION ?? '').replace(/^.*@/, '').replace(/\/.*$/, '')
  console.log(`target: ${host}`)
  console.log(`questions in file: ${QUESTIONS.length}`)
  const before = await prisma.question.count({ where: { area: AssessmentArea.APTITUDE } })
  console.log(`existing APTITUDE questions: ${before}`)

  if (!CONFIRM) {
    console.log('\nDRY RUN - nothing inserted. Re-run with --yes to execute.')
    return
  }

  const result = await prisma.question.createMany({
    data: QUESTIONS.map(q => ({
      area: AssessmentArea.APTITUDE,
      questionText: q.questionText,
      optionA: q.optionA, optionB: q.optionB, optionC: q.optionC, optionD: q.optionD,
      correctAnswer: q.correctAnswer,
      weightage: 1,
      difficulty: q.difficulty,
      tags: [],
      isActive: true,
    })),
  })

  const after = await prisma.question.count({ where: { area: AssessmentArea.APTITUDE } })
  console.log(`\ninserted: ${result.count}`)
  console.log(`APTITUDE questions now: ${after}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
