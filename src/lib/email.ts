import nodemailer from 'nodemailer'

function getTransporter() {
  const host = process.env.EMAIL_SERVER_HOST
  const port = parseInt(process.env.EMAIL_SERVER_PORT || '587')
  const user = process.env.EMAIL_SERVER_USER
  const pass = process.env.EMAIL_SERVER_PASSWORD

  if (!host || !user || !pass) {
    console.warn('⚠️ Email not configured. Set EMAIL_SERVER_HOST, EMAIL_SERVER_USER, EMAIL_SERVER_PASSWORD in .env')
    return null
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
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
  const transporter = getTransporter()
  if (!transporter) {
    // Never log the password in a deployed environment — server logs are
    // retained, searchable, and visible to anyone with dashboard access.
    // Locally it is printed so accounts are usable without an SMTP server.
    console.log(`📧 [SKIPPED] Credentials email for ${to} — SMTP not configured`)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`   [dev only] Email: ${email} | Password: ${password}`)
    } else {
      console.warn(
        `   Account for ${email} was created but no credentials were delivered. ` +
        `Configure SMTP and use "Resend credentials" to issue a new password.`
      )
    }
    return
  }

  // Use the authenticated SMTP user as sender (Gmail requires this)
  const from = process.env.EMAIL_FROM || process.env.EMAIL_SERVER_USER

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

  await transporter.sendMail({
    from: `"SpeedTest" <${from}>`,
    to,
    subject: 'Your SpeedTest Account Credentials',
    html: brandEmail(content),
  })
}

export async function sendTestScheduleEmail({
  to, name, testTitle, scheduledAt, duration, loginUrl,
}: {
  to: string; name: string; testTitle: string; scheduledAt: Date; duration: number; loginUrl: string;
}) {
  const transporter = getTransporter()
  if (!transporter) {
    console.log(`📧 [SKIPPED] Test schedule email for ${to} — SMTP not configured`)
    return
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_SERVER_USER

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

  await transporter.sendMail({
    from: `"SpeedTest" <${from}>`,
    to,
    subject: `Test Scheduled: ${testTitle}`,
    html: brandEmail(content),
  })
}
