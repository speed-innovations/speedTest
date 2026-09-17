import { prisma } from '@/lib/db'

interface AreaConfig {
  area: string
  count: number
  easyPct?: number
  mediumPct?: number
  hardPct?: number
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function normDifficulty(d: string | null | undefined): 'EASY' | 'MEDIUM' | 'HARD' {
  const v = (d || '').toString().trim().toUpperCase()
  if (v === 'EASY' || v === 'MEDIUM' || v === 'HARD') return v as 'EASY' | 'MEDIUM' | 'HARD'
  return 'MEDIUM' // default unknowns to medium
}

/**
 * Pick questions from the bank per area, respecting difficulty percentage mix.
 * Optimized: single DB query for all areas.
 */
export async function pickQuestionsByConfig(config: AreaConfig[]): Promise<string[]> {
  const questionIds: string[] = []

  // Fetch all questions for all areas in a single query
  const allAreas = config.map(c => c.area)
  const allQuestions = await prisma.question.findMany({
    where: { area: { in: allAreas as any[] }, isActive: true },
    select: { id: true, area: true, difficulty: true }
  })

  // Group by area+difficulty (normalize difficulty to handle case/null issues)
  const grouped: Record<string, { EASY: string[]; MEDIUM: string[]; HARD: string[]; ALL: string[] }> = {}
  for (const q of allQuestions) {
    if (!grouped[q.area]) grouped[q.area] = { EASY: [], MEDIUM: [], HARD: [], ALL: [] }
    const diff = normDifficulty(q.difficulty)
    grouped[q.area][diff].push(q.id)
    grouped[q.area].ALL.push(q.id)
  }

  for (const areaConfig of config) {
    const totalNeeded = areaConfig.count
    const areaGroup = grouped[areaConfig.area] || { EASY: [], MEDIUM: [], HARD: [], ALL: [] }
    const easyPct = areaConfig.easyPct ?? 0
    const mediumPct = areaConfig.mediumPct ?? 0
    const hardPct = areaConfig.hardPct ?? 0
    const hasDifficultyConfig = easyPct > 0 || mediumPct > 0 || hardPct > 0

    if (!hasDifficultyConfig) {
      const shuffled = shuffle(areaGroup.ALL)
      const picked = shuffled.slice(0, totalNeeded)
      questionIds.push(...picked)
      if (picked.length < totalNeeded) {
        console.warn(`⚠️ Question bank insufficient for ${areaConfig.area}: needed ${totalNeeded}, got ${picked.length}`)
      }
      continue
    }

    let easyCount = Math.round(totalNeeded * easyPct / 100)
    let mediumCount = Math.round(totalNeeded * mediumPct / 100)
    let hardCount = Math.round(totalNeeded * hardPct / 100)

    // Adjust rounding so total matches exactly
    const diff = totalNeeded - (easyCount + mediumCount + hardCount)
    if (diff > 0) mediumCount += diff
    else if (diff < 0) {
      if (mediumCount >= easyCount && mediumCount >= hardCount) mediumCount += diff
      else if (easyCount >= hardCount) easyCount += diff
      else hardCount += diff
    }

    const picked: string[] = []
    const pickedSet = new Set<string>()

    // Pick exact count per difficulty
    for (const [difficulty, needed] of [['EASY', easyCount], ['MEDIUM', mediumCount], ['HARD', hardCount]] as const) {
      const n = needed as number
      if (n <= 0) continue
      const pool = shuffle(areaGroup[difficulty as 'EASY' | 'MEDIUM' | 'HARD'] || [])
      let count = 0
      for (const id of pool) {
        if (count >= n) break
        if (pickedSet.has(id)) continue
        picked.push(id)
        pickedSet.add(id)
        count++
      }
    }

    // Fill shortfall from any difficulty in this area
    if (picked.length < totalNeeded) {
      const remaining = totalNeeded - picked.length
      const fallback = shuffle(areaGroup.ALL.filter(id => !pickedSet.has(id)))
      const filled = fallback.slice(0, remaining)
      picked.push(...filled)
      pickedSet.clear()
      picked.forEach(id => pickedSet.add(id))
    }

    if (picked.length < totalNeeded) {
      console.warn(`⚠️ Question bank insufficient for ${areaConfig.area}: needed ${totalNeeded}, got ${picked.length} (bank has ${areaGroup.ALL.length} total)`)
    }

    // Never exceed the requested count
    questionIds.push(...picked.slice(0, totalNeeded))
  }

  // Final safety: if STILL short across all areas, fall back to ANY active question
  const totalConfigured = config.reduce((sum, c) => sum + c.count, 0)
  if (questionIds.length < totalConfigured) {
    const already = new Set(questionIds)
    const fallbackAll = await prisma.question.findMany({
      where: { isActive: true, id: { notIn: questionIds } },
      select: { id: true }
    })
    const shortfall = totalConfigured - questionIds.length
    const extra = shuffle(fallbackAll.map(q => q.id)).slice(0, shortfall)
    questionIds.push(...extra)
    if (extra.length < shortfall) {
      console.warn(`⚠️ Total bank cannot fulfill test: needed ${totalConfigured}, got ${questionIds.length}`)
    }
  }

  return shuffle(questionIds)
}
