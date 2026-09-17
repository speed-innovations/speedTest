import { describe, it, expect } from 'vitest'
import { gradeAttempt, type GradableQuestion } from '@/lib/grading'
import { sanitizeAnswers, isPastDeadline, remainingSeconds } from '@/lib/attempt-auth'

/**
 * These cover the score-manipulation path. Each test names the attack it blocks.
 */

const assigned: GradableQuestion[] = [
  { id: 'q1', area: 'APTITUDE', correctAnswer: 'B', weightage: 1 },
  { id: 'q2', area: 'APTITUDE', correctAnswer: 'C', weightage: 1 },
  { id: 'q3', area: 'PYTHON', correctAnswer: 'A', weightage: 2 },
]
const assignedIds = assigned.map(q => q.id)

describe('sanitizeAnswers', () => {
  it('drops questions that were never assigned to the attempt', () => {
    // The attack: post answers for the whole question bank to inflate the score.
    const clean = sanitizeAnswers(
      { q1: 'B', 'not-my-question': 'A', 'another-bank-question': 'D' },
      assignedIds
    )
    expect(clean).toEqual({ q1: 'B' })
  })

  it('rejects option values outside A-D', () => {
    const clean = sanitizeAnswers({ q1: 'Z', q2: '', q3: 'A' }, assignedIds)
    expect(clean).toEqual({ q3: 'A' })
  })

  it('rejects non-string answers, including objects and arrays', () => {
    const clean = sanitizeAnswers(
      { q1: { toString: () => 'B' }, q2: ['C'], q3: 'A' } as any,
      assignedIds
    )
    expect(clean).toEqual({ q3: 'A' })
  })

  it('normalizes case and surrounding whitespace', () => {
    expect(sanitizeAnswers({ q1: ' b ' }, assignedIds)).toEqual({ q1: 'B' })
  })

  it('returns an empty map for null, undefined and non-objects', () => {
    expect(sanitizeAnswers(null, assignedIds)).toEqual({})
    expect(sanitizeAnswers(undefined, assignedIds)).toEqual({})
    expect(sanitizeAnswers('B', assignedIds)).toEqual({})
  })

  it('assigns nothing when the attempt has no persisted question set', () => {
    expect(sanitizeAnswers({ q1: 'B' }, [])).toEqual({})
  })
})

describe('gradeAttempt', () => {
  it('scores only assigned questions, so extra answers cannot add marks', () => {
    const result = gradeAttempt(assigned, { q1: 'B', q2: 'C', q3: 'A', qEXTRA: 'A' })
    expect(result.totalScore).toBe(4) // 1 + 1 + 2, nothing for qEXTRA
    expect(result.graded).toHaveLength(3)
  })

  it('caps the score at the assigned total even with every answer correct', () => {
    const maxPossible = assigned.reduce((s, q) => s + q.weightage, 0)
    const result = gradeAttempt(assigned, { q1: 'B', q2: 'C', q3: 'A' })
    expect(result.totalScore).toBe(maxPossible)
  })

  it('records unanswered questions as zero rather than omitting them', () => {
    const result = gradeAttempt(assigned, { q1: 'B' })
    expect(result.totalScore).toBe(1)
    expect(result.graded).toHaveLength(3)
    expect(result.answeredCount).toBe(1)
    const q3 = result.graded.find(g => g.questionId === 'q3')!
    expect(q3.selectedAnswer).toBeNull()
    expect(q3.isCorrect).toBe(false)
    expect(q3.marksAwarded).toBe(0)
  })

  it('applies per-question weightage', () => {
    const result = gradeAttempt(assigned, { q3: 'A' })
    expect(result.totalScore).toBe(2)
  })

  it('breaks the total down by area, including areas scoring zero', () => {
    const result = gradeAttempt(assigned, { q1: 'B' })
    expect(result.areaScores).toEqual({ APTITUDE: 1, PYTHON: 0 })
  })

  it('grades an empty answer set as zero, not as a crash', () => {
    const result = gradeAttempt(assigned, {})
    expect(result.totalScore).toBe(0)
    expect(result.answeredCount).toBe(0)
  })

  it('tolerates a stored correctAnswer with stray case or whitespace', () => {
    const odd: GradableQuestion[] = [
      { id: 'q1', area: 'APTITUDE', correctAnswer: ' b ', weightage: 1 },
    ]
    expect(gradeAttempt(odd, { q1: 'B' }).totalScore).toBe(1)
  })
})

describe('deadline helpers', () => {
  it('treats an attempt with no expiry as not expired', () => {
    expect(isPastDeadline(null)).toBe(false)
  })

  it('allows a submit inside the grace window', () => {
    const justExpired = new Date(Date.now() - 10_000)
    expect(isPastDeadline(justExpired)).toBe(false)
  })

  it('rejects a submit well past the grace window', () => {
    const longExpired = new Date(Date.now() - 10 * 60_000)
    expect(isPastDeadline(longExpired)).toBe(true)
  })

  it('never reports negative time remaining', () => {
    expect(remainingSeconds(new Date(Date.now() - 60_000))).toBe(0)
  })

  it('reports remaining seconds for a live attempt', () => {
    const value = remainingSeconds(new Date(Date.now() + 120_000))
    expect(value).toBeGreaterThan(115)
    expect(value).toBeLessThanOrEqual(120)
  })
})
