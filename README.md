# SpeedTest — Candidate Assessment Platform

**Built for Speed Innovation** · Campus Hiring Made Intelligent

---

## 🚀 Quick Start (Vercel Deployment — Zero Manual Effort)

### Step 1: Database Setup (Supabase — Free)

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note down your **Database URL** and **Direct URL** from:
   `Project Settings → Database → Connection String`
   - `DATABASE_URL` = Connection pooling URL (port 6543)
   - `DIRECT_URL` = Direct connection URL (port 5432)

### Step 2: Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Push this repo to GitHub
2. Connect to Vercel → Import repository
3. Set all environment variables (see `.env.example`)
4. Deploy!

### Step 3: Run Database Migrations

After first deploy, run in Vercel terminal or locally:
```bash
npx prisma migrate deploy
npx prisma db seed
```

---

## 🔑 Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase pooled connection (pgbouncer) |
| `DIRECT_URL` | Supabase direct connection |
| `NEXTAUTH_SECRET` | Random 32-char secret (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Your app URL e.g. `https://speedtest.vercel.app` |
| `EMAIL_SERVER_HOST` | SMTP host (e.g. `smtp.gmail.com`) |
| `EMAIL_SERVER_PORT` | SMTP port (e.g. `587`) |
| `EMAIL_SERVER_USER` | SMTP email address |
| `EMAIL_SERVER_PASSWORD` | Gmail App Password |
| `EMAIL_FROM` | Sender email |
| `NEXT_PUBLIC_APP_URL` | Your app URL |

### Gmail App Password Setup
1. Google Account → Security → 2-Step Verification → App Passwords
2. Generate password for "Mail"
3. Use as `EMAIL_SERVER_PASSWORD`

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

Open [http://localhost:3000](http://localhost:3000)

---

## 🌐 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Database | PostgreSQL via Prisma ORM |
| Auth | NextAuth.js |
| Styling | Tailwind CSS |
| Email | Nodemailer |
| Excel | SheetJS (xlsx) |
| Hosting | Vercel |
| DB Hosting | Supabase (free tier) |

---

## 📧 Support

For issues, contact: **Speed Innovation** · admin@speedinnovation.com

---

*© 2025 Speed Innovation. All rights reserved.*
