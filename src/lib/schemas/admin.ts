import { z } from 'zod'
import { AREAS } from '@/lib/areas'

/**
 * Validation for admin write routes.
 *
 * These endpoints previously handed the request body straight to Prisma. The
 * damage that does is quiet: a wrong type reaches Postgres and returns a driver
 * error that the route then leaks to the client inside a 500, and nothing stops
 * a value that is syntactically fine but semantically ruinous - see the note on
 * correctAnswer below.
 *
 * Create and update schemas are built from the same base object. Update is
 * `.partial()` throughout, because every one of these routes relies on Prisma
 * reading `undefined` as "leave this column alone" and the admin UI genuinely
 * sends single-field bodies (the tests list's walk-in and proctoring toggles
 * send two fields and one field respectively). Making update strict would break
 * them.
 */

const areaEnum = z.enum(AREAS)

/**
 * One assessment area's share of a paper.
 *
 * The schema comment on Test.assessmentConfig says {area, count, marks}; the
 * builder writes {area, count, easyPct, mediumPct, hardPct}. Both shapes are in
 * the database - the oldest row carries `marks` and no percentages - so this
 * accepts either. `marks` is kept rather than stripped: nothing reads it, but
 * silently rewriting a stored row as a side effect of an unrelated edit is not
 * something a validation change should do.
 */
export const areaConfigSchema = z
  .object({
    area: areaEnum,
    count: z.number().int().min(0).max(500),
    easyPct: z.number().min(0).max(100).optional(),
    mediumPct: z.number().min(0).max(100).optional(),
    hardPct: z.number().min(0).max(100).optional(),
    /** Legacy, unread by any code path. Preserved so an edit does not drop it. */
    marks: z.number().min(0).max(1000).optional(),
  })
  .refine(
    c => {
      const given = [c.easyPct, c.mediumPct, c.hardPct].filter(v => v !== undefined)
      if (given.length === 0) return true // legacy row, no mix specified
      if (given.length !== 3) return false // a partial mix is a bug, not a default
      return Math.abs((c.easyPct! + c.mediumPct! + c.hardPct!) - 100) < 0.01
    },
    { message: 'difficulty percentages must be absent entirely or sum to 100' }
  )

export const assessmentConfigSchema = z.array(areaConfigSchema).min(1).max(20)

/** The validated shape `pickQuestionsByConfig` consumes. */
export type AreaConfigInput = z.infer<typeof areaConfigSchema>

const testBase = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullish(),
  durationMinutes: z.number().int().min(1).max(600),
  totalMarks: z.number().min(0).max(10_000),
  passingMarks: z.number().min(0).max(10_000),
  status: z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
  isWalkIn: z.boolean().optional(),
  isActive: z.boolean().optional(),
  jobOpeningId: z.string().max(64).nullish(),
  companyPptUrl: z.string().max(2000).nullish(),
  proctoringEnabled: z.boolean().optional(),
  assessmentConfig: assessmentConfigSchema,
})

const marksWithinTotal = (t: { passingMarks?: number; totalMarks?: number }) =>
  t.passingMarks === undefined || t.totalMarks === undefined || t.passingMarks <= t.totalMarks

export const testCreateSchema = testBase.refine(marksWithinTotal, {
  message: 'passingMarks cannot exceed totalMarks',
  path: ['passingMarks'],
})

// Partial, and the marks check only fires when both are present in the body.
// A PUT that sends passingMarks alone cannot be checked against a totalMarks it
// did not send, and refusing it would break editing a field at a time.
export const testUpdateSchema = testBase.partial().refine(marksWithinTotal, {
  message: 'passingMarks cannot exceed totalMarks',
  path: ['passingMarks'],
})

const collegeBase = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).nullish(),
  city: z.string().max(100).nullish(),
  state: z.string().max(100).nullish(),
  // The form posts '' for an untouched field; the routes already map that to
  // null. Accepting it here keeps that behaviour rather than rejecting a form
  // that works today.
  contactEmail: z.union([z.string().email().max(200), z.literal('')]).nullish(),
  contactPhone: z.string().max(32).nullish(),
  isActive: z.boolean().optional(),
})

export const collegeCreateSchema = collegeBase
export const collegeUpdateSchema = collegeBase.partial()

/**
 * Note `correctAnswer: z.enum(['A','B','C','D'])`.
 *
 * Today nothing stops an admin writing "a" or "E". `gradeAttempt` compares
 * against `correctAnswer.trim().toUpperCase()`, so "E" would silently mark
 * every candidate wrong on that question with no error raised anywhere - the
 * failure only shows up as an unexplained dip in scores.
 */
const questionBase = z.object({
  area: areaEnum,
  questionText: z.string().min(1).max(10_000),
  optionA: z.string().min(1).max(2000),
  optionB: z.string().min(1).max(2000),
  optionC: z.string().min(1).max(2000),
  optionD: z.string().min(1).max(2000),
  correctAnswer: z.enum(['A', 'B', 'C', 'D']),
  weightage: z.number().min(0).max(100).optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  isActive: z.boolean().optional(),
})

export const questionCreateSchema = questionBase
export const questionUpdateSchema = questionBase.partial()

const jobOpeningBase = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).nullish(),
  location: z.string().max(200).nullish(),
  openings: z.number().int().min(0).max(100_000).optional(),
  requiredSkills: z.array(z.string().max(100)).max(100).optional(),
  niceToHaveSkills: z.array(z.string().max(100)).max(100).optional(),
  isActive: z.boolean().optional(),
})

export const jobOpeningCreateSchema = jobOpeningBase
export const jobOpeningUpdateSchema = jobOpeningBase.partial()
