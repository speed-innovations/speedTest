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
| 5 | Upload APIs | ✅ DONE | 1e7e20d | 2026-09-21 |
| 6 | Events API | ✅ DONE | 8289cc9 | 2026-09-21 |
| 7 | Client core services | ✅ DONE | 0114b9b | 2026-09-21 |
| 8 | Gaze detection | ✅ DONE | f45e1bc | 2026-09-21 |
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

### Part 5 — 2026-09-21

Commit `1e7e20d`, local, not pushed.

**`tsconfig.json` targets `es5`.** The part file's `evictExpired` iterated a Map
with `for...of` and spread, which is `TS2802` without `downlevelIteration` — the
first typecheck failure in this plan. Rewritten with `forEach` rather than
changing the project's compile target for one helper; part file updated to
match. **Worth remembering for every later part: no `for...of` over a Map or
Set, no spreading one, in `src/`.** (Arrays are fine.) `scripts/` has its own
tsconfig and is not affected.

One deliberate tightening beyond the part file: `issueUploadUrl` signs
`asset.objectKey` — the key already stored on the row — not the key it just
derived. On a retry that changed a screenshot's format the derived extension
would differ from the object the row points at, and the signed URL would write
to a key nothing referenced. Commented in place.

The oversize case is tested the way the part file asked, and it is the one that
would catch a regression to trusting client-declared sizes: nothing in the
request body carries a size at all, so only `HeadObject` can see 400 MB arrive
under a request that implied 40 KB. The object is deleted, the asset marked
`FAILED` with `byteSize` 0, and `storageUsedBytes` stays 0.

Routes are written but not exercised over HTTP; as with Parts 3-4 the tests
drive the lib layer. The rate limiter is therefore tested directly and not
through a route.

Verification: `npx tsc --noEmit -p tsconfig.json` exit 0 (checked the exit code,
not just the output); `npm test` exit 0, 152 passed across 14 files.
`scripts/tsconfig.json` not run — no scripts touched.

### Part 6 — 2026-09-21

Commit `8289cc9`, local, not pushed. **The backend is now complete** — Parts 7-9
build the client against these endpoints and should not need to change the API
surface.

The part file was accurate; one small hardening and one thing checked rather
than assumed:

- `z.record(valueSchema)` with a single argument was a zod 3 signature, so it
  was worth confirming under zod 4.6 rather than trusting it. It still works and
  still validates values (verified directly: an over-long value and a nested
  object are both rejected). I used the two-argument form anyway,
  `z.record(z.string().max(40), ...)`, because the single-argument form bounds
  only the values — a client could otherwise send a megabyte of *key* text.
  Part file updated.
- `metadata: e.metadata ?? undefined` on a `createMany` omits the column and
  takes the DB default of null. That is the right outcome here and not the
  Prisma `undefined` hazard the README warns about, since there is no existing
  row to leave alone.

Two tests beyond the part file's list: non-gaze events must not touch
`gazeWarningCount`, and bounded metadata round-trips through the Json column.

Verification: `npx tsc --noEmit -p tsconfig.json` exit 0; `npm test` exit 0,
160 passed across 15 files. `scripts/tsconfig.json` not run — no scripts
touched.

### Part 7 — 2026-09-21

Commit `0114b9b`, local, not pushed.

**The vitest config change disturbed nothing.** Part 12's step called this the
riskiest edit in the part, so it was run in isolation first: all 15 pre-existing
test files (160 tests) passed unchanged under the widened config before any new
code was written. The per-file `// @vitest-environment jsdom` docblock works;
only `tests/proctoring-screen-capture.test.tsx` opts in, and node stays the
default for everything else.

**`@vitejs/plugin-react` had to be pinned to `^4`.** Its current major (6.1.1)
peers on `vite@^8`, while vitest 2.1.9 pins `vite@5`, so the part file's
unpinned install fails outright with `ERESOLVE`. v4 supports vite 5 properly, so
this is a pin rather than a `--legacy-peer-deps` fudge. Part file updated. The
plugin is not actually needed by anything in this part - no component is
rendered - but Part 9 will want it.

Two of my own test bugs, both fixed in the tests rather than the code, worth
knowing because the same shapes will recur in Part 9:

- The upload-queue "never evicts an in-flight item" case hung the suite for 5s
  and timed out. The queue was right; the test handed it an upload promise that
  never settled and then awaited `drain()`. Any test that blocks an upload must
  unblock every item before draining.
- Every screen-capture case initially recorded zero `toBlob` calls, because they
  called `capture()` without `start()` — `capture()` returns early when there is
  no video element. They now drive `start()`, which is also the real entry point
  and takes the immediate first snapshot that `quota.ts` budgets for.

Also note `ScreenCapture.waitForDimensions` polls on a real 100ms `setInterval`
with a 5s timeout. A test for the zero-dimension path must inject a `now` that
leaps forward, or it holds the suite for the full 5 seconds.

Both "Done when" greps pass: no `MediaRecorder` anywhere in `screen-capture.ts`
(the screen is sampled, never recorded), and no React import anywhere under
`client/`.

Verification: `npx tsc --noEmit -p tsconfig.json` exit 0; `npm test` exit 0,
199 passed across 19 files. `scripts/tsconfig.json` not run — no scripts
touched.


### Part 8 — 2026-09-21

Commit `f45e1bc`, local, not pushed.

**The vendored assets are ~26 MB, not the ~6 MB the part file assumed.** The
model is 3.6 MB as expected, but `@mediapipe/tasks-vision`'s `wasm/` directory
is ~34 MB. I copied only the single-threaded builds (SIMD + no-SIMD, 23 MB) and
skipped `vision_wasm_module_internal.*` — that is the threaded build, it needs
`SharedArrayBuffer`, and the part file itself forbids adding the COOP/COEP
headers that would make it loadable. Copying it would have added 12 MB that can
never execute. Part file updated with the real figures and the reason.

The repo is now meaningfully larger, and that is a deliberate trade the plan
already made: a CDN fetch that fails mid-assessment breaks proctoring after the
candidate has granted permissions and started the clock.

Smaller notes:

- The part file's no-network grep is a **false positive** as written: a bare
  `fetch` match flags `gaze-monitor.ts`'s own comment explaining *why* the model
  is self-hosted rather than CDN-fetched. Tightened to match call sites
  (`fetch(`, `sendBeacon(`, `new XMLHttpRequest`); it now passes honestly. There
  are no network calls in any gaze module.
- `node -e "require('@mediapipe/tasks-vision/package.json')"` fails with
  `ERR_PACKAGE_PATH_NOT_EXPORTED` — the package does not export its manifest.
  Read the version from `package.json` in the repo instead. It resolved to
  `^1.0.1`.
- The iris gain in `classifyGaze` is derived from the thresholds
  (`yawDeg / irisRatio`) rather than tuned as a separate constant, so an iris
  pushed fully to `irisRatio` contributes exactly one yaw threshold. That keeps
  the two from drifting apart, and it is what makes "head centred, eyes hard
  over" detectable at all.
- Added cases beyond the part file's list: a non-finite signal classifies as
  `UNCERTAIN` rather than CENTER (a degenerate matrix would otherwise silently
  disable detection), cooldowns are independent per warning type, switching
  direction restarts the sustained timer, and `reset()` clears cooldowns too.
- Baseline uses the **median** of its samples, not the mean: one frame of the
  candidate glancing away during calibration would drag a mean and skew the
  whole session.

**Not verified, and must not be claimed: that real faces classify correctly.**
Synthetic signals prove the logic, not the model, and the yaw/pitch sign
convention in `extractSignals` can only be confirmed against a real camera.
Part 14's manual test is where looking left actually has to produce LEFT.

Verification: `npx tsc --noEmit -p tsconfig.json` exit 0; `npm test` exit 0,
226 passed across 21 files. `scripts/tsconfig.json` not run — no scripts
touched.

