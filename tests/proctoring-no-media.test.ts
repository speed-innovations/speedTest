import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Enforces the phase's non-negotiables (spec N1/N2): no media capture,
 * encoding, upload or storage anywhere in proctoring, and no storage
 * dependency. Comments are stripped first, so explaining what we do not do
 * does not trip it.
 */

const ROOTS = [
  'src/lib/proctoring',
  'src/components/proctoring',
  'src/app/api/student/proctoring',
  'src/app/api/admin/proctoring',
]

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bMediaRecorder\b/, 'MediaRecorder'],
  [/\.toBlob\s*\(/, 'canvas.toBlob'],
  [/\.toDataURL\s*\(/, 'canvas.toDataURL'],
  [/\bgetImageData\s*\(/, 'getImageData'],
  [/\bImageCapture\b/, 'ImageCapture'],
  [/@aws-sdk\//, 'AWS SDK'],
  [/\bR2_[A-Z_]+/, 'R2 configuration'],
  [/upload-url|asset-complete|download-url/, 'media upload endpoints'],
  [/\bcreateUploadUrl\b|\bputObject\b|\bgetStorage\b/, 'object storage calls'],
  [/\bproctoringAsset\b/, 'the dropped ProctoringAsset table'],
]

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).reduce<string[]>((acc, entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return acc.concat(walk(full))
    return /\.(ts|tsx)$/.test(entry.name) ? acc.concat(full) : acc
  }, [])
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('metadata-only proctoring', () => {
  it('has no media capture, encoding, upload or storage code', () => {
    const hits: string[] = []
    ROOTS.forEach(root => walk(root).forEach(file => {
      const code = stripComments(fs.readFileSync(file, 'utf8'))
      FORBIDDEN.forEach(([re, what]) => { if (re.test(code)) hits.push(`${file}: ${what}`) })
    }))
    expect(hits).toEqual([])
  })

  it('declares no storage SDK dependency', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> }
    expect(Object.keys(pkg.dependencies ?? {}).filter(d => d.indexOf('@aws-sdk/') === 0)).toEqual([])
  })

  it('ships no storage credentials or budget in .env.example', () => {
    const env = fs.readFileSync('.env.example', 'utf8')
    expect(env).not.toMatch(/^R2_/m)
    expect(env).not.toMatch(/PROCTORING_STORAGE|SAFETY_BYTES|BITS_PER_SECOND|SCREENSHOT_INTERVAL/)
  })

  it('has no media or storage routes on disk', () => {
    ['src/app/api/student/proctoring/upload-url', 'src/app/api/student/proctoring/asset-complete',
      'src/app/api/admin/proctoring/assets', 'src/app/api/admin/proctoring/usage',
    ].forEach(p => expect(fs.existsSync(p)).toBe(false))
  })
})
