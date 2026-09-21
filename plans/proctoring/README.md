# Proctoring — implementation overview

Read this file plus **one** part file per session. Nothing else is required.

**Goal:** add optional, privacy-conscious proctoring (webcam+mic recording,
once-per-minute screen snapshots, local MediaPipe gaze detection, presigned
Cloudflare R2 storage, 72-hour retention, admin review) to the SpeedTest
assessment platform without changing any existing behaviour.

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
| Storage | `PROCTORING_STORAGE_PROVIDER=mock` for tests; a real R2 bucket may be wired for local manual testing with `http://localhost:3001` in CORS. |

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

### 2. The 7 GB cap allows ~75 proctored attempts per 3 days

| Quantity | Value |
|---|---|
| Video + audio per attempt (160+32 kbps, 60 min) | 86.4 MB |
| Screenshots per attempt (60 × 100 KB) | 6 MB |
| **Actual stored per attempt** | **92.4 MB** |
| Reserved per attempt (×1.2) | 111 MB |
| Concurrency ceiling | ~63 simultaneous |
| **Rolling ceiling (media held 72h)** | **~75 attempts per 3-day window** |

The rolling ceiling binds, and it is easy to misread. A reservation is released
at submission, but **the media it produced stays for the full 72 hours**.
Staggering a 200-student drive into waves does not help: wave four still competes
with wave one's media.

`PROCTORING_STORAGE_SAFETY_BYTES = 7000000000` per the PRD, chosen knowingly. So
"storage limit reached" is a **routine** state, not an edge case — the pre-check
must present it calmly and the admin page must surface remaining capacity.

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

## Architecture

### Storage: one interface, two providers

```
src/lib/proctoring/storage/types.ts   ObjectStorage interface
src/lib/proctoring/storage/r2.ts      CloudflareR2Storage
src/lib/proctoring/storage/mock.ts    MockStorage (in-memory)
src/lib/proctoring/storage/index.ts   selection via PROCTORING_STORAGE_PROVIDER
```

```ts
export interface ObjectStorage {
  createUploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<string>
  createDownloadUrl(key: string, ttlSeconds: number): Promise<string>
  getObjectMetadata(key: string): Promise<{ byteSize: number; contentType: string } | null>
  deleteObject(key: string): Promise<void>
}
```

**R2 gotcha:** AWS SDK JS v3 >= 3.729 defaults `requestChecksumCalculation` to
`WHEN_SUPPORTED`, adding an `x-amz-checksum-crc32` header that breaks R2
presigned PUTs. Construct the `S3Client` with
`requestChecksumCalculation: 'WHEN_REQUIRED'`.

**Never sign `ContentLength`** — it forces the browser to send exactly that byte
count. Sign `Bucket`/`Key`/`ContentType` only and enforce size server-side with
`HeadObject` on completion. That is what makes "do not trust frontend-reported
size" true.

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
- **Object keys carry no PII** — internal ids only.
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
enum ProctoringAssetType     { WEBCAM_SEGMENT SCREENSHOT }
enum ProctoringAssetStatus   { PENDING UPLOADED FAILED EXPIRED DELETED }
```

- `ProctoringAsset` idempotency key: `@@unique([proctoringSessionId, type, sequence])`
- `ProctoringEvent` dedup key: `@@unique([proctoringSessionId, clientEventId])`

Full definitions in `part-01-schema-and-config.md`.
