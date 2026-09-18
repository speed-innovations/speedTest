import { describe, it, expect } from 'vitest'
import { Prism } from 'prism-react-renderer'
// Importing the component runs its grammar registration as a side effect.
import { parseQuestionText } from '@/components/QuestionText'

describe('syntax grammars', () => {
  // Every language the assessment areas can produce must tokenise, or a code
  // question renders as an unhighlighted (or, worse, throwing) block.
  it.each([
    ['python', 'def f(n):\n    return n + 1'],
    ['sql', 'SELECT id FROM users WHERE id = 1;'],
    ['javascript', 'const f = (n) => n + 1'],
    ['java', 'public class A { static int f(int n) { return n + 1; } }'],
    ['csharp', 'public class A { static int F(int n) => n + 1; }'],
  ])('tokenises %s', (lang, code) => {
    const grammar = (Prism.languages as any)[lang]
    expect(grammar, `${lang} grammar is not registered`).toBeTruthy()
    const tokens = Prism.tokenize(code, grammar)
    expect(tokens.length).toBeGreaterThan(1)
    // A keyword must be recognised, otherwise the grammar is a passthrough.
    expect(tokens.some((t: any) => typeof t === 'object' && t.type === 'keyword')).toBe(true)
  })
})

describe('parseQuestionText', () => {
  it('splits a fenced snippet away from its prose stem', () => {
    const segments = parseQuestionText(
      'What will be the output?\n\n```python\nfor i in range(3):\n    print(i)\n```'
    )
    // The blank line before the fence is a separator, not content; the prose
    // segment is trimmed at render time either way.
    expect(segments).toEqual([
      { type: 'text', value: 'What will be the output?\n' },
      { type: 'code', value: 'for i in range(3):\n    print(i)', tag: 'python' },
    ])
  })

  it('preserves indentation byte for byte', () => {
    const code = 'def thrive(n):\n    if n % 15 == 0:\n        print("thrive")'
    const [, block] = parseQuestionText(`Stem\n\n\`\`\`python\n${code}\n\`\`\``)
    expect(block).toMatchObject({ type: 'code', value: code })
    // The deepest line must keep all eight of its leading spaces.
    expect((block as any).value.split('\n')[2]).toBe('        print("thrive")')
  })

  it('leaves an unfenced question as a single text segment', () => {
    expect(parseQuestionText('Which of these is not a Python loop?')).toEqual([
      { type: 'text', value: 'Which of these is not a Python loop?' },
    ])
  })

  it('reads an untagged fence, leaving the language to the caller', () => {
    const [block] = parseQuestionText('```\nSELECT 1;\n```')
    expect(block).toEqual({ type: 'code', value: 'SELECT 1;', tag: undefined })
  })

  it('handles several fences and the prose between them', () => {
    const segments = parseQuestionText('One\n\n```sql\nSELECT 1;\n```\n\nTwo\n\n```sql\nSELECT 2;\n```')
    expect(segments.map(s => s.type)).toEqual(['text', 'code', 'text', 'code'])
    expect(segments.filter(s => s.type === 'code').map(s => s.value)).toEqual(['SELECT 1;', 'SELECT 2;'])
  })

  it('treats an unterminated fence as running to the end', () => {
    const [, block] = parseQuestionText('Stem\n\n```python\nprint(1)')
    expect(block).toEqual({ type: 'code', value: 'print(1)', tag: 'python' })
  })

  it('drops whitespace-only prose but never an empty-looking code block', () => {
    const segments = parseQuestionText('```python\n\n```')
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('code')
  })

  it('survives CRLF line endings, which is how a pasted snippet often arrives', () => {
    const [, block] = parseQuestionText('Stem\r\n\r\n```python\r\nif x:\r\n    pass\r\n```')
    expect(block.type).toBe('code')
    expect((block as any).value.replace(/\r/g, '')).toBe('if x:\n    pass')
  })
})
