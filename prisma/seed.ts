import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Create App Admin
  const adminPassword = await bcrypt.hash('Admin@123', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@speedinnovation.com' },
    update: {},
    create: {
      name: 'App Administrator',
      email: 'admin@speedinnovation.com',
      password: adminPassword,
      role: 'APP_ADMIN',
    }
  })
  console.log('✅ Admin created:', admin.email)

  // Create sample college - find existing or create
  let college = await prisma.college.findFirst({
    where: { name: 'MIT College of Engineering' }
  })
  if (!college) {
    college = await prisma.college.create({
      data: {
        name: 'MIT College of Engineering',
        city: 'Pune',
        state: 'Maharashtra',
        contactEmail: 'principal@mitcoe.edu.in',
        contactPhone: '+91 20 1234 5678',
      }
    })
  } else {
    // Ensure it's active
    await prisma.college.update({
      where: { id: college.id },
      data: { isActive: true }
    })
  }
  console.log('✅ College created:', college.name)

  // Create coordinator
  const coordPassword = await bcrypt.hash('Coord@123', 12)
  const coordinator = await prisma.user.upsert({
    where: { email: 'coordinator@mitcoe.edu.in' },
    update: {},
    create: {
      name: 'Placement Coordinator',
      email: 'coordinator@mitcoe.edu.in',
      password: coordPassword,
      role: 'COLLEGE_COORDINATOR',
      collegeId: college.id,
    }
  })
  console.log('✅ Coordinator created:', coordinator.email)

  // Sample questions - Aptitude
  const aptitudeQuestions = [
    {
      area: 'APTITUDE' as const,
      questionText: 'If a train travels 360 km in 4 hours, what is its speed in km/h?',
      optionA: '80', optionB: '90', optionC: '95', optionD: '100',
      correctAnswer: 'B', weightage: 1, difficulty: 'EASY',
    },
    {
      area: 'APTITUDE' as const,
      questionText: 'What is 15% of 240?',
      optionA: '32', optionB: '36', optionC: '38', optionD: '40',
      correctAnswer: 'B', weightage: 1, difficulty: 'EASY',
    },
    {
      area: 'APTITUDE' as const,
      questionText: 'Find the next number in the series: 2, 6, 12, 20, 30, ?',
      optionA: '40', optionB: '42', optionC: '44', optionD: '46',
      correctAnswer: 'B', weightage: 1, difficulty: 'MEDIUM',
    },
  ]

  // Sample questions - Python
  const pythonQuestions = [
    {
      area: 'PYTHON' as const,
      questionText: 'Which of the following is the correct way to create a list in Python?',
      optionA: 'list = {1, 2, 3}', optionB: 'list = [1, 2, 3]',
      optionC: 'list = (1, 2, 3)', optionD: 'list = <1, 2, 3>',
      correctAnswer: 'B', weightage: 1, difficulty: 'EASY',
    },
    {
      area: 'PYTHON' as const,
      questionText: 'What does the "len()" function do in Python?',
      optionA: 'Returns the type of an object',
      optionB: 'Returns the memory address',
      optionC: 'Returns the number of items in an object',
      optionD: 'Converts object to string',
      correctAnswer: 'C', weightage: 1, difficulty: 'EASY',
    },
  ]

  // Only create questions if none exist
  const existingCount = await prisma.question.count()
  if (existingCount === 0) {
    for (const q of [...aptitudeQuestions, ...pythonQuestions]) {
      await prisma.question.create({ data: q })
    }
    console.log(`✅ ${aptitudeQuestions.length + pythonQuestions.length} sample questions created`)
  } else {
    console.log(`⏭️ Questions already exist (${existingCount}), skipping`)
  }

  // Sample job opening - only if none exist
  const existingJobs = await prisma.jobOpening.count()
  if (existingJobs === 0) {
    const job = await prisma.jobOpening.create({
      data: {
        title: 'Software Engineer - Graduate Trainee',
        description: 'Join our engineering team to build innovative solutions.',
        location: 'Pune / Bangalore',
        openings: 25,
        requiredSkills: ['Python', 'Problem Solving', 'Data Structures'],
        niceToHaveSkills: ['AI/ML', '.NET', 'Cloud Computing'],
      }
    })
    console.log('✅ Job opening created:', job.title)
  } else {
    console.log(`⏭️ Job openings already exist (${existingJobs}), skipping`)
  }

  console.log('\n🎉 Seed complete!')
  console.log('\n📋 Login Credentials:')
  console.log('  Admin:       admin@speedinnovation.com / Admin@123')
  console.log('  Coordinator: coordinator@mitcoe.edu.in / Coord@123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
