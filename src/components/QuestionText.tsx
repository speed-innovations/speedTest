'use client'

/**
 * Renders a question's text, splitting prose from code.
 *
 * Code is authored as a fenced block inside `questionText`, the way it is
 * written in Markdown:
 *
 *     What will be the output of the following code snippet?
 *
 *     ```python
 *     for i in range(3):
 *         print(i)
 *     ```
 *
 * Prose renders as ordinary wrapped text; each fence renders as a highlighted,
 * horizontally scrollable box that preserves indentation exactly. Indentation
 * is load-bearing in most output-prediction questions - a snippet whose
 * leading spaces are collapsed by HTML is unanswerable - so the code path
 * never goes through normal whitespace handling.
 *
 * Text with no fences renders entirely as prose, with newlines preserved. That
 * keeps every non-code question, and any legacy row written before fencing,
 * looking exactly as it did.
 */

import { Highlight, Prism, type Language } from 'prism-react-renderer'

// prism-react-renderer bundles python, sql, javascript/jsx and clike, but not
// java or c#. Both are clike dialects, so registering them here covers the
// JAVA and DOTNET assessment areas without pulling in the whole prismjs
// package for two grammars.
const clike = (Prism.languages as any).clike
if (clike && !(Prism.languages as any).java) {
  ;(Prism.languages as any).java = {
    ...clike,
    keyword: /\b(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|var|record|sealed|yield)\b/,
    'class-name': /\b[A-Z]\w*\b/,
    annotation: { pattern: /(^|[^.])@\w+/, lookbehind: true, alias: 'punctuation' },
    number: /\b0b[01][01_]*L?\b|\b0x[\da-f_]*\.?[\da-f_p+-]+\b|(?:\b\d[\d_]*\.?[\d_]*|\B\.\d[\d_]*)(?:e[+-]?\d[\d_]*)?[dfl]?/i,
  }
}
if (clike && !(Prism.languages as any).csharp) {
  ;(Prism.languages as any).csharp = {
    ...clike,
    keyword: /\b(?:abstract|as|async|await|base|bool|break|byte|case|catch|char|checked|class|const|continue|decimal|default|delegate|do|double|else|enum|event|explicit|extern|false|finally|fixed|float|for|foreach|goto|if|implicit|in|int|interface|internal|is|lock|long|namespace|new|null|object|operator|out|override|params|private|protected|public|readonly|ref|return|sbyte|sealed|short|sizeof|stackalloc|static|string|struct|switch|this|throw|true|try|typeof|uint|ulong|unchecked|unsafe|ushort|using|var|virtual|void|volatile|while|yield|record)\b/,
    'class-name': /\b[A-Z]\w*\b/,
    string: [
      { pattern: /(^|[^$\\])\$@"(?:""|\\[\s\S]|[^\\"])*"/, lookbehind: true, greedy: true },
      { pattern: /(^|[^@\\])"(?:\\.|[^\\"\r\n])*"/, lookbehind: true, greedy: true },
    ],
  }
}

// Areas map onto grammars; anything unlisted falls back to unhighlighted (but
// still correctly indented) text rather than guessing wrong.
const AREA_LANGUAGE: Record<string, string> = {
  PYTHON: 'python',
  JAVASCRIPT: 'javascript',
  SQL: 'sql',
  JAVA: 'java',
  DOTNET: 'csharp',
}

const ALIASES: Record<string, string> = {
  py: 'python', py3: 'python', python3: 'python',
  js: 'javascript', node: 'javascript', ts: 'javascript', typescript: 'javascript',
  cs: 'csharp', 'c#': 'csharp', dotnet: 'csharp', csharp: 'csharp',
  postgres: 'sql', postgresql: 'sql', mysql: 'sql', plsql: 'sql',
}

function resolveLanguage(tag: string | undefined, area?: string): string | null {
  const t = (tag || '').trim().toLowerCase()
  const named = ALIASES[t] ?? t
  if (named && (Prism.languages as any)[named]) return named
  // An untagged fence inherits the language of the assessment area, which is
  // right far more often than it is wrong for a single-language question bank.
  const byArea = area ? AREA_LANGUAGE[area.toUpperCase()] : undefined
  return byArea && (Prism.languages as any)[byArea] ? byArea : null
}

const LABELS: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', sql: 'SQL', java: 'Java', csharp: 'C#',
}

// A muted light theme: exam UI is light, and high-saturation code themes fight
// the surrounding page for attention.
const THEME = {
  plain: { color: '#1f2937', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#7c8a9b', fontStyle: 'italic' as const } },
    { types: ['punctuation'], style: { color: '#64748b' } },
    { types: ['property', 'tag', 'constant', 'symbol', 'deleted'], style: { color: '#b91c1c' } },
    { types: ['boolean', 'number'], style: { color: '#b45309' } },
    { types: ['selector', 'attr-name', 'string', 'char', 'builtin', 'inserted'], style: { color: '#047857' } },
    { types: ['operator', 'entity', 'url', 'variable'], style: { color: '#0f766e' } },
    { types: ['atrule', 'attr-value', 'keyword'], style: { color: '#7c3aed', fontWeight: '600' as const } },
    { types: ['function', 'class-name'], style: { color: '#1d4ed8' } },
    { types: ['annotation'], style: { color: '#9333ea' } },
    { types: ['regex', 'important'], style: { color: '#c2410c' } },
  ],
}

function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const label = language ? LABELS[language] ?? language : null

  return (
    <div className="my-3 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
      {label && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 bg-gray-100/70">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
        </div>
      )}
      {/* overflow-x-auto keeps a long line from widening the whole question
          card; whitespace-pre (not pre-wrap) means a wrapped line can never be
          mistaken for a new statement. */}
      <div className="overflow-x-auto">
        {language ? (
          <Highlight code={code} language={language as Language} theme={THEME as any}>
            {({ style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className="px-3 py-2.5 text-[13px] leading-[1.6] font-mono whitespace-pre"
                style={{ ...style, backgroundColor: 'transparent', margin: 0 }}
              >
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    {line.map((token, k) => (
                      <span key={k} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        ) : (
          <pre className="px-3 py-2.5 text-[13px] leading-[1.6] font-mono whitespace-pre text-gray-800 m-0">
            {code}
          </pre>
        )}
      </div>
    </div>
  )
}

type Segment = { type: 'text'; value: string } | { type: 'code'; value: string; tag?: string }

const OPEN_FENCE = /^[ \t]*```[ \t]*([\w#+-]*)[ \t]*$/
const CLOSE_FENCE = /^[ \t]*```[ \t]*$/

/**
 * Splits text on ``` fences. An unterminated fence runs to the end, so a
 * half-typed question still previews sensibly while the admin is writing it.
 *
 * This scans lines rather than running one regex over the whole string: a
 * lazy `[\s\S]*?` paired with a multiline `$` stops at the first line break,
 * which silently truncated every snippet to its opening line.
 */
export function parseQuestionText(text: string): Segment[] {
  // Normalise line endings once. A snippet pasted from Windows or from a
  // spreadsheet arrives as CRLF, and a stray \r renders as a blank glyph.
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const segments: Segment[] = []
  let buffer: string[] = []
  let code: { tag?: string; lines: string[] } | null = null

  const flushText = () => {
    if (buffer.length) segments.push({ type: 'text', value: buffer.join('\n') })
    buffer = []
  }

  for (const line of lines) {
    if (code) {
      if (CLOSE_FENCE.test(line)) {
        segments.push({ type: 'code', value: code.lines.join('\n'), tag: code.tag })
        code = null
      } else {
        code.lines.push(line)
      }
      continue
    }

    const open = line.match(OPEN_FENCE)
    if (open) {
      flushText()
      code = { tag: open[1] || undefined, lines: [] }
    } else {
      buffer.push(line)
    }
  }

  if (code) segments.push({ type: 'code', value: code.lines.join('\n'), tag: code.tag })
  flushText()

  return segments.filter(s => s.type === 'code' || s.value.trim().length > 0)
}

export default function QuestionText({
  text,
  area,
  className = '',
}: {
  text: string
  area?: string
  className?: string
}) {
  const segments = parseQuestionText(text ?? '')

  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <CodeBlock key={i} code={seg.value} language={resolveLanguage(seg.tag, area)} />
        ) : (
          // pre-wrap so a plain multi-line question keeps its line breaks.
          <p key={i} className="whitespace-pre-wrap">{seg.value.trim()}</p>
        )
      )}
    </div>
  )
}
