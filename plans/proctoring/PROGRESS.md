# Proctoring — progress ledger

`/nextpartofplan` reads this file, picks the first part whose status is
`NOT STARTED`, loads `README.md` plus that one part file, executes it, then
updates the row below and commits **locally**.

**Never push.** Parts 1–14 are local-only. Part 15 is the release gate and runs
only on the owner's explicit go-ahead.

Branch: `feat/proctoring`

---

## Status

| # | Part | Status | Commit | Date |
|---|---|---|---|---|
| 0 | Plan infrastructure | ✅ DONE | c9b9f1c | 2026-09-21 |
| 1 | Schema, migration, config | ✅ DONE | 5a3265a | 2026-09-21 |
| 2 | Storage abstraction | ✅ DONE | 908fa30 | 2026-09-21 |
| 3 | Quota and reservation | ✅ DONE | ed5c3dd | 2026-09-21 |
| 4 | Session lifecycle API | ✅ DONE | ef1f428 | 2026-09-21 |
| 5 | Upload APIs | ⬜ NOT STARTED | — | — |
| 6 | Events API | ⬜ NOT STARTED | — | — |
| 7 | Client core services | ⬜ NOT STARTED | — | — |
| 8 | Gaze detection | ⬜ NOT STARTED | — | — |
| 9 | Candidate UI | ⬜ NOT STARTED | — | — |
| 10 | Admin review UI | ⬜ NOT STARTED | — | — |
| 11 | Retention and cleanup | ⬜ NOT STARTED | — | — |
| 12 | zod retrofit | ⬜ NOT STARTED | — | — |
| 13 | Playwright E2E | ⬜ NOT STARTED | — | — |
| 14 | Docs and local verification | ⬜ NOT STARTED | — | — |
| 15 | **Release — GATED** | 🔒 BLOCKED | — | — |

Statuses: `⬜ NOT STARTED` · `🟡 IN PROGRESS` · `✅ DONE` · `🔒 BLOCKED`

Part 15 stays `🔒 BLOCKED` until the owner says otherwise, even when 1–14 are
all done. `/nextpartofplan` must stop after Part 14 and report, not proceed.

---

## Definition of done for every part

A part is `✅ DONE` only when all of these are true:

- [ ] Every checkbox in its part file is ticked.
- [ ] `npx tsc --noEmit -p tsconfig.json` passes.
- [ ] `npx tsc --noEmit -p scripts/tsconfig.json` passes (if the part touched `scripts/`).
- [ ] `npm test` passes — **the whole suite**, not only the new tests.
- [ ] A local commit exists on `feat/proctoring` and its hash is in the table.
- [ ] Nothing was pushed.

If a part cannot be completed, set it `🟡 IN PROGRESS`, write what is blocking it
in the Notes below, and stop. Do not start the next part on top of a broken one.

---

## Notes

Running log — append, do not overwrite. Record surprises, deviations from the
part file, and anything the next session needs to know.

### Part 0 — 2026-09-21

Created `plans/proctoring/` and `.claude/commands/nextpartofplan.md` on branch
`feat/proctoring`, cut from `main` at `38e1bec`.

Pre-existing repo conditions worth knowing before starting Part 1:

- `npm run lint` is **dead** — `next lint` is declared in `package.json` but
  eslint is not installed and there is no config. CI never calls it (it runs
  `tsc --noEmit` twice instead). Do not add "run lint" to any part's
  verification; it will fail for reasons unrelated to the change.
- `next.config.js` still carries a webpack `externals` rule for
  `@app/prisma-client`, a shim that was deleted. It is inert but misleading.
  Out of scope here; flagged so nobody treats it as proctoring's doing.
- `.dev.vars`, `.open-next/`, `.wrangler/` are stale Cloudflare artifacts. All
  gitignored. Ignore them.
- Local Postgres is 18; production Supabase is not. The migration is additive
  DDL plus one `CHECK`, so divergence is unlikely — but Part 15 verifies the
  tables by inspection rather than trusting command output.

### Part 1 — 2026-09-21

Migration `20260921095859_add_proctoring`, applied to local Postgres only.
Supabase untouched. Commit `5a3265a`, local, not pushed.

Deviations from the part file, both driven by zod:

- **zod resolved to 4.6.5**, not v3. The part file's schema code compiles and
  behaves as written — `z.string().url()` still exists in v4 (deprecated in
  favour of `z.url()`, not removed), `.optional().transform().pipe()` is
  unchanged, and `parsed.error.issues` is unchanged. No rewrite was needed.
  A future zod major will remove `z.string().url()`; the only use is
  `r2Schema.R2_ENDPOINT`.
- **Empty strings are treated as unset**, in both the `bool`/`int` helpers and
  `R2_ENDPOINT`. Step 16 anticipated this for `R2_ENDPOINT` only, but the same
  hazard applies to every variable: `.env.example` ships `VAR=""` placeholders
  and dotenv loads those as `''`, so `Number('')` is `0` and would have failed
  every `min()` bound. `R2_ENDPOINT` is `z.union([z.string().url(),
  z.literal('')])` and falls back to the account-derived endpoint. Two extra
  tests cover this (10 tests total, not 8).

The CHECK constraint was verified two ways rather than one: the insert with
neither FK set is rejected, and `pg_constraint` shows
`ProctoringSession_exactly_one_attempt` with the expected definition. The
rejection message's last line is the Postgres `DETAIL:` row dump, not the
constraint name, so the part file's expected-output line is slightly optimistic
— the name appears earlier in the multi-line message.

Verification: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 84 passed
across 7 files. `scripts/tsconfig.json` not run — this part touched no scripts.

### Part 2 — 2026-09-21

Commit `908fa30`, local, not pushed. The part file's code was accurate — no
corrections needed to it.

- `@aws-sdk/client-s3` resolved to **3.1136.0**, far past the 3.729 cutoff, so
  `requestChecksumCalculation: 'WHEN_REQUIRED'` is load-bearing, not
  precautionary. It is set, and `ContentLength` is not signed.
- Added three tests beyond the part file's list, in
  `tests/proctoring-storage-mock.test.ts`, covering `getStorage()` itself: the
  mock default, memoisation, and — the one that matters — that selecting `r2`
  without credentials **throws** rather than silently handing back a
  `MockStorage`. The part file specified that behaviour in its "Done when" but
  tested only `MockStorage`, so nothing would have caught a regression to a
  fallback.
- No `.env` change: `PROCTORING_STORAGE_PROVIDER` is unset locally, which
  defaults to `mock`. Nothing in this part needs credentials.

Still unverified, and must not be claimed: that R2 actually accepts these
presigned URLs. That needs real credentials and a browser PUT — Part 14.

Verification: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 100 passed
across 9 files. `scripts/tsconfig.json` not run — no scripts touched.

### Part 3 — 2026-09-21

Commit `ed5c3dd`, local, not pushed.

**The Step 1 SUM result, recorded as required — Part 10's usage page depends on
it.** Prisma's pg driver adapter surfaces `SUM(int)` past 2^31 as a **plain JS
number**, not a bigint and not a string: a four-row fixture at 2 GB each
aggregated to exactly `8000000000`, `typeof` `number`, and
`Number.isSafeInteger` true. **No raw-query cast is needed** — the fallback
`$queryRaw ... ::double precision` in the part file stays unused. The `Number()`
calls in `currentUsageBytes()` are there for the null-when-no-rows case only,
not for a bigint conversion.

Two corrections made to the part file itself, because its listed code would not
have compiled:

- `RESERVING` was `['PENDING','ACTIVE','DEGRADED'] as const` and then passed as
  `RESERVING as unknown as string[]`. Prisma's `in` filter takes
  `ProctoringSessionStatus[]`, which a `string[]` does not satisfy. It is now
  typed as the generated enum and the casts are gone. `sweepStaleReservations`
  also had the same three statuses inlined a second time; it now reuses the
  constant, so the two can no longer drift apart.
- `canStartProctoredAssessment` used a dynamic `await import('./config')` to
  reach `getR2Config`. Nothing requires that — `config.ts` is already imported
  at the top of the module — so it is a plain top-level import now.

The math matched the PRD's worked example first try: 60 minutes reserves exactly
111,000,000 bytes (86.4 MB media + 61 screenshots, x1.2).

Verification: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 114 passed
across 11 files. `scripts/tsconfig.json` not run — no scripts touched. The DB
tests wrote to local Postgres only.

### Part 4 — 2026-09-21

Commit `ef1f428`, local, not pushed.

**One real design gap found, fixed in both the code and the part file.** The
`@unique` on `ProctoringSession.testAttemptId` / `walkInAttemptId` is per
attempt, *not* per attempt-and-status, so a finalized session permanently
occupies its attempt. The part file's `startSession` caught `P2002`, looked for
a live session, and rethrew the raw Prisma error when it found none — which
`errorResponse` renders as a generic 500. That is exactly the path a candidate
takes if they reload after submit. It now throws
`HttpError(409, 'PROCTORING_SESSION_CLOSED')`, and there is a test for it.
Note the consequence: **one proctoring session per attempt, ever.** A closed
session cannot be restarted. Part 9's recovery screen must resume the existing
ACTIVE session, never expect to create a second one.

Smaller notes:

- `parseBody` takes `ZodType<T>`, not `ZodSchema<T>`. zod 4 still exports
  `ZodSchema` as a deprecated alias, but it is now `ZodType`'s any-typed form
  and does not carry the `T`, so the generic would silently widen. Part file
  updated.
- `recordHeartbeat` uses `|| undefined` on `recordingStarted` /
  `screenShareStarted`. That is the Prisma "leave this column alone" behaviour
  the README warns about, used here **deliberately** as a latch — the question
  those columns answer is "did this ever start?". Commented in place so nobody
  reads it as the bug the README describes.
- Step 9 needed real edits, not just confirmation: the scheduled GET returns the
  nested `schedule` (which does carry the flag), but the walk-in GET builds a
  hand-rolled `testPayload` that does **not** include it. Both now return a
  top-level `proctoringEnabled`, in both the `started: false` and `started: true`
  branches — four places.
- The new test file overrides `PROCTORING_STORAGE_SAFETY_BYTES` per case rather
  than using the default, because `tests/proctoring-quota-db.test.ts` parks 8 GB
  of reservations in the same table and vitest may run the two files
  concurrently. Any future quota-sensitive test needs the same treatment.

`requireAdmin` is added but not yet used by anything; Part 10's admin routes are
its first caller. The ~50 existing inline admin checks are untouched by design.

Verification: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 133 passed
across 12 files — including the pre-existing `attempt-ownership` and `responses`
suites, which exercise the two `/start` routes the gate was added to.
`scripts/tsconfig.json` not run — no scripts touched.

