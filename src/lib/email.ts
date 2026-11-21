// Email is sent only through Brevo's transactional HTTPS API (port 443).
// There is no SMTP path: Render's free tier blocks outbound SMTP ports
// (25/465/587). Called with the global fetch — no SDK.
//
// Required environment: BREVO_API_KEY, and EMAIL_FROM — a sender verified in
// Brevo (Senders & IP > Senders). The EMAIL_SERVER_* variables are unused.
//
// Every send either succeeds (Brevo accepted it, messageId logged) or throws.
// It used to return quietly when Brevo was not configured, and callers wrapped
// it in an empty catch, so an import reported "imported!" while no student
// received anything. Callers must now record the failure and show it.
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
const SEND_TIMEOUT_MS = 10_000

export class EmailNotSentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailNotSentError'
  }
}

/** A short, password-free reason for showing to an admin. */
export function emailFailureReason(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? 'Brevo did not respond within 10s' : err.message
  return String(err)
}

function getSender(): { apiKey: string; from: string } {
  const apiKey = process.env.BREVO_API_KEY
  const from = process.env.EMAIL_FROM
  if (!apiKey || !from) {
    throw new EmailNotSentError('Email is not configured: set BREVO_API_KEY and EMAIL_FROM')
  }
  return { apiKey, from }
}

async function sendViaBrevo(opts: {
  apiKey: string; from: string; to: string; subject: string; html: string
}): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': opts.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'SpeedTest', email: opts.from },
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
      }),
      signal: controller.signal,
    })

    // Brevo returns 201 Created with a messageId on success; anything else
    // is an error whose body explains why (bad key, unverified sender, etc.).
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new EmailNotSentError(`Brevo responded ${res.status}: ${detail.slice(0, 300) || 'no body'}`)
    }
    const body = (await res.json().catch(() => ({}))) as { messageId?: string }
    return body.messageId ?? '(no messageId)'
  } finally {
    clearTimeout(timer)
  }
}

const brandEmail = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #3B1F8C, #007DA6); padding: 30px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 28px; letter-spacing: 2px; }
    .header span { color: #00C9A7; }
    .subheader { color: rgba(255,255,255,0.8); font-size: 13px; margin-top: 4px; }
    .accent { display: flex; gap: 6px; justify-content: center; margin-top: 10px; }
    .line { height: 3px; border-radius: 2px; background: linear-gradient(90deg, #00C9A7, #007DA6); }
    .body { padding: 30px; color: #333; line-height: 1.6; }
    .cred-box { background: #f8f6ff; border: 1px solid #3B1F8C22; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .cred-box p { margin: 5px 0; }
    .btn { display: inline-block; background: linear-gradient(135deg, #3B1F8C, #5A3DB5); color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 10px 0; }
    .footer { background: #3B1F8C11; padding: 20px; text-align: center; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SPEED<span>TEST</span></h1>
      <div class="subheader">Speed Innovation</div>
      <div class="accent">
        <div class="line" style="width:40px"></div>
        <div class="line" style="width:60px"></div>
        <div class="line" style="width:30px"></div>
      </div>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Speed Innovation. All rights reserved.<br>
      This is an automated message, please do not reply.
    </div>
  </div>
</body>
</html>
`

export async function sendCredentialsEmail({
  to, name, email, password, loginUrl, role,
}: {
  to: string; name: string; email: string; password: string; loginUrl: string; role: string;
}) {
  let sender: { apiKey: string; from: string }
  try {
    sender = getSender()
  } catch (err) {
    // Never log the password in a deployed environment — server logs are
    // retained, searchable, and visible to anyone with dashboard access.
    // Locally it is printed so accounts are usable without email configured.
    console.warn(`📧 Credentials email NOT sent to ${to}: ${emailFailureReason(err)}`)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`   [dev only] Email: ${email} | Password: ${password}`)
    }
    throw err
  }

  const content = `
    <h2>Welcome to SpeedTest, ${name}!</h2>
    <p>Your account has been created as <strong>${role}</strong>. Here are your login credentials:</p>
    <div class="cred-box">
      <p><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Password:</strong> ${password}</p>
    </div>
    <p>⚠️ <strong>Please change your password</strong> after first login.</p>
    <a href="${loginUrl}" class="btn">Login to SpeedTest →</a>
    <p style="color:#888;font-size:13px;">If you did not expect this email, please contact your administrator.</p>
  `

  try {
    const messageId = await sendViaBrevo({
      apiKey: sender.apiKey,
      from: sender.from,
      to,
      subject: 'Your SpeedTest Account Credentials',
      html: brandEmail(content),
    })
    console.log(`📧 Credentials email accepted by Brevo for ${to} (messageId ${messageId})`)
    return messageId
  } catch (err) {
    console.error(`📧 Credentials email NOT sent to ${to}: ${emailFailureReason(err)}`)
    throw err
  }
}

export async function sendTestScheduleEmail({
  to, name, testTitle, scheduledAt, duration, loginUrl,
}: {
  to: string; name: string; testTitle: string; scheduledAt: Date; duration: number; loginUrl: string;
}) {
  const sender = getSender()

  const content = `
    <h2>Test Scheduled: ${testTitle}</h2>
    <p>Dear ${name},</p>
    <p>A test has been scheduled for you. Please be ready at the scheduled time.</p>
    <div class="cred-box">
      <p><strong>Test:</strong> ${testTitle}</p>
      <p><strong>Scheduled At:</strong> ${scheduledAt.toLocaleString()}</p>
      <p><strong>Duration:</strong> ${duration} minutes</p>
    </div>
    <p>Please ensure a stable internet connection. Any tab switching will be recorded.</p>
    <a href="${loginUrl}" class="btn">Go to SpeedTest Portal →</a>
  `

  await sendViaBrevo({
    apiKey: sender.apiKey,
    from: sender.from,
    to,
    subject: `Test Scheduled: ${testTitle}`,
    html: brandEmail(content),
  })
}
