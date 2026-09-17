/**
 * Scoring for test attempts.
 *
 * Grading is driven by the question set persisted on the attempt, never by the
 * keys of the client's answer payload. Every assigned question is scored, so an
 * unanswered question contributes 0 and its area still appears in areaScores.
 */

export interface GradableQuestion {
  id: string
  area: string
  correctAnswer: string
  weightage: number
}

export interface GradedResponse {
  questionId: string
  selectedAnswer: string | null
  isCorrect: boolean
  marksAwarded: number
}

export interface GradeResult {
  graded: GradedResponse[]
  totalScore: number
  areaScores: Record<string, number>
  answeredCount: number
}

export function gradeAttempt(
  questions: GradableQuestion[],
  answers: Record<string, string>
): GradeResult {
  const graded: GradedResponse[] = []
  const areaScores: Record<string, number> = {}
  let totalScore = 0
  let answeredCount = 0

  for (const q of questions) {
    const selectedAnswer = answers[q.id] ?? null
    const isCorrect =
      selectedAnswer !== null &&
      selectedAnswer === q.correctAnswer.trim().toUpperCase()
    const marksAwarded = isCorrect ? q.weightage : 0

    if (selectedAnswer !== null) answeredCount++
    totalScore += marksAwarded
    areaScores[q.area] = (areaScores[q.area] ?? 0) + marksAwarded

    graded.push({ questionId: q.id, selectedAnswer, isCorrect, marksAwarded })
  }

  return { graded, totalScore, areaScores, answeredCount }
}
