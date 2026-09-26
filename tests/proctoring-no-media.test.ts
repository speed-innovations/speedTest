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
  // The pages and shared components that host proctoring, and the admin
  // screens that describe it. Leaving these out is how "Records webcam ...
  // snapshots" survived in the admin test forms after recording was removed.
  'src/app/admin',
  'src/app/student',
  'src/components',
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
  // The realistic way a stream leaves the browser with no storage involved.
  [/\bRTCPeerConnection\b/, 'RTCPeerConnection'],
  [/\.captureStream\s*\(/, 'captureStream'],
]

/**
 * Claims that media is recorded, captured or kept. Checked against UI copy
 * (comments stripped) in the same roots. Honest negatives - "No video, audio
 * or screenshots are recorded or stored" - are allowed: a match whose own
 * sentence already says no/not/never/nothing is skipped.
 */
const RECORDING_CLAIMS: RegExp[] = [
  /\brecords?\s+(?:the\s+)?(?:webcam|video|audio|microphone|camera|screen)\b/gi,
  /\b(?:screen|periodic|webcam|camera)\s+snapshots?\b/gi,
  /\b(?:snapshots?|screenshots?)\s+(?:are|is|will\s+be)\s+(?:taken|stored|captured|saved|uploaded|kept)\b/gi,
  /\bevidence\s+is\s+deleted\b/gi,
  /\bdeleted\s+(?:automatically\s+)?after\s+(?:about\s+|~\s*)?(?:\d|three|a few)/gi,
]
const NEGATION = /\b(?:no|not|never|nothing|none)\b/i
/** Where a sentence or a string literal / JSX text run starts. */
const SENTENCE_BREAK = /[.!?\n>'"`]/

/** The recording claims in a piece of text, ignoring ones their own sentence negates. */
function recordingClaims(text: string): string[] {
  const found: string[] = []
  RECORDING_CLAIMS.forEach(re => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      let start = m.index
      while (start > 0 && !SENTENCE_BREAK.test(text[start - 1])) start--
      if (!NEGATION.test(text.slice(start, m.index))) found.push(m[0])
    }
  })
  return found
}

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

  it('makes no claim in UI copy that video, audio or screenshots are recorded', () => {
    const hits: string[] = []
    ROOTS.forEach(root => walk(root).forEach(file => {
      recordingClaims(stripComments(fs.readFileSync(file, 'utf8'))).forEach(c => hits.push(`${file}: "${c}"`))
    }))
    expect(hits).toEqual([])
  })

  it('the copy check catches the old recording claims and passes honest wording', () => {
    expect(recordingClaims(
      'Records webcam, microphone and periodic screen snapshots. Evidence is deleted automatically after about three days.'
    ).length).toBeGreaterThanOrEqual(3)
    expect(recordingClaims("'Enable proctoring: webcam, microphone and screen snapshots, deleted after ~3 days'").length).toBe(2)
    expect(recordingClaims('Screenshots are taken every minute.')).toEqual(['Screenshots are taken'])
    expect(recordingClaims(
      'Monitors camera, microphone and screen-sharing status. No video, audio or screenshots are recorded or stored.'
    )).toEqual([])
    expect(recordingClaims('No video, audio or screenshots are stored.')).toEqual([])
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
