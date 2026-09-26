# Proctoring — implementation overview

Read this file plus **one** part file per session. Nothing else is required.

**Goal:** Optional, live proctoring for the SpeedTest assessment platform:
in-browser MediaPipe detection, visible monitoring, warnings, tamper and
interruption detection, and server-side logging of metadata events. No video,
audio or screenshots are recorded, stored or uploaded, so no storage
credentials are needed. The earlier media-recording design (Parts 2, 3, 5, 7,
10) was removed in the live-monitoring phase: `live-monitoring-plan.md`.

**Spec:** the proctoring PRD (95 sections), supplied by the product owner.
**Plan of record:** this directory. `PROGRESS.md` is the ledger.

---

## Working mode: local only, nothing pushed

**Nothing reaches GitHub until Parts 1–14 are done and verified locally.**

| | |
|---|---|
| Branch | `feat/proctoring`. Never commit proctoring work to `main`. |
| Commits | Local, one per part. |
| Push | **Never**, until Part 15 and only on the owner's explicit go-ahead. |
| Database | Local Postgres only — `speedtest:speedtest@localhost:5432/speedtest`. |
| Supabase | **Untouched.** No `migrate deploy` against production, at any point. |
| Render | No deploy. A push to `main` is what triggers one, and there are none. |
| Storage | None. No media is captured, encoded, uploaded or stored, so no storage provider, bucket or credentials are needed at any point. |

`main` is the deploy trigger, which is why this work lives on a branch: an
accidental push would deploy half-built proctoring to production.

**Local media capture needs no HTTPS.** `getUserMedia`/`getDisplayMedia` require
a secure context and `http://localhost:3001` qualifies.

**Keep `DATABASE_CA_CERT_B64` commented out** while `.env` points at local
Postgres — `src/lib/db.ts` `nodeSsl()` pins that CA with
`rejectUnauthorized: true` and loopback Postgres serves no TLS, so leaving it set
fails the handshake with a misleading certificate error.

---

## The four findings that shape this design

### 1. There is no single attempt table

`TestAttempt` (scheduled, via `TestSchedule`) and `WalkInAttempt` (walk-in,
direct to `Test`) are **parallel tables with no common parent**. Each has its own
responses table, its own five API routes, and its own near-duplicate ~523-line
page component. The PRD says `attemptId` throughout as if one exists. It does not.

**Resolution:** `ProctoringSession` carries two nullable FKs — `testAttemptId`
and `walkInAttemptId` — with a DB `CHECK` enforcing exactly one non-null.
`ProctoringAsset` and `ProctoringEvent` reference only `proctoringSessionId`, so
the dual-ness is contained to one table. Preserves referential integrity and
cascades, which a polymorphic `(kind, id)` pair would discard.

### 3. No scheduled execution exists anywhere

No cron, no `render.yaml`, no `on: schedule`, no queue library. Cleanup builds
that infrastructure. GitHub scheduled workflows run late (10–30 min normal) and
auto-disable after 60 days of repo inactivity — so cleanup is catch-up capable
and `expiresAt` blocks access on time regardless of when deletion happens.

### 4. Two API conventions coexist; only one is safe

- **Convention A** (admin): session check copy-pasted ~50×, raw `body` into
  Prisma, `{ error: err.message }` in a 500 — leaks Prisma internals.
- **Convention B** (`src/lib/attempt-auth.ts`): `requireStudent()` → `HttpError`
  → one `errorResponse(err, label, fallback)` funnel, server-authoritative
  deadlines, allow-listed input, idempotent writes.

**All proctoring routes use Convention B.** There is no `requireAdmin` helper
despite ~50 duplicates; Part 4 adds one.

---

## Integration points, verified against source

### Refresh cannot auto-resume proctoring

`src/app/student/test/[scheduleId]/page.tsx:52-65` — on reload with
`data.started === true` the component sets `testStarted = true` **directly**,
never calling `startTest()`. There is no user gesture on that path, and
`getDisplayMedia()` requires one. A recovery screen with an explicit button is
therefore the only legal path, not a nicety.

### Question correlation is client-supplied and membership-validated

PRD §44 asks to derive the current question server-side. The server has no such
state — `TestAttempt` stores `questionIds` (the assigned *set*), never a cursor.
`violation/route.ts:26-32` already solves it correctly:

```ts
const assigned = assignedQuestionIds(attempt.questionIds)
const questionId =
  typeof incoming.questionId === 'string' && assigned.includes(incoming.questionId)
    ? incoming.questionId
    : null
```

Follow exactly this. Never claim server-side derivation.

### The gate that makes proctoring non-bypassable

`POST /start` (`start/route.ts:72-87`) sets `startedAt`/`expiresAt`. A modified
client could skip every proctoring call and go straight there.

**`/start` must refuse to start the clock when `test.proctoringEnabled` is true
and no `ACTIVE` `ProctoringSession` exists.** Both `attempt-auth` helpers already
`include` the test (lines 83, 103), so the flag costs no extra query. Quota check
and session creation happen **before** `startedAt` is set, or a candidate whose
quota check fails has already burned clock.

### Admin already addresses both attempt kinds

`src/app/api/admin/results/detail/route.ts:12-13` keys on
`?attemptId=...&type=scheduled|walkin`. Reuse that scheme. It also already
returns `startedAt` (lines 40, 82) — the anchor for `elapsedMs` correlation.
(`startTimeRef` in the candidate page is assigned but never read; not a source.)
That route stays **untouched**; proctoring evidence loads from separate endpoints
so the gallery can lazy-load.

### Finalization hooks after the transaction, never inside it

`submit/route.ts:96` closes a `$transaction` with `timeout: 20_000` already
carrying cohort submit load. The "mark session COMPLETED" safety net runs
**after** it, best-effort, wrapped so a failure can never fail a submit.

---

## Architecture (live monitoring)

```
Camera + mic (getUserMedia)       Screen (getDisplayMedia)
        │ browser memory only             │ held only to detect its end
        ▼                                 ▼
MediaPipe Face Landmarker        IntegrityMonitor ◄── tracks: ended / mute / unmute
 (gaze-monitor.ts, ~6 FPS,          │                page: visibility, pagehide,
  rVFC → rAF, GPU → CPU)            │                fullscreen, blur / focus
        ▼                           │
extractFrameSignals  (face count, yaw/pitch/roll, iris X/Y, face size, quality)
        ▼                           │
BaselineCollector    (~3 s median personal baseline)
        ▼                           │
fuseSignals          (head + eyes agreement → direction + confidence)
        ▼                           │
TemporalEngine       (NORMAL → POSSIBLE → SUSTAINED → WARNING → COOLDOWN)
        ▼                           │
BehaviourTracker     (sustained / repeated downward attention)
        ▼                           ▼
  WarningGate → candidate banners      EventQueue (bounded, rate-capped, batched)
                                            ▼
          POST /events · /heartbeat (session-bound) → ProctoringEvent rows (metadata)
                                            ▼
                     admin: timeline + PROCTORING_REVIEW_SIGNAL (never scoring)
```

Limitations (state them to anyone relying on this):
- A phone held outside the camera's view cannot be detected. Downward attention is an observation, never proof of a phone.
- Gaze is an estimate from head pose and iris offset against a baseline taken in the first few seconds.
- Lighting, glasses, camera placement and a skewed baseline all degrade it.
- A blur or a hidden tab means only that focus left the page.
- The client is not trusted. A modified browser can fake heartbeats that report healthy devices, and it can read the detection thresholds from the JS bundle. What the server does guarantee: `/start` needs a live session; events and heartbeats bind to the caller's own session; heartbeat gaps are recorded server-side, including the trailing gap at submit; event volume is capped per session.

### Gaze: pure core, thin shell

- `gaze-classify.ts` — **pure**. `(signals, baseline, thresholds) -> Direction`.
- `gaze-state.ts` — **pure**, injected clock. `(direction, tMs) -> Warning | null`.
- `gaze-monitor.ts` — thin shell owning MediaPipe, the video element, the loop.

The PRD's threshold/cooldown cases are all state-machine behaviour, so the part
most likely to be wrong is testable in the existing node runner with no browser.

MediaPipe assets are **self-hosted** under `public/mediapipe/` (WASM +
`face_landmarker.task`). A blocked CDN would otherwise break proctoring
mid-assessment. Config: `numFaces: 2`, `outputFacialTransformationMatrixes: true`,
`runningMode: 'VIDEO'`, throttled to ~6 FPS.

### The duplicated candidate pages: one hook, two call sites

`student/test/[scheduleId]/page.tsx` and `student/walkin-test/[testId]/page.tsx`
are 523 and 525 lines of near-identical code. A fix to one that misses the other
is this repo's standing failure mode.

Proctoring is written **once** as `useProctoring(...)` plus presentational
components, parameterised by API base path and attempt kind. Each page gains a
small integration block, not a copy of the logic.

**This plan does not deduplicate the existing pages.** That refactor is worthwhile
and genuinely risky; bundling it here would endanger a working exam flow for no
proctoring benefit.

### Validation: zod

1. Every new route body — schemas in `src/lib/proctoring/schemas.ts`, parsed via
   `parseBody(req, schema)` which throws `HttpError(400, ...)` into the existing
   `errorResponse` funnel.
2. Environment variables — `src/lib/proctoring/config.ts` validates and coerces
   at module load. The app has zero env validation today.
3. A **bounded** retrofit (Part 12) of the highest-risk existing routes.

---

## Global constraints — every part inherits these

- **Never modify** `src/lib/grading.ts`, `src/lib/question-picker.ts`, or the
  submit-scoring transaction. Proctoring must not alter scores.
- **Non-proctored attempts must behave identically.** Every branch is gated on
  `Test.proctoringEnabled`.
- **Both attempt kinds, always.** A change to `student/test/[scheduleId]` not
  mirrored to `student/walkin-test/[testId]` is incomplete.
- **Convention B only.** Never return `err.message` to a client.
- **404, not 403, for ownership failures** — do not confirm an id exists to a
  non-owner.
- **Prisma `undefined` means "leave this column alone".** This caused a past
  90-question corruption. Use `null` to clear.
- **Never push; never touch Supabase or Render.** Local commits only until Part 15.
- **Stop the dev server before `prisma generate`** on Windows (EPERM on the
  query engine DLL).
- **`DIRECT_URL ?? DATABASE_URL`** in scripts — interactive transactions are
  unreliable through the pgBouncer pooler.
- **No secrets in git.** `.env.example` gets commented placeholders in the
  existing heavily-annotated style.
- **No media capture, encoding, upload or storage anywhere.**
  `tests/proctoring-no-media.test.ts` enforces it.
- **`/start` refuses to start the clock** when proctoring is enabled and no
  `ACTIVE` session exists.
- **Question correlation is client-supplied, membership-validated.**
- **Every part ends green:** `npx tsc --noEmit -p tsconfig.json` and `npm test`.

---

## Part index

| # | Part | File |
|---|---|---|
| 1 | Schema, migration, config | `part-01-schema-and-config.md` |
| 2 | Storage abstraction | `part-02-storage-abstraction.md` |
| 3 | Quota and reservation | `part-03-quota-and-reservation.md` |
| 4 | Session lifecycle API | `part-04-session-lifecycle-api.md` |
| 5 | Upload APIs | `part-05-upload-apis.md` |
| 6 | Events API | `part-06-events-api.md` |
| 7 | Client core services | `part-07-client-core-services.md` |
| 8 | Gaze detection | `part-08-gaze-detection.md` |
| 9 | Candidate UI | `part-09-candidate-ui.md` |
| 10 | Admin review UI | `part-10-admin-review-ui.md` |
| 11 | Retention and cleanup | `part-11-retention-and-cleanup.md` |
| 12 | zod retrofit | `part-12-zod-retrofit.md` |
| 13 | Playwright E2E | `part-13-playwright-e2e.md` |
| 14 | Docs and local verification | `part-14-docs-and-verification.md` |
| 15 | Release (gated) | `part-15-release.md` |

## Data model (locked)

```prisma
enum ProctoringSessionStatus { PENDING ACTIVE DEGRADED COMPLETED INTERRUPTED EXPIRED }
```

- `ProctoringEvent` dedup key: `@@unique([proctoringSessionId, clientEventId])`

Full definitions in `part-01-schema-and-config.md`.
