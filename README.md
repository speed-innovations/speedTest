# SpeedTest — Candidate Assessment Platform

**Built for Speed Innovation** · Campus Hiring Made Intelligent

---

## 🚀 Deployment (Render)

Production runs on **Render**: https://speedtest-45s1.onrender.com

### How a commit reaches production

Push to `main`. That is the whole process — but it is worth knowing what
carries it there, because it is not what Render's dashboard suggests.

Render's own auto-deploy **does not fire**. Its GitHub App was never installed
on the org and the repository has no webhook, so a push never reaches Render;
the service's `autoDeploy: yes` setting has nothing to act on.

`.github/workflows/deploy.yml` is the delivery path instead. On a push to
`main` it typechecks, applies migrations, seeds, runs the test suite and
builds — and only then asks Render to deploy. It polls the deploy to
completion and fails on `build_failed`, `update_failed` or `canceled`, so a
red build never reaches production and a failed deploy never reports green.

Watch a deploy with `gh run watch`, or in the Actions tab.

Requires a `RENDER_API_KEY` repository secret (Render → Account Settings → API
Keys, then `gh secret set RENDER_API_KEY`). `RENDER_SERVICE_ID` may be set as a
repository variable; it otherwise defaults to the live service.

### Step 1: Database (Supabase)

1. [supabase.com](https://supabase.com) → New Project
2. From `Project Settings → Database → Connection String`:
   - `DATABASE_URL` = pooled connection (port 6543)
   - `DIRECT_URL` = session connection (port 5432)

Both go through the pooler: the direct host `db.<ref>.supabase.co` is
IPv6-only. Supabase serves a certificate under its own CA, which is in no
public trust store, so `DATABASE_CA_CERT_B64` must be set for the Node runtime
to verify the connection rather than skip verification.

### Step 2: Create the Render service

1. Render → New → Web Service → connect this repository
2. Build command `npm install; npm run build`, start command `npm run start`
3. Add the environment variables below
4. Add `RENDER_API_KEY` to GitHub so the workflow can deploy

### Step 3: Migrations

```bash
npx prisma migrate deploy
npx prisma db seed
```

### Local development

`.env` points at a local PostgreSQL instance, not Supabase — the test suite
contains integration tests that write real rows, so running them against
Supabase would exercise production. When switching `.env` back to Supabase,
uncomment `DATABASE_CA_CERT_B64` along with the URLs: `src/lib/db.ts` pins that
CA only when the variable is set, and a local connection with it set fails the
TLS handshake.

```bash
npm run dev      # http://localhost:3001
npm test         # integration tests included; needs DATABASE_URL
```

---

## 🔑 Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase pooled connection, port 6543 (pgbouncer) |
| `DIRECT_URL` | Supabase session connection, port 5432 — used by `prisma migrate` for DDL and by the maintenance scripts |
| `DATABASE_CA_CERT_B64` | Base64 of the Supabase Root 2021 CA. Pins TLS so the connection is verified rather than trusted blindly. Leave **unset** when pointing at a local database |
| `NEXTAUTH_SECRET` | Random 32-char secret (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Public https origin in production, e.g. `https://speedtest-45s1.onrender.com`. Auth callbacks break if this is left as localhost |
| `BREVO_API_KEY` | Brevo v3 API key (`xkeysib-…`) for transactional email |
| `EMAIL_FROM` | Sender address, verified in Brevo |
| `NEXT_PUBLIC_APP_URL` | Public app URL. Optional on Render — `getBaseUrl()` falls back to `RENDER_EXTERNAL_URL`, which Render sets automatically |

### Email

Transactional email goes through **Brevo's HTTP API over 443**, not SMTP.
Render's free tier blocks outbound SMTP ports (25/465/587), so a nodemailer
connection times out and hangs the request. Brevo also sends to any recipient
after single-sender verification alone, with no DNS setup.

Set `BREVO_API_KEY` and a Brevo-verified `EMAIL_FROM`. With either missing,
sending degrades to a logged warning instead of failing the request — locally
that means credentials print to the server console.

---

## 👤 Default Login Credentials

After seeding the database:

| Role | Email | Password |
|------|-------|----------|
| App Admin | `admin@speedinnovation.com` | `Admin@123` |
| Coordinator | `coordinator@mitcoe.edu.in` | `Coord@123` |

> ⚠️ Change passwords immediately after first login!

---

## 📁 Project Structure

```
src/
├── app/
│   ├── admin/          # Admin module pages
│   ├── coordinator/    # Coordinator module pages
│   ├── student/        # Student module pages
│   ├── api/            # REST API routes
│   └── login/          # Auth pages
├── components/
│   ├── admin/          # Admin UI components
│   ├── coordinator/    # Coordinator UI components
│   ├── student/        # Student UI components
│   └── ui/             # Shared UI (Logo, etc.)
└── lib/
    ├── auth.ts         # NextAuth configuration
    ├── db.ts           # Prisma client
    └── email.ts        # Email utility
prisma/
├── schema.prisma       # Database schema
└── seed.ts             # Seed data
```

---

## 🏗️ Modules

### App Admin
- ✅ Manage Colleges
- ✅ Create Tests with Assessment Areas (Aptitude, .NET, Python, AI, Communication, etc.)
- ✅ Schedule Tests per College
- ✅ Question Bank with MCQ (add/edit/delete/preview/import/export)
- ✅ Manage College Coordinators (create login, reset password)
- ✅ Job Openings with required/nice-to-have skills
- ✅ Results Reports (filterable, exportable to Excel)
- ✅ Shortlist Criteria (filter by test score, education marks, per-area score)

### College Coordinator
- ✅ Upload candidates via Excel template
- ✅ View candidate list with education details
- ✅ Reset student passwords
- ✅ View test schedules

### Student
- ✅ View uploaded profile information
- ✅ Update personal & education details
- ✅ Upload resume (PDF/Word)
- ✅ View job requirements & company presentation download
- ✅ Test schedule with live start button
- ✅ Full test engine:
  - Random question shuffling per student
  - Tab/window switch detection with question flagging
  - Auto-save answers
  - Forward/backward navigation
  - Countdown timer with auto-submit
  - Final submission with confirmation
  - Cannot re-attempt after submission

---

## 📊 Question Bank — Import Template

Download template from Admin → Question Bank → Export

| Column | Values |
|--------|--------|
| Area | APTITUDE, DOTNET, COMMUNICATION, AI, PYTHON, JAVA, JAVASCRIPT, SQL |
| Difficulty | EASY, MEDIUM, HARD |
| Correct Answer | A, B, C, or D |
| Marks | Numeric (e.g. 1, 2, 0.5) |

### Code in questions

Wrap a snippet in a fenced block with a language tag and it renders in a
highlighted box with indentation preserved — which output-prediction questions
depend on, since HTML otherwise collapses the leading spaces:

    What will be the output?

    ```python
    for i in range(3):
        print(i)
    ```

Supported tags: `python`, `javascript`, `sql`, `java`, `csharp`. An untagged
fence falls back to the question's assessment area. Text without a fence
renders as ordinary prose, so existing questions are unaffected.

`scripts/` holds the maintenance tooling for the bank — bulk import, fence
backfill, answer-key redistribution and restore-from-source. Each defaults to a
dry run and writes only with `--yes`. See [CLAUDE.md](CLAUDE.md) before using
them.

---

## 🔒 Security Features

- JWT-based sessions via NextAuth
- Role-based access control (Admin / Coordinator / Student)
- Tab switch detection during test with per-question flagging
- Bcrypt password hashing
- Server-side authorization on all API routes
- Auto-submit on timer expiry

---

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Set up .env (copy from .env.example)
cp .env.example .env

# Run database migrations
npx prisma migrate dev

# Seed database
npx prisma db seed

# Start dev server
npm run dev
```

Open [http://localhost:3001](http://localhost:3001)

---

## 🌐 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Database | PostgreSQL via Prisma ORM (pg driver adapter) |
| Auth | NextAuth.js |
| Styling | Tailwind CSS |
| Code highlighting | prism-react-renderer |
| Email | Brevo HTTP API |
| Excel | SheetJS (xlsx) |
| Hosting | Render |
| DB Hosting | Supabase (free tier) |
| CI/CD | GitHub Actions → Render |

---

## 📧 Support

For issues, contact: **Speed Innovation** · admin@speedinnovation.com

---

*© 2025 Speed Innovation. All rights reserved.*
