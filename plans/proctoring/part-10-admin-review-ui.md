# Part 10 — Admin review UI

**Delivers:** the evidence review experience — segment player, screenshot
gallery, event timeline — plus the R2 usage page that tells an operator how much
capacity is left.

**Files**
- Create: `src/app/api/admin/proctoring/[attemptId]/route.ts`
- Create: `src/app/api/admin/proctoring/usage/route.ts`
- Create: `src/components/proctoring/admin/ProctoringPanel.tsx`
- Create: `src/components/proctoring/admin/RecordingPlayer.tsx`
- Create: `src/components/proctoring/admin/ScreenshotGallery.tsx`
- Create: `src/components/proctoring/admin/EventTimeline.tsx`
- Create: `src/app/admin/proctoring/page.tsx` (usage page)
- Modify: `src/app/admin/results/page.tsx` (mount the panel)
- Modify: `src/components/admin/AdminSidebar.tsx` (nav entry)
- Create: `tests/proctoring-admin-api.test.ts`

**Interfaces — Consumes:** Part 5 `issueDownloadUrl`, Part 3 `currentUsageBytes`,
Part 4 `requireAdmin`.

---

## Reuse the existing addressing, do not invent a second one

`src/app/api/admin/results/detail/route.ts:12-13` already keys on
`?attemptId=...&type=scheduled|walkin`. The proctoring endpoint uses the same
shape. That route stays **untouched** — proctoring evidence loads separately so
the gallery can lazy-load rather than bloating a response that already carries
every question and answer.

It already returns `startedAt`, which is the anchor for `elapsedMs` correlation.

---

## Neutral language is a requirement, not a preference

The timeline describes what was observed, never what it means. "Looking left for
2.1s" — not "cheating detected", not a risk score, not a ranking. A reviewer
draws the conclusion; the system supplies the observation. PRD §82 forbids the
alternative framing outright, and a score or a red "SUSPICIOUS" badge would make
this evidence actively misleading.

---

## Steps

- [x] **Step 1: Write the evidence endpoint** — `src/app/api/admin/proctoring/[attemptId]/route.ts`

`requireAdmin()` → read `type` from the query → find the session by
`testAttemptId` or `walkInAttemptId` → return session metadata, assets (id, type,
sequence, capturedAt, elapsedMs, byteSize, status, questionId) and events
ordered by `occurredAt`.

Rules:
- **Never return `objectKey`.** It is internal, and exposing it invites a client
  to construct requests around it.
- **Never return a signed URL from this endpoint.** URLs are fetched one at a
  time from the Part 5 download-url route, when the admin actually opens that
  asset. Bulk-signing everything would hand out dozens of live bearer tokens on
  page load.
- Return `null` session cleanly when the attempt was never proctored — the panel
  renders "not proctored", which is not an error.

- [x] **Step 2: Write the usage endpoint** — `src/app/api/admin/proctoring/usage/route.ts`

```ts
/**
 * Operational capacity, from our own ledger.
 *
 * Deliberately does not call R2. A LIST per page load would burn the Class A
 * operation budget for no benefit - the database already knows what was
 * uploaded and what expired.
 */
```

Return: `reservedBytes`, `storedBytes`, `totalBytes`, `safetyBytes`,
`remainingBytes`, `activeSessions`, `assetsAwaitingCleanup`, `expiredAssets`,
`uploadFailures`, `avgSegmentBytes`, `avgScreenshotBytes`, and —

```ts
  // The number an operator actually plans a drive around. With the default
  // budget this is roughly 75, and it is a rolling figure: media is held for
  // the full retention period, so completed attempts keep consuming it for 72
  // hours rather than freeing up at submission.
  estimatedAttemptsRemaining: Math.floor(remainingBytes / estimateAttemptBytes(60)),
```

- [x] **Step 3: Write `RecordingPlayer.tsx`**

A playlist over segments, not a merged file — there is no transcoding here and
none is wanted.

```
- one <video> element; on `ended`, advance to the next segment
- fetch that segment's signed URL only when it is about to play
- Previous / Play / Pause / Next, plus "Segment 3 of 12"
- a missing or expired segment renders "Recording segment unavailable" inline
  and playback skips to the next one rather than stalling
```

- [x] **Step 4: Write `ScreenshotGallery.tsx`**

```
- chronological, showing timestamp, elapsed time, and question number when known
- lazy: `loading="lazy"` plus IntersectionObserver, signing each URL on demand.
  Signing 60 URLs on mount would be 60 live bearer tokens and a slow page.
- click to enlarge
- an expired asset shows "Screenshot expired — removed under the retention policy",
  which is a normal outcome after 72 hours, not a failure
```

- [x] **Step 5: Write `EventTimeline.tsx`**

Ordered by `elapsedMs` so events line up with segments and screenshots.
Neutral phrasing:

```
00:04:15   Looking left            2.1s
00:18:32   Screen sharing stopped
00:21:10   Face not detected       3.2s
00:32:00   Second face detected    4.0s
```

No severity ranking, no totals framed as a score. A count of gaze warnings is
fine; "risk: HIGH" is not.

- [x] **Step 6: Write `ProctoringPanel.tsx` and mount it**

In `src/app/admin/results/page.tsx`, the detail modal currently renders a
one-line violations strip around lines 228–235. Mount the panel directly beneath
it, as a collapsible section — collapsed by default so the existing score review
flow is unchanged for anyone not looking at proctoring.

Keep the existing violations strip. Tab-switch violations and proctoring events
are different signals from different mechanisms; merging them would misrepresent
both.

- [x] **Step 7: Write the usage page and nav entry**

`src/app/admin/proctoring/page.tsx`, plus an entry in `AdminSidebar.tsx`'s
`navItems`. Lead with remaining capacity and `estimatedAttemptsRemaining` — that
is the number that decides whether tomorrow's drive can run.

Show `assetsAwaitingCleanup` prominently. If the scheduled job stalls, this is
the only place it becomes visible before the budget is quietly eaten.

- [x] **Step 8: Write `tests/proctoring-admin-api.test.ts`**

```
- an admin gets the evidence for an attempt of either kind
- a student calling the admin endpoint is refused
- an unauthenticated caller gets 401; an authenticated non-admin gets 403
- the response never contains objectKey        <- assert on the serialized body
- the response never contains a signed URL     <- assert on the serialized body
- an expired asset is refused a download URL, and is flipped to EXPIRED
- usage arithmetic: remaining = safety - (reserved + stored), never negative
- a never-proctored attempt returns a null session rather than 404
```

Write the leak checks against the actual JSON, so a future `include` cannot
reintroduce the field unnoticed:

```ts
it('never leaks the object key or a signed URL', async () => {
  const body = JSON.stringify(await getAdminEvidence(attemptId, 'scheduled'))
  expect(body).not.toContain('objectKey')
  expect(body).not.toContain('assessment-proctoring/')
  expect(body).not.toContain('X-Amz-Signature')
})
```

- [x] **Step 9: Run the tests, typecheck, full suite, build**

```bash
npx vitest run tests/proctoring-admin-api.test.ts
```

```bash
npx tsc --noEmit -p tsconfig.json && npm test && npm run build
```

- [x] **Step 10: Commit**

```bash
git add -A && git commit -m "proctoring part 10: admin evidence review and R2 usage page"
```

Do not push.

- [x] **Step 11: Update `PROGRESS.md`.**

---

## Found while building this part

- **The logic lives in `src/lib/proctoring/admin.ts`**, which the file list did
  not mention. The part file's own test snippet calls
  `getAdminEvidence(attemptId, 'scheduled')`, and the leak checks have to run
  against the real serialized shape, so the read models sit in a lib the tests
  import directly. The routes are thin Convention B wrappers.

- **The download-url route already existed** from Part 5 at
  `src/app/api/admin/proctoring/assets/[id]/download-url/route.ts`. Nothing new
  was needed; both the player and the gallery call it.

- **Prisma orders enum columns by DECLARATION order, not alphabetically.**
  `orderBy: { type: 'asc' }` yields `WEBCAM_SEGMENT` then `SCREENSHOT`, because
  that is their order in `schema.prisma`. Pinned by a test - inserting a new
  asset type above `WEBCAM_SEGMENT` would silently reorder the response.

- **`PROCTORING_STORAGE_SAFETY_BYTES` has a 100 MB config floor**, so the
  over-budget case cannot be produced by lowering the budget beneath the
  fixtures. That test creates a session holding a 2 GB reservation instead, and
  removes it in a `finally`.

- **Top-level `await` is illegal at this project's `es5` target** (TS1378). The
  test uses static imports; `vi.mock` is hoisted above them by vitest, so the
  dynamic-import dance some mocking guides suggest is both unnecessary and
  uncompilable here. Worth remembering for Parts 11-13.

- **Usage arithmetic is asserted as an invariant, not against fixed numbers.**
  Other suites write sessions and assets into the same tables and vitest may run
  them concurrently, so absolute totals are not one file's to control - the same
  hazard Part 4 recorded.

- **`npm run build` cannot run while the dev server is up.** `prisma generate`
  fails `EPERM` on the query engine DLL (documented in CLAUDE.md), and even
  `next build` alone can fail in "Collecting page data" with a spurious
  `MODULE_NOT_FOUND` for a webpack chunk, because the dev server rewrites the
  shared `.next` directory mid-build. Retrying succeeded. Do not read that
  failure as a code defect.

## Done when

- Segments play in sequence, with missing ones skipped rather than stalling.
- Screenshots sign on demand, not in bulk on mount.
- The timeline uses neutral descriptions with no risk scoring anywhere.
- The evidence response contains no object key and no signed URL.
- The usage page shows remaining capacity and assets awaiting cleanup.
