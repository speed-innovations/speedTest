import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendCredentialsEmail, EmailNotSentError, emailFailureReason } from '@/lib/email'

/**
 * The credentials email is the only way a student learns their password.
 * It used to fail silently (no config -> quiet return, Brevo error -> empty
 * catch in the import), so imports reported success while nobody received
 * anything. These pin the contract: accepted -> messageId, anything else -> throw
 * with a reason, and the password never reaches a production log.
 */
const PASSWORD = 'S3cret-Pass-123'
const args = {
  to: 'student@example.com', name: 'Student', email: 'student@example.com',
  password: PASSWORD, loginUrl: 'https://app.example/login', role: 'Student',
}

describe('sendCredentialsEmail (Brevo only)', () => {
  const env = { ...process.env }
  let logs: string[]

  beforeEach(() => {
    process.env.BREVO_API_KEY = 'xkeysib-test'
    process.env.EMAIL_FROM = 'noreply@example.com'
    logs = []
    const capture = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
    vi.spyOn(console, 'log').mockImplementation(capture)
    vi.spyOn(console, 'warn').mockImplementation(capture)
    vi.spyOn(console, 'error').mockImplementation(capture)
  })
  afterEach(() => {
    process.env = { ...env }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('posts to Brevo and returns the messageId when accepted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: '<abc@brevo>' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendCredentialsEmail(args)).resolves.toBe('<abc@brevo>')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(init.headers['api-key']).toBe('xkeysib-test')
    const body = JSON.parse(init.body)
    expect(body.sender.email).toBe('noreply@example.com')
    expect(body.to).toEqual([{ email: 'student@example.com' }])
    expect(body.htmlContent).toContain(PASSWORD) // the student must receive it
    expect(logs.join('\n')).toContain('<abc@brevo>')
    expect(logs.join('\n')).not.toContain(PASSWORD)
  })

  it('throws with Brevo\'s reason when Brevo rejects the send', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 })))

    const err = await sendCredentialsEmail(args).catch(e => e)
    expect(err).toBeInstanceOf(EmailNotSentError)
    expect(emailFailureReason(err)).toContain('Brevo responded 401')
    expect(emailFailureReason(err)).toContain('Key not found')
    expect(logs.join('\n')).not.toContain(PASSWORD)
  })

  it('throws instead of silently skipping when Brevo is not configured', async () => {
    delete process.env.BREVO_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NODE_ENV', 'production')

    const err = await sendCredentialsEmail(args).catch(e => e)
    expect(err).toBeInstanceOf(EmailNotSentError)
    expect(emailFailureReason(err)).toMatch(/BREVO_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logs.join('\n')).not.toContain(PASSWORD)
    vi.unstubAllEnvs()
  })

  it('reports a timeout in words, not as an AbortError', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(emailFailureReason(abort)).toBe('Brevo did not respond within 10s')
  })
})
