/**
 * Restores question options and answer keys from their authoritative sources,
 * matching on question text.
 *
 * Sources:
 *   PYTHON / JAVASCRIPT / AI  the generated import spreadsheets
 *   SQL / APTITUDE            the seed scripts that inserted them
 *
 * Use after a bad bulk edit: it rewrites optionA-D and correctAnswer to the
 * source values and leaves everything else alone. Rows whose text is not found
 * in any source are reported and skipped rather than guessed at.
 *
 * Note that this also reverts a deliberate shuffle-options.ts run, since that
 * moves answers off the letters the source recorded. The dry run lists how
 * many rows would change - check that number matches what you intend to undo
 * before passing --yes.
 *
 * Spreadsheet sources are passed with --sheet AREA=path (repeatable); seed
 * scripts in scripts/ are discovered automatically.
 *
 *   # dry run
 *   npx ts-node --project scripts/tsconfig.json scripts/restore-options.ts \
 *     --sheet PYTHON=../sheets/Python_QuestionBank_50.xlsx
 *
 *   # write
 *   npx ts-node --project scripts/tsconfig.json scripts/restore-options.ts \
 *     --sheet PYTHON=../sheets/Python_QuestionBank_50.xlsx --yes
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL
const prisma = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
const CONFIRM = process.argv.includes('--yes')

type Source = { optionA: string; optionB: string; optionC: string; optionD: string; correctAnswer: string }

const norm = (s: string) => (s ?? '').replace(/\r\n?/g, '\n').trim()

/**
 * Spreadsheet sources, given on the command line so this is not tied to one
 * machine's filesystem:
 *
 *   --sheet PYTHON=../sheets/python.xlsx --sheet SQL=./sql.xlsx
 *
 * Seed scripts in this repo are picked up automatically: any
 * scripts/seed-<area>.ts whose area matches a question's area.
 */
function sheetArgs(): [string, string][] {
  const out: [string, string][] = []
  process.argv.forEach((arg, i) => {
    if (arg !== '--sheet') return
    const pair = process.argv[i + 1]
    if (!pair || !pair.includes('=')) throw new Error('--sheet expects AREA=path')
    const idx = pair.indexOf('=')
    out.push([pair.slice(0, idx).trim().toUpperCase(), pair.slice(idx + 1).trim()])
  })
  return out
}

const SHEETS = sheetArgs()

// Resolved against this file's own directory, so the script works from any
// working directory rather than only the repo root.
const SEEDS: [string, string][] = readdirSync(__dirname)
  .filter(f => /^seed-[a-z0-9-]+\.ts$/i.test(f))
  .map(f => [f.replace(/^seed-|\.ts$/gi, '').toUpperCase(), join(__dirname, f)])

function fromSheet(file: string): Map<string, Source> {
  const wb = XLSX.readFile(file)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[]
  const m = new Map<string, Source>()
  for (const r of rows) {
    m.set(norm(r['Question']), {
      optionA: String(r['Option A']), optionB: String(r['Option B']),
      optionC: String(r['Option C']), optionD: String(r['Option D']),
      correctAnswer: String(r['Correct Answer']).trim().toUpperCase(),
    })
  }
  return m
}

/**
 * Pulls the QUESTIONS array out of a seed script by evaluating the array
 * literal whole - simpler and more predictable than importing the module,
 * which would run its main(). Scanning for the matching bracket rather than
 * per-line keeps it working whether entries are written on one line
 * (seed-sql.ts) or spread across several (seed-aptitude.ts).
 */
function fromSeed(file: string): Map<string, Source> {
  const text = readFileSync(file, 'utf8')
  // Anchor on the "=", not on "const QUESTIONS": the declaration reads
  // `const QUESTIONS: Q[] = [`, and the first bracket after the name belongs
  // to the type annotation, not the array.
  const decl = text.indexOf('const QUESTIONS')
  if (decl < 0) throw new Error(`${file}: no QUESTIONS declaration found`)
  const start = text.indexOf('[', text.indexOf('=', decl))
  if (start < 0) throw new Error(`${file}: no QUESTIONS array found`)

  let depth = 0, end = -1, quote: string | null = null
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '[') depth++
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error(`${file}: QUESTIONS array is not closed`)

  // eslint-disable-next-line no-eval
  const list = eval(text.slice(start, end + 1)) as any[]
  const m = new Map<string, Source>()
  for (const obj of list) {
    m.set(norm(obj.questionText), {
      optionA: obj.optionA, optionB: obj.optionB, optionC: obj.optionC, optionD: obj.optionD,
      correctAnswer: obj.correctAnswer,
    })
  }
  return m
}

async function main() {
  console.log(`target: ${(CONNECTION ?? '').replace(/^.*@/, '').replace(/\/.*$/, '') || '(unknown)'}`)

  const sources = new Map<string, Map<string, Source>>()
  for (const [area, file] of SHEETS) {
    if (!existsSync(file)) { console.log(`  missing sheet for ${area}: ${file}`); continue }
    sources.set(area, fromSheet(file))
  }
  for (const [area, file] of SEEDS) {
    if (!existsSync(file)) { console.log(`  missing seed for ${area}: ${file}`); continue }
    sources.set(area, fromSeed(file))
  }
  console.log('sources loaded:', Object.fromEntries([...sources].map(([a, m]) => [a, m.size])))

  const questions = await prisma.question.findMany({ where: { isActive: true } })
  const updates: { id: string; data: Source }[] = []
  const unmatched: string[] = []
  let alreadyCorrect = 0

  for (const q of questions) {
    const src = sources.get(q.area)?.get(norm(q.questionText))
    if (!src) { unmatched.push(`[${q.area}] ${q.questionText.replace(/\n[\s\S]*/, '').slice(0, 55)}`); continue }

    const same =
      q.optionA === src.optionA && q.optionB === src.optionB &&
      q.optionC === src.optionC && q.optionD === src.optionD &&
      q.correctAnswer === src.correctAnswer
    if (same) { alreadyCorrect++; continue }
    updates.push({ id: q.id, data: src })
  }

  // Every restored row must end up with four distinct, non-empty options.
  for (const u of updates) {
    const opts = [u.data.optionA, u.data.optionB, u.data.optionC, u.data.optionD]
    if (opts.some(o => o === undefined || o === null || !String(o).trim()))
      throw new Error(`${u.id}: source has an empty option`)
    if (new Set(opts).size !== 4) throw new Error(`${u.id}: source has duplicate options`)
    if (!['A', 'B', 'C', 'D'].includes(u.data.correctAnswer))
      throw new Error(`${u.id}: source answer "${u.data.correctAnswer}"`)
  }

  const stillBroken = questions.filter(q => {
    const o = [q.optionA, q.optionB, q.optionC, q.optionD]
    return new Set(o).size !== 4 && !updates.some(u => u.id === q.id)
  })

  console.log(`\nscanned ${questions.length} question(s)`)
  console.log(`  to restore:        ${updates.length}`)
  console.log(`  already matching:  ${alreadyCorrect}`)
  console.log(`  no source match:   ${unmatched.length}`)
  console.log(`  corrupted with no source to restore from: ${stillBroken.length}`)
  if (unmatched.length) { console.log('\nno source match:'); unmatched.forEach(u => console.log(`  ${u}`)) }

  if (!updates.length) return console.log('\nNothing to do.')
  if (!CONFIRM) return console.log('\nDRY RUN - nothing written. Re-run with --yes to restore.')

  await prisma.$transaction(
    updates.map(u => prisma.question.update({ where: { id: u.id }, data: u.data as any }))
  )
  console.log(`\nrestored ${updates.length} question(s)`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
