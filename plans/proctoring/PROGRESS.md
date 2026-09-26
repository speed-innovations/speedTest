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
| 9 | Candidate UI | ✅ DONE | 220625b | 2026-09-21 |
| 10 | Admin review UI | ✅ DONE | 70f5d01 | 2026-09-21 |
| 11 | Retention and cleanup | ✅ DONE | 3448ebf | 2026-09-24 |
| 12 | zod retrofit | ✅ DONE | 89da43f | 2026-09-24 |
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

### Part 9 — 2026-09-21

Commit `220625b`, local, not pushed. **Step 12 (the manual browser smoke test)
is NOT done** — see below. Every other step is ticked.

**`needsRecovery` is not the formula the part file gave.** The part file said
`enabled && alreadyStarted && state !== 'ACTIVE'`. That is correct at the moment
of load and wrong immediately after: a candidate who stops screen sharing
mid-exam leaves ACTIVE, so the exam UI would be replaced by the recovery screen
and their questions would vanish under them. It is now
`enabled && alreadyStarted && !captureLive`, where `captureLive` records whether
this page instance ever brought capture up. A mid-exam screen stop shows a
resume banner beside the questions instead. Part file corrected.

Three additive changes to `UseProctoringResult`, all because a component could
not do its job without them — part file updated:

- `startError` — `ProctoringSetup` cannot otherwise tell a 503 storage refusal
  from any other failure, and `ProctoringRecovery` needs the
  `PROCTORING_SESSION_CLOSED` code.
- `capture` (`recording`/`screenSharing`/`cameraLive`/`micLive`) — the status
  indicator must not infer "recording" from the state name.
- `DeviceStatus` was referenced by the part file but never defined.

**Order of the permission prompts is load-bearing: screen BEFORE camera.**
`getDisplayMedia` needs transient user activation, which expires a few seconds
after the click, and a first-time camera prompt easily outlasts it. Asking for
the screen while the gesture is fresh is what stops "allow camera" from making
screen sharing impossible. Consequence the tests assert: a screen denial never
prompts for the camera at all.

**`PROCTORING_SCREEN_REQUIRED=false` is not honoured by the pre-check.** The flag
arrives with the session config, and the session must not be created before
permissions are granted — otherwise a candidate who then denies them leaves a
live ACTIVE session that `/start` would accept, defeating the whole gate. The
pre-check therefore always requires screen sharing, which is the config default.
Honouring the flag needs it on the session GET response. Flagged, not fixed.

**Gaze inference reads the hook's own off-DOM video element**, not the rendered
`CameraPreview`. The preview unmounts when the page switches from the pre-check
to the questions; binding inference to it would kill detection at that exact
moment. Separately, the visible preview needed an effect with **no dependency
array** to re-attach `srcObject` after that remount — a one-shot attach at start
left the exam's self-view permanently blank. Found by reading the diff, not by a
test; jsdom would not have caught it.

**MediaPipe must be `vi.mock`ed in any jsdom test that starts proctoring.**
`GazeMonitor.create` never settles under jsdom (3.6 MB model plus multi-megabyte
WASM), so it hangs the suite rather than failing it — that was the first test
failure here, presenting as a state stuck in `STARTING`. Both new test files mock
the `gaze-monitor` module.

`lucide-react` is 0.344 and has no `CloudUpload`; it is `UploadCloud`.

**A swept session is a dead end for the candidate.** The unique index on the
attempt FK is per attempt, not per attempt-and-status, so once the stale sweep
marks a session INTERRUPTED (180 s without a heartbeat by default) it cannot be
reopened — while the exam clock keeps running. `ProctoringRecovery` detects
`PROCTORING_SESSION_CLOSED` and says so plainly instead of offering a button that
can only fail again. This is inherited from Part 4's locked schema, not
introduced here, but Part 14 or 15 should decide whether it is acceptable.

**Step 12 is blocked, not skipped.** The smoke test needs a signed-in student.
The local fixture is there — `Manual Verification Test`
(`cmu5hlfs50006hg3hf7xpxjyy`, `proctoringEnabled = false`, 5 min) with students
`student.a@` / `student.b@mitcoe.edu.in` — but no password is recorded for
either, and the schedule window closed on 2026-09-17. Setting a dev password and
moving the window are both local-Postgres writes and the write was refused by
this session's permission policy; I did not work around it. **Nothing about the
non-proctored path has been confirmed in a real browser.** The hook-level
regression guard passes (`enabled: false` issues no `getUserMedia` and no
`fetch`, state stays `IDLE`), and `npm run build` succeeds, but that is not the
same evidence. Part 14 must do this, and must also cover the two things no test
in Parts 8–9 can reach: a real camera proving the gaze sign convention, and a
real R2 presigned PUT.

Verification: `npx tsc --noEmit -p tsconfig.json` exit 0; `npm test` exit 0,
**238 passed across 23 files**; `npm run build` exit 0 — both candidate pages at
199 kB First Load JS, identical, which is itself a parity check.
`grep -rl "R2_SECRET_ACCESS_KEY\|R2_ACCESS_KEY_ID" .next/static` empty, and so
is a grep for the R2 endpoint host and `DATABASE_URL`. `scripts/tsconfig.json`
not run — no scripts touched. Step 7's grep parity: 7 and 7 on the narrow
pattern, 49 and 49 on every proctoring reference.

### Part 10 — 2026-09-21

Commit `70f5d01`, local, not pushed. All 11 steps ticked.

**The read models live in `src/lib/proctoring/admin.ts`** — `getAdminEvidence`
and `getUsageReport` — which the part file's file list omitted even though its
own test snippet called `getAdminEvidence`. The routes are thin Convention B
wrappers. This matters for the leak checks: they stringify the real return value,
so a future `include` pulling in `objectKey`, or someone bulk-signing URLs to
save a round trip, fails the suite instead of shipping. The body is asserted to
contain no `objectKey`, no `assessment-proctoring/`, no `X-Amz-Signature`, no
`uploadUrl`, and no `http` at all.

**The download-url route already existed** from Part 5 at
`api/admin/proctoring/assets/[id]/download-url`. Nothing new was needed; both
the player and the gallery call it one asset at a time.

Three things the part file could not have known, all now recorded in it:

- **Prisma orders enum columns by declaration order, not alphabetically.**
  `orderBy: { type: 'asc' }` gives `WEBCAM_SEGMENT` then `SCREENSHOT`. A test
  pins it, because adding an asset type above `WEBCAM_SEGMENT` in the schema
  would silently reorder this response.
- **`PROCTORING_STORAGE_SAFETY_BYTES` has a 100 MB floor**, so the over-budget
  case cannot be made by lowering the budget below the fixtures. That test parks
  a 2 GB reservation on a throwaway walk-in attempt and removes it in a
  `finally`.
- **Top-level `await` is illegal at this project's `es5` target** (TS1378) — it
  ran green under vitest and only failed `tsc`. Static imports are correct;
  `vi.mock` is hoisted above them. **Parts 11–13: do not reach for
  `await import()` in tests.**

Usage arithmetic is asserted as an **invariant** (`total = reserved + stored`,
`remaining = max(0, safety - total)`) rather than against fixed numbers, for the
same reason Part 4 recorded: other suites write into these tables and vitest may
run them concurrently.

**`npm run build` is blocked while the dev server runs, and this is worth
knowing before Part 14.** The user's `npm run dev` (port 3001) holds
`query_engine-windows.dll.node`, so `prisma generate` fails `EPERM` — the
documented CLAUDE.md hazard. I did **not** kill their server. This part changed
no schema, so I ran `npx next build` directly. That *also* failed once, in
"Collecting page data", with a spurious `MODULE_NOT_FOUND: ./5611.js`: the dev
server rewrites the shared `.next` directory mid-build. A retry succeeded
cleanly. **Do not read either failure as a code defect** — but Part 14's
verification will want the dev server stopped first.

Neutral-language requirement honoured throughout: `EventTimeline` maps each
event type to a plain description ("Looking left", "Second face detected"), shows
a count and never a rate, percentile or grade, and the panel closes with a line
saying gaze analysis cannot distinguish thinking from looking away. No severity
colouring, no risk badge, no candidate ranking anywhere.

The panel is collapsed by default and **fetches nothing until opened**, so the
existing score-review flow is unchanged for reviewers not looking at proctoring.
The tab-switch violations strip above it is untouched and deliberately not merged
with proctoring events.

Verification: `npx tsc --noEmit -p tsconfig.json` exit 0; `npm test` exit 0,
**255 passed across 24 files** (17 new); `npx next build` exit 0 on retry, with
`/admin/proctoring`, `/api/admin/proctoring/[attemptId]` and
`/api/admin/proctoring/usage` all present in the route table. A grep of
`.next/static` for `objectKey` and `X-Amz-Signature` is empty.
`scripts/tsconfig.json` not run — no scripts touched.

Also cleaned up: an orphaned `node -e` psql probe of my own from earlier in the
session (PID 6024) was still holding a DB connection and was killed. The user's
dev server was left running.

### Out of band — admin toggle for `Test.proctoringEnabled` — 2026-09-24

Commit `30c7dfc`, local, not pushed. **Not part of any numbered part** — a gap
found while the owner was manually testing.

`Test.proctoringEnabled` was accepted by no admin API route and rendered on no
admin page. The column could only be changed by writing to the database by hand,
which meant **the feature could not be switched on in production at all**. The
plan never assigned this to a part; Parts 1-10 all assumed the column was
already settable.

Added: the field on `POST /api/admin/tests` and `PUT /api/admin/tests/[id]`, a
checkbox on the new and edit test forms, and a toggle button plus a "Proctored"
badge on the tests list.

Two deliberate details, both covered by `tests/proctoring-test-toggle.test.ts`:

- **The update route writes the column only when an explicit boolean arrives**,
  leaving it `undefined` otherwise. That is the Prisma "leave this column alone"
  behaviour the README flags as a hazard, used here on purpose and consistently
  with how every other field in that route already behaves — the tests list
  sends single-field PUTs (the walk-in toggle sends only `isWalkIn` and
  `status`), and one of those must never silently un-proctor a test. That is the
  regression the test file exists for.
- **Creation requires `=== true`**, not a truthy check. A form that serialised
  the checkbox as a string must not start recording candidates, and `"false"` is
  truthy.

These two routes stay Convention A (inline session check). They were not
converted to Convention B here — that is Part 12's bounded retrofit, and
rewriting them while adding a field would have mixed a behaviour change into a
refactor.

Verification: `npx tsc --noEmit -p tsconfig.json` exit 0; `npm test` exit 0,
**263 passed across 25 files**, run twice; `npx next build` exit 0.

### Local environment — 2026-09-24

`.env` had no proctoring block at all, so `PROCTORING_ENABLED` defaulted to
false and every session start was refused 503 `PROCTORING_DISABLED`. Both local
tests also had `proctoringEnabled = false`, so the candidate page showed the
plain Start button and no pre-check. Both fixed locally (`.env` is gitignored;
the column was set on both local test rows).

**Do not set the cadence knobs in `.env`.** vitest reads that file, and
`PROCTORING_SCREENSHOT_INTERVAL_MS` / `PROCTORING_VIDEO_SEGMENT_MS` feed
`estimateAttemptBytes`, so overriding them breaks the pinned reservation
arithmetic in `proctoring-quota-math` and `proctoring-session-api`. Set them
per-command instead.

Still outstanding before this works end to end with real storage: R2
credentials, a bucket CORS rule allowing PUT from the app origin, the proctoring
migration applied to Supabase by hand, and Part 11's cleanup job — without which
the 7 GB budget fills once and stays full.

### Part 11 — 2026-09-24

Commit `3448ebf`, local, not pushed. All 9 steps ticked.

**The workflow exists but is INERT.** `.github/workflows/proctoring-cleanup.yml`
is committed, but a scheduled workflow only becomes active once it is on the
default branch. **Part 15 must verify its first real run** — and set the
`CRON_SECRET` repository secret before merging, or the first scheduled run fails
on a missing secret rather than on anything interesting. `vars.APP_URL` falls
back to the Render URL, so that one is optional.

**One placement correction to the part file.** It said to add the finalization
safety net "after the `$transaction` closes", but both submit routes have *two*
return paths — the early return for an already-submitted attempt, and the normal
one. Putting the net after the early return would skip finalization on exactly
the re-submit case where the client most likely died. It now sits immediately
after the transaction, ahead of both returns, in both files.

Smaller corrections, all made in the part file too:

- `DELETABLE` is typed `ProctoringAssetStatus[]`, not `as const` plus a cast —
  the same fix Part 3 made to `RESERVING`.
- MockStorage's seed helper is `putForTest`, not `put`.
- The workflow uses `sed '$d'` rather than the GNU-only `head -n -1`.

**Five route-handler tests added beyond the part file's list.** It only asked
for a manual curl, which cannot run in CI and does not cover the unset-secret
path. The handler is now pinned for 200 on a correct secret, 401 on a wrong one,
401 on a missing header, acceptance of a bare token without the `Bearer` prefix,
and **503 rather than a fall-through when `CRON_SECRET` is unset** — a
misconfigured deployment must not end up running cleanup unauthenticated.

The budget test asserts this session's own contribution rather than a global
before/after subtraction, for the concurrency reason that flaked Part 10's usage
test.

`CRON_SECRET` was generated and added to local `.env` (gitignored).
`.env.example` already documented it from Part 1 — nothing to add there.

Verification: `npx tsc --noEmit -p tsconfig.json` exit 0; `npm test` exit 0,
**271 passed across 26 files**, run twice. Step 7 was exercised against the
running dev server for real: the correct secret returned HTTP 200 with a full
report, a wrong secret returned **401**. `scripts/tsconfig.json` not run — no
scripts touched.

Next session note: Part 12 is the zod retrofit. Remember **top-level `await` is
illegal at this project's `es5` target** — static imports with hoisted
`vi.mock`, not `await import()`.

### Part 12 — 2026-09-24

Commit `89da43f`, local, not pushed. 9 of 10 steps ticked; **Step 8 (exercise
the admin UI by hand) is NOT done** — see below.

**Routes retrofitted** (all now `requireAdmin` + `parseBody` + `errorResponse`):

| Route | Methods |
|---|---|
| `api/admin/tests` | GET, POST |
| `api/admin/tests/[id]` | GET, PUT, DELETE |
| `api/admin/colleges` | GET, POST |
| `api/admin/colleges/[id]` | GET, PUT, DELETE |
| `api/admin/questions` | GET, POST |
| `api/admin/questions/[id]` | PUT, DELETE |
| `api/admin/job-openings` | POST (GET left public, as it was) |
| `api/admin/job-openings/[id]` | PUT, PATCH, DELETE |

**Still on Convention A**, deliberately out of scope: every other admin route
(candidates, coordinators, results, schedules, shortlist, walkin-*, stats,
import/export). `api/admin/candidates/import` and `api/admin/questions/import`
still return `err.message` in a 500 — the only two remaining leaks of that kind.

**A real data-loss bug was found and fixed.** `PUT /api/admin/tests/[id]` read
`jobOpeningId: body.jobOpeningId || null`, so an omitted field became `null`.
Every single-field PUT from the tests list — the walk-in toggle, and the
proctoring toggle added in Part 10 — silently unlinked the test's job opening.
I confirmed it against the old code with a throwaway probe before changing
anything, rather than asserting it from reading. Now `undefined` means absent
and only an explicit `null` clears it; both behaviours are pinned by tests.

**The part file was wrong about `pickQuestionsByConfig`** — it already took a
typed `AreaConfig`, not `any[]`. More significantly, its file list said to
modify `src/lib/question-picker.ts`, which the README **forbids outright**.
Resolved by not touching it: the schema exports `AreaConfigInput` and the four
student call sites use it instead of `as any[]`. Type-only, and deliberately no
parse at read time — a legacy row must not start throwing for a candidate
mid-drive. Strictness belongs on the write path.

**Both assessmentConfig shapes are live in the database.** Three rows carry
percentages, the oldest carries `{area, count, marks}`. `marks` is preserved
rather than stripped.

**Update schemas are `.partial()`**, which is load-bearing — the admin UI sends
single-field bodies and a strict update schema would have broken both toggles.

Four tests in `proctoring-test-toggle.test.ts` were **updated, not loosened**:
they asserted a non-boolean being silently ignored (now 400) and 401 for an
authenticated non-admin (now 403). Both are the improvement this part makes.

**`vitest.config.ts` now sets `fileParallelism: false`, and this matters beyond
this part.** Every integration suite shares one database; parallel files put one
suite's fixtures into another's aggregates, and once Part 11 added a sweep that
*deletes* expired assets, another suite's fixtures would vanish mid-test. Four
separate intermittent failures traced to this — including one I had wrongly
reported as green in Part 10 off a single run. Sequential files cost ~17s
(7s → 24s). **Do not revert this to speed the suite up.**

**Step 8 is blocked, not skipped.** Running `npx next build` while the dev server
is up overwrites the shared `.next`, after which the dev server serves HTML
referencing chunks that no longer exist — 404s on every static asset and a blank
page. Recovering needs a dev-server restart, which is the owner's process, so I
stopped rather than killing it. Covered instead by a deterministic substitute: a
new block in `tests/admin-validation.test.ts` pins the **exact payload each real
admin submit handler builds** (new test, edit test, CollegeForm, question-bank
`emptyQ()`, job-openings create and its PATCH) against its schema. That catches
the failure Step 8 exists to catch — a form shape the schema rejects — but not
rendering or error display. **Part 14 must click through the admin forms by
hand, with the dev server freshly restarted.**

Verification: `npx tsc --noEmit -p tsconfig.json` exit 0; `npm test` exit 0,
**302 passed across 27 files**, run **six consecutive times** after the
parallelism fix; `npx next build` exit 0. `scripts/tsconfig.json` not run — no
scripts touched.

### Live-monitoring phase — 2026-09-26

Tasks 1–15 of `live-monitoring-plan.md` (the phase that replaced the
media-recording design). Commit hashes as recorded by each task; two hashes
means the task landed in two commits.

| Task | Description | Commit(s) |
|---|---|---|
| 0 | Spec and implementation plan | `ff1b34b` |
| 1 | Remove media storage, uploads and quota | `a465b1c` |
| 2 | Metadata event taxonomy and migration | `56610cb` |
| 3 | Detection config, frame signals and fusion | `3444336` |
| 4 | Median baseline and temporal engine | `522604e` |
| 5 | Behaviour tracker, detection pipeline, warning copy | `a46d5e6` |
| 6 | MediaPipe shell on the fusion pipeline, rVFC, CPU fallback | `42f55fa` |
| 7 | Integrity monitor for tracks and page events | `c19f6e9` |
| 8 | Bounded, rate-capped event queue; severity-aware overflow on requeue | `4691106` + `2d4622b` |
| 9 | Session-bound events and heartbeats, server-side gaps, resume, stale-sweep recheck, session rate limit | `fd94621` + `4efa9d5` |
| 10 | `/start` gate pinned for both attempt kinds; clock stays unset on refused starts | `bd7c8e8` + `d312bb2` |
| 11 | Client hook on live monitoring (no recorder, no uploads); cancel in-flight starts, keep events across interruption | `065a9aa` + `bd85108` |
| 12 | Visible monitoring panel, integrity notices, honest setup copy | `6f8703e` |
| 13 | Development-only diagnostics panel | `deeaf61` |
| 14 | Admin-only `PROCTORING_REVIEW_SIGNAL` | `b239288` |
| 15 | No-media guard test, docs, security review, ledger | this commit |

Notes carried forward from this phase:

- Parts 13 (Playwright E2E) and 14 (docs and local verification) were written
  for the media design. Their part files are stale and must be rewritten
  against `live-monitoring-plan.md` before they are run.
- Part 15 (release) is still blocked. It must apply **both** proctoring
  migrations to Supabase by hand, in order, and must no longer set up R2.
- The sign convention in `DETECTION_CONFIG.signs` is **unverified** until the
  owner completes the manual script in Step 6 (below, in the Task 15 report).
- Owner-local cleanup: `.env` may still hold `PROCTORING_STORAGE_PROVIDER`,
  `R2_*` and the gaze `*_MS` variables. They are now ignored and can be
  deleted.

#### Security review (spec P28)

Verified against the running code and the cited tests (grepped for the
`it(`/`test(` title, then opened and read each one).

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Start without a valid proctoring session? | No: `/start` returns 409 `PROCTORING_REQUIRED` and the clock stays unset | `proctoring-start-gate.test.ts` → `'refuses without any proctoring session, and the clock does not start'` |
| 2 | Disable the camera without an event? | No: track `ended`/`mute` emits `CAMERA_INTERRUPTED` (`proctoring-integrity-monitor.test.ts` → `'camera stopped: CAMERA_INTERRUPTED and ENDED'`); the heartbeat marks the session `DEGRADED` server-side (`proctoring-session-api.test.ts` → `'camera stopped: DEGRADED; camera back: ACTIVE again'`); killing the script entirely leaves a server-side `HEARTBEAT_MISSED` via heartbeat gap, sweep, or trailing gap at submit (`proctoring-session-api.test.ts` → `'heartbeat failure: a long gap is recorded once, server-side'`, `'interrupts a stale session, records the gap, and leaves it resumable'`, `'records the trailing gap of a client that stopped heartbeating before submit'`) | as cited |
| 3 | Stop screen sharing undetected? | No: `SCREEN_SHARE_INTERRUPTED` (`proctoring-integrity-monitor.test.ts` → `'screen sharing stopped: SCREEN_SHARE_INTERRUPTED, never assumed still active'`), a persistent banner and resume needing a click (`proctoring-candidate-ui.test.tsx` → `'screen sharing stopped: the ticket message and a resume button needing a click'`), `DEGRADED` on the next heartbeat (`proctoring-session-api.test.ts` → `'microphone muted, screen stopped, or no gaze analysis are each DEGRADED'`) | as cited |
| 4 | Send fake events for another session? | No: 404 when `sessionId` is not the caller's own live session; nothing stored | `proctoring-student-routes.test.ts` → `'refuses another candidate\'s session id with 404 and stores nothing anywhere'` |
| 5 | Submit another candidate's session id? | No: the same 404, for events and heartbeat | `proctoring-student-routes.test.ts` → `'refuses another candidate\'s attempt with 404'`, `'refuses a mismatched session id with 404'` |
| 6 | Bypass the UI and call `/start`? | No: the gate is server-side and ignores the body | `proctoring-start-gate.test.ts` → `'ignores a client that simply claims proctoring is active'` |
| 7 | Cause duplicate event spam? | Bounded: clientEventId dedup, batch/session caps, per-type rate cap client-side | `proctoring-events-api.test.ts` → `'does not inflate the gaze count when a batch is replayed'`, `'stores only the new events from a partially overlapping batch'`, `'stops storing at the per-session ceiling'`; `proctoring-student-routes.test.ts` → `'rate-limits a client streaming batches'`; `proctoring-event-queue.test.ts` → `'caps each type per window, so a stuck condition cannot spam'` |
| 8 | Cause an unbounded memory queue? | No: queue ≤ 200 with INFO-first eviction (`event-queue.ts` `maxSize` default 200), behaviour tracker ≤ 50 per condition (`detection-config.ts` `maxTrackedOccurrences: 50`), baseline ≤ 200 samples (`baseline*.ts` `MAX_SAMPLES = 200`), rate-limiter map ≤ 10k keys (`rate-limit.ts` `MAX_KEYS = 10_000`) | `proctoring-event-queue.test.ts` → `'never holds more than maxSize, evicting INFO before WARN'`, `'evicts severity-aware on overflow after a failed batch, not FIFO'`; `proctoring-behaviour-tracker.test.ts` → `'keeps its memory bounded'` |
| 9 | Leave the camera running after submission? | No: `finalize` and unmount stop every track, cancel frame callbacks, clear timers, close the queue and reset the pipeline | `proctoring-use-proctoring.test.tsx` → `'stops every track on unmount'`, `'finalize stops every track, flushes, closes the session and stops heartbeating'` |
| 10 | Non-proctored exam affected? | No: hook inert (no prompt, no fetch), `/start` unchanged, no session created | `proctoring-use-proctoring.test.tsx` → `'does nothing whatsoever when proctoring is disabled'`; `proctoring-start-gate.test.ts` → `'starts exactly as before, with no proctoring session and none created'` |

Additional deltas verified in code for this ledger entry (not separate table
rows, but cited so the next reader does not have to re-derive them):
- The stale-heartbeat sweep (`sweepStaleSessions`, `src/lib/proctoring/session.ts`)
  re-checks staleness inside its `updateMany` `where` clause, not just the
  earlier `findMany` — a heartbeat landing between the two cannot be
  overridden by a sweep that saw stale data a moment ago. No dedicated race
  test exists for this; it is confirmed by reading the code (the `where`
  clause is repeated verbatim on the update) and covered indirectly by
  `'never interrupts a session with a fresh heartbeat, and records no gap'`.
- `PROCTORING_RESUMED` carries `interruptedAt` metadata, confirmed by
  `proctoring-session-api.test.ts` → `'resumes an INTERRUPTED session in
  place and records that it did'` (asserts `metadata.interruptedAt` is a
  number).
- `POST /api/student/proctoring/session` is rate-limited at 10/min per
  student (`rateLimit(`session:${student.studentId}`, 10, 60_000)` in
  `src/app/api/student/proctoring/session/route.ts`), confirmed by
  `proctoring-student-routes.test.ts` → `'rate-limits repeated start
  requests'`.
- Ten consecutive gaze inference errors set gaze health to `UNAVAILABLE` and
  send `GAZE_MONITOR_UNAVAILABLE` once per generation, confirmed by
  `proctoring-use-proctoring.test.tsx` → `'only ten consecutive inference
  errors mark gaze UNAVAILABLE, reported once'`.
- Events sent while the server session is interrupted are kept and re-sent
  after resume, confirmed by `proctoring-use-proctoring.test.tsx` →
  `'keeps events refused by a closed session and delivers them after
  resume'`.
- Start/resume flows check `isCancelled()` (unmount or finalize) after every
  `await`, confirmed by `proctoring-use-proctoring.test.tsx` → `'unmount
  while the camera prompt is pending stops every track and sends nothing
  afterwards'`, `'finalize while the session is being opened wins: COMPLETED,
  tracks stopped, no heartbeat loop'`, `'a second resume while one is
  pending returns false at once'`.

**Residual risk, accepted and not fixed:** there is no server-written
"degraded" event type distinct from the session status column, and a
modified client can report healthy devices in its own heartbeat payload —
only the session's `DEGRADED` status (server-derived from what the client
*chooses* to report) and the gap/interruption record are trustworthy. Only a
server-side media check could close that, and this phase forbids media.

**GAP found during Step 5 build verification, FIXED in fix round 1
(2026-09-26), controller ruling R14** — P25 ("not visible in production")
outranks the brief's Step-4-only fix scope, so this product change was
authorized. Original problem: the first `.next/static` grep (`Proctoring
diagnostics\|diag-iris-x`) is expected to produce no output, but the
`2026-09-26` production build matched one chunk,
`.next/static/chunks/5363-be52d63da8e1f932.js`, containing the literal
string `"Proctoring diagnostics (dev only)"` and the `diag-iris-x` test id.
Root cause: `ProctoringDiagnostics`'s `enabled` parameter defaulted to the
imported `DIAGNOSTICS_ENABLED` constant, and the minifier does not fold an
imported, already-computed boolean across a module boundary into a
downstream `if (!enabled) return null` guard the way it folds a literal
`process.env` comparison written directly in the same expression.

**Fix:** `src/components/proctoring/ProctoringExamOverlay.tsx` no longer
statically imports `ProctoringDiagnostics`. It now holds a module-level
constant

```ts
const ProctoringDiagnosticsPanel: ComponentType<ProctoringDiagnosticsProps> | null =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_PROCTORING_DIAGNOSTICS === 'true'
    ? dynamic(() => import('./ProctoringDiagnostics'))
    : null
```

written as a direct, literal `process.env` comparison (not a re-exported
boolean), gating a `next/dynamic` import. Webpack recognises that exact
shape during dependency discovery and drops the `import()` before the module
graph is built in a production compile, so `ProctoringDiagnostics.tsx` (and
its dev-only strings) is never emitted into any chunk at all — not merely
left unreached at runtime. `ProctoringDiagnostics.tsx` itself is unchanged
(still exports a `ProctoringDiagnosticsProps` type now, for the wrapper's
typing) so `tests/proctoring-diagnostics-panel.test.tsx` and
`tests/proctoring-diagnostics.test.ts`, which import and render it directly
and pass `enabled` explicitly, are untouched and still pass.

Re-verified against a clean production build (`rm -rf .next && npm run
build`):

```
$ grep -rl "Proctoring diagnostics\|diag-iris-x" .next/static
(no output)
$ grep -rl "Proctoring diagnostics\|diag-iris-x" .next
(no output)
```

Clean. No GAP remains from Task 15's Step 5.

#### Verification (fix round 1, 2026-09-26)

`npx tsc --noEmit -p tsconfig.json`: exit 0.

`npx vitest run tests/proctoring-diagnostics-panel.test.tsx
tests/proctoring-diagnostics.test.ts tests/proctoring-candidate-ui.test.tsx
tests/proctoring-use-proctoring.test.tsx`: **4 files, 43 tests, all passed.**

`npx vitest run` (full suite): **35 files, 398 tests, all passed.**

`npm run build`: exit 0.

`grep -rl "Proctoring diagnostics\|diag-iris-x" .next/static`: no output.
Clean (previously one hit — fixed).

`grep -rlE "R2_|X-Amz|MediaRecorder" .next/static`: no output. Clean.

`npm run lint`: **unavailable** — no eslint configuration in this repo.
