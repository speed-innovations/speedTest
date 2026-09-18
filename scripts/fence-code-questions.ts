/**
 * Wraps the code half of existing questions in a ```language fence.
 *
 * Questions were originally stored as "prose\n\ncode", which the exam UI could
 * only render as flat text. QuestionText renders a fenced block in a
 * highlighted box with indentation intact, so this backfills the fence on rows
 * written before that existed.
 *
 * Only rows whose trailing block actually looks like code are touched, and a
 * row that already contains a fence is left alone, so the script is safe to
 * re-run.
 *
 *   npx ts-node --project scripts/tsconfig.json scripts/fence-code-questions.ts          # dry run
 *   npx ts-node --project scripts/tsconfig.json scripts/fence-code-questions.ts --yes    # write
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const CONNECTION = process.env.DIRECT_URL ?? process.env.DATABASE_URL
const prisma = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
const CONFIRM = process.argv.includes('--yes')

const AREA_LANGUAGE: Record<string, string> = {
  PYTHON: 'python',
  JAVASCRIPT: 'javascript',
  SQL: 'sql',
  JAVA: 'java',
  DOTNET: 'csharp',
}

/**
 * Does this block read as source code rather than prose? Deliberately strict:
 * mislabelling an English sentence as code is far more visible to a candidate
 * than leaving a snippet unfenced, so every signal here is one that ordinary
 * question prose does not produce.
 */
function looksLikeCode(block: string): boolean {
  const lines = block.split('\n')
  return (
    /\n[ \t]+\S/.test(block) ||                       // an indented continuation line
    /^\s*(?:def|class|for|while|if|import|from)\b/m.test(block) ||
    /\bprint\s*\(|\bconsole\.log\s*\(/.test(block) ||
    /^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE)\b/im.test(block) ||
    // A bare expression such as "2 ** 3 + 5 ** 2": no words at all, but
    // digits joined by operators. Prose cannot look like this.
    (!/[A-Za-z]/.test(block) && /\d/.test(block) && /[-+*/%<>=&|^]/.test(block)) ||
    (lines.length > 1 && lines.filter(l => /[=;{}()]/.test(l)).length >= lines.length / 2)
  )
}

async function main() {
  const url = CONNECTION ?? ''
  console.log(`target: ${url.replace(/^.*@/, '').replace(/\/.*$/, '') || '(unknown)'}`)

  const all = await prisma.question.findMany({
    select: { id: true, area: true, questionText: true },
  })

  const planned: { id: string; area: string; before: string; after: string }[] = []
  let alreadyFenced = 0
  let noCode = 0

  for (const q of all) {
    const text = q.questionText
    if (text.includes('```')) { alreadyFenced++; continue }

    const lang = AREA_LANGUAGE[q.area]
    if (!lang) { noCode++; continue }

    // The generator wrote "stem\n\ncode"; split on the first blank line.
    const split = text.indexOf('\n\n')
    if (split < 0) { noCode++; continue }

    const stem = text.slice(0, split).trim()
    const code = text.slice(split + 2).replace(/\s+$/, '')
    if (!code.trim() || !looksLikeCode(code)) { noCode++; continue }

    planned.push({ id: q.id, area: q.area, before: text, after: `${stem}\n\n\`\`\`${lang}\n${code}\n\`\`\`` })
  }

  console.log(`scanned ${all.length} question(s): ${planned.length} to fence, ${alreadyFenced} already fenced, ${noCode} without a code block`)

  if (planned.length) {
    const sample = planned[0]
    console.log('\n--- sample rewrite ---')
    console.log(sample.after)
    console.log('----------------------')
  }

  if (!planned.length) return console.log('\nNothing to do.')
  if (!CONFIRM) return console.log('\nDRY RUN - nothing written. Re-run with --yes to apply.')

  await prisma.$transaction(
    planned.map(p => prisma.question.update({ where: { id: p.id }, data: { questionText: p.after } }))
  )
  console.log(`\nfenced ${planned.length} question(s)`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
