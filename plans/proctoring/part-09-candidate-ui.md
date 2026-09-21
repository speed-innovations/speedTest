# Part 9 — Candidate UI

**Delivers:** the `useProctoring` hook that drives every client service, the
pre-check, status indicator, warnings, and the refresh-recovery screen — wired
into **both** test pages.

**Files**
- Create: `src/lib/proctoring/client/use-proctoring.ts`
- Create: `src/components/proctoring/ProctoringSetup.tsx`
- Create: `src/components/proctoring/ProctoringStatusIndicator.tsx`
- Create: `src/components/proctoring/ProctoringWarning.tsx`
- Create: `src/components/proctoring/ProctoringRecovery.tsx`
- Create: `src/components/proctoring/CameraPreview.tsx`
- Modify: `src/app/student/test/[scheduleId]/page.tsx`
- Modify: `src/app/student/walkin-test/[testId]/page.tsx`
- Create: `tests/proctoring-setup.test.tsx` (jsdom)
- Create: `tests/proctoring-use-proctoring.test.tsx` (jsdom)

**Interfaces — Consumes:** Parts 7 and 8, all client services.

---

## The three rules this part exists to honour

**1. Refresh cannot auto-resume.** `page.tsx:52-65` sets `testStarted = true`
directly on reload — no user gesture, and `getDisplayMedia()` requires one. So a
proctored attempt that is `started` but has no live media **must** render
`ProctoringRecovery` with an explicit button, not the exam. This is the single
most likely thing to get wrong, because the non-proctored path looks fine.

**2. One hook, two call sites.** The two pages are 523 and 525 lines of
near-identical code. All logic lives in `useProctoring`; each page gets a small
integration block. Do not copy logic into the second page.

**3. Teardown is not optional.** Camera and microphone must stop on submit *and*
on unmount *and* on navigation. A candidate whose camera light stays on after
submitting will not trust anything else the product says.

---

## Steps

- [x] **Step 1: Write `use-proctoring.ts`**

```ts
export interface UseProctoringOptions {
  enabled: boolean
  attemptId: string | null
  kind: AttemptKind
  parentId: string
  /** Current question id, for correlation. Validated server-side. */
  currentQuestionId: string | null
  /** True once the server says this attempt is already started. */
  alreadyStarted: boolean
}

export interface UseProctoringResult {
  state: ProctoringClientState
  support: SupportReport
  devices: { camera: DeviceStatus; microphone: DeviceStatus; screen: DeviceStatus }
  warning: { message: string; kind: string } | null
  uploads: { pending: number; failed: number; uploaded: number }
  /** True when the exam must not be shown: recovery is required. */
  needsRecovery: boolean
  requestPermissionsAndStart: () => Promise<boolean>
  resumeScreenShare: () => Promise<boolean>
  finalize: () => Promise<void>
  videoRef: React.RefObject<HTMLVideoElement>
}
```

**Deviations from the interface as written above, all additive:**

- `startError: { message, code? } | null` added. `ProctoringSetup` cannot
  otherwise tell a 503 storage refusal from any other start failure, and
  `ProctoringRecovery` needs the `PROCTORING_SESSION_CLOSED` code to stop
  offering a button that can only fail again.
- `capture: CaptureState` added (`recording`, `screenSharing`, `cameraLive`,
  `micLive`). The heartbeat already tracks this internally and the status
  indicator must not infer "recording" from the state name.
- `DeviceStatus` was referenced but never defined; it is
  `{ state: 'IDLE' | 'CHECKING' | 'READY' | 'DENIED' | 'FAILED' | 'NOT_REQUIRED'; message?: string }`.
- **`needsRecovery` is NOT `state !== 'ACTIVE'`.** That formula is right on
  load and wrong a moment later: a candidate who stops screen sharing mid-exam
  leaves ACTIVE, and the exam would be replaced by the recovery screen with
  their questions gone. It is `enabled && alreadyStarted && !captureLive`,
  where `captureLive` records whether this page instance ever brought capture
  up. A mid-exam screen stop shows a resume banner instead.

Rules for the implementation:

- Long-lived handles (`MediaStream`, `MediaRecorder`, `GazeMonitor`,
  `UploadQueue`) live in `useRef`, **never** `useState`. Only small scalars go in
  state, so a segment upload does not re-render the exam.
- `needsRecovery` is `enabled && alreadyStarted && state !== 'ACTIVE'` — the flag
  that tells the page to render recovery instead of questions.
- The cleanup effect stops every track, cancels every timer, closes the gaze
  monitor, and revokes object URLs. Write it first, not last.

```ts
  useEffect(() => {
    // Teardown runs on unmount and on navigation away, not only on submit. A
    // camera that stays live after the candidate leaves is both a privacy
    // failure and the thing that most visibly erodes trust in the product.
    return () => { teardownRef.current?.() }
  }, [])
```

- [x] **Step 2: Write `ProctoringSetup.tsx`**

Three rows — Camera, Microphone, Screen sharing — each showing
`Checking… / Ready / Failed / Permission denied`. Status must not be colour-only:
pair every state with an icon and text, so it reads without colour vision.

The consent copy, verbatim and neutral in tone:

> This assessment uses your camera, microphone, and periodic screen snapshots to
> help verify assessment integrity. Camera-based gaze analysis runs locally in
> your browser and those frames are never uploaded. Recorded media is stored
> temporarily and is automatically deleted after about three days.

Requirements:
- Uses existing styles — `card`, `btn-primary`, `btn-secondary`, `brand-purple`.
  No new visual language.
- A single "Start Proctored Assessment" button. `getDisplayMedia` must be called
  from that click, not from an effect.
- On denial: name exactly what is missing, with the PRD's wording, plus a retry
  button. Never silently continue.
- On `checkBrowserSupport().supported === false`: explain and refuse. Do not
  start a partially proctored assessment.
- On a 503 from session start: render the storage message calmly —
  "Proctored assessment is temporarily unavailable. Please try again later." —
  and no internal reason. This path will be hit in normal operation at the
  configured budget, so it must not look like a crash.

- [x] **Step 3: Write `ProctoringStatusIndicator.tsx`**

Small, non-intrusive, in the exam top bar next to the existing violation chip:
`● Recording`, `● Screen sharing`, `● Evidence saved`. Distinguish **Recorded /
Uploaded / Pending upload / Upload failed** honestly — never show "saved" for
something still queued.

- [x] **Step 4: Write `ProctoringWarning.tsx`**

Transient banner with `role="status"` and `aria-live="polite"`, so a screen
reader announces it without stealing focus mid-question. The PRD's messages:

```
Looking away    ⚠️ Please look at the assessment screen.
Face missing    ⚠️ Please position your face clearly in front of the camera.
Multiple faces  ⚠️ More than one face was detected. Please ensure you are the only person visible.
Upload trouble  We're having trouble saving assessment evidence. Please check your internet connection.
```

Never blocks interaction. A warning is evidence for review, not a punishment, and
a candidate must always be able to keep answering.

- [x] **Step 5: Write `ProctoringRecovery.tsx`**

Shown when `needsRecovery` is true. Explains that the assessment is still in
progress, that permissions must be granted again after a refresh, and offers one
button to resume. It must **not** create a second attempt or a second session —
it calls the same session endpoint, which is idempotent by design.

- [x] **Step 6: Wire into `src/app/student/test/[scheduleId]/page.tsx`**

Read `data.proctoringEnabled` in the load effect. Then, in order:

1. **Gate the resume path.** Where the component currently does
   `setTestStarted(true)` for `data.started`, a proctored attempt must not.
   Render recovery instead:

```tsx
        } else if (data.started) {
          setTimeLeft(data.remainingSeconds ?? 0)
          // ... existing answer filtering, unchanged ...
          // A proctored attempt cannot resume silently: getDisplayMedia needs a
          // user gesture, and there is none on a reload. Recovery asks for one.
          if (!data.proctoringEnabled) setTestStarted(true)
        }
```

2. **Gate the start screen.** When proctoring is enabled, render
   `<ProctoringSetup>` in place of the plain "🚀 Start Test" button. `startTest()`
   only runs after `requestPermissionsAndStart()` resolves true — the `/start`
   route will reject it otherwise with `PROCTORING_REQUIRED`.

3. **Render recovery** ahead of the active-test UI when `needsRecovery`.

4. **Add the indicator and warning** into the existing top bar and layout.

5. **Finalize before submit.** In `handleSubmit` and `handleAutoSubmit`, await
   `finalize()` before `submitWithRetry()`, so the final segment is handed to the
   upload queue first. Wrap it so a proctoring failure can never block a submit:

```tsx
      // Evidence must not cost a candidate their answers. If finalization fails
      // the submit proceeds; the stale sweep will close the session.
      try { await finalize() } catch { /* logged inside finalize */ }
```

- [x] **Step 7: Mirror every one of those five changes into
      `src/app/student/walkin-test/[testId]/page.tsx`**

Differences only: `kind="walkin"`, `parentId={testId}`, and the API base path.
This page is a near-copy, so it is the one that gets forgotten.

```bash
grep -c "useProctoring\|ProctoringSetup\|ProctoringRecovery\|needsRecovery" \
  src/app/student/test/\[scheduleId\]/page.tsx \
  src/app/student/walkin-test/\[testId\]/page.tsx
```

The two counts must match.

- [x] **Step 8: Write the jsdom tests**

`tests/proctoring-setup.test.tsx` — mock `navigator.mediaDevices.getUserMedia`,
`getDisplayMedia`, `MediaRecorder`, `MediaStream`, `MediaStreamTrack`, and
`canvas.toBlob`. Cover:

```
- all three permissions granted -> Ready, start button enabled
- camera denied -> the camera message, a retry button, and no session created
- screen denied -> the screen message, and the assessment does not begin
- an unsupported browser -> the compatibility message, start not offered
- a 503 from session start -> the calm storage message, no internal reason shown
```

`tests/proctoring-use-proctoring.test.tsx` — cover:

```
- enabled:false does nothing at all: no getUserMedia, no fetch, no timers
- a proctored attempt that is already started reports needsRecovery
- teardown stops every track on unmount
- a screen track ending moves state to SCREEN_SHARE_STOPPED and emits an event
```

The first case is the regression guard for "existing non-proctored assessments
continue working exactly as before":

```tsx
it('does nothing whatsoever when proctoring is disabled', () => {
  const getUserMedia = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  const fetchSpy = vi.spyOn(globalThis, 'fetch')

  renderHook(() => useProctoring({ enabled: false, attemptId: 'a1', kind: 'scheduled',
    parentId: 'p1', currentQuestionId: null, alreadyStarted: false }))

  expect(getUserMedia).not.toHaveBeenCalled()
  expect(fetchSpy).not.toHaveBeenCalled()
})
```

- [x] **Step 9: Run the tests**

```bash
npx vitest run tests/proctoring-setup.test.tsx tests/proctoring-use-proctoring.test.tsx
```

- [x] **Step 10: Typecheck, full suite, and build**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

```bash
npm run build
```

The build matters here: this is the first part putting proctoring code into a
client bundle.

- [x] **Step 11: Confirm no credential reached the bundle**

```bash
grep -rl "R2_SECRET_ACCESS_KEY\|R2_ACCESS_KEY_ID" .next/static 2>/dev/null && echo "FAIL: credential in client bundle" || echo "OK: no R2 credentials in client bundle"
```

- [ ] **Step 12: Manual smoke test** — **NOT DONE. Deferred to Part 14.**

  Blocked, not skipped. The flow needs a signed-in student, and the local
  fixture (`Manual Verification Test`, `proctoringEnabled = false`, students
  `student.a@` / `student.b@mitcoe.edu.in`) has no known password, while its
  schedule window closed on 2026-09-17. Setting a dev password and moving the
  window are both local-Postgres writes, and the write was refused by the
  session's permission policy. Part 14 is the local-verification part and is
  where this belongs; it must also cover the two things no test in this part
  can reach: a real camera proving the gaze sign convention, and a real R2
  presigned PUT.

Start the dev server in a VS Code terminal (not background, not detached):

```bash
npm run dev
```

At `http://localhost:3001`, on a test with `proctoringEnabled = false`, run one
attempt start-to-submit. It must behave **exactly** as before: no pre-check, no
camera prompt, no new network requests. Confirm in the Network tab.

- [ ] **Step 13: Commit**

```bash
git add -A && git commit -m "proctoring part 9: candidate pre-check, warnings, recovery, and teardown"
```

Do not push.

- [ ] **Step 14: Update `PROGRESS.md`.**

---

## Found while building this part

- **`PROCTORING_SCREEN_REQUIRED=false` is not honoured by the pre-check.** The
  flag arrives with the session config, and the session must not be created
  until permissions are granted - otherwise a candidate who then denies them
  leaves a live ACTIVE session that `/start` would accept, defeating the gate.
  So the pre-check always requires screen sharing, which is the config default.
  Honouring the flag needs it exposed on the session GET, an API change Part 6
  closed. Left as-is and flagged.

- **Screen sharing is requested BEFORE the camera.** `getDisplayMedia` needs
  transient user activation and that expires a few seconds after the click; a
  first-time camera prompt easily outlasts it. Asking for the screen while the
  gesture is fresh is what stops "allow camera" from making screen sharing
  impossible. It also means a screen denial never prompts for the camera at
  all, which the test asserts.

- **Gaze inference reads from the hook's own off-DOM video element**, not from
  the `CameraPreview` the page renders. The preview unmounts when the page
  switches from the pre-check to the questions, and binding inference to it
  would stop detection at that exact moment.

- **MediaPipe must be mocked in jsdom.** `GazeMonitor.create` never settles
  under jsdom - it loads the 3.6 MB model and multi-megabyte WASM - so it hangs
  a suite rather than failing it. Both new test files `vi.mock` the
  `gaze-monitor` module. Any future jsdom test that starts proctoring needs the
  same mock.

- **A swept session is a dead end for the candidate.** The unique index on the
  attempt FK is per attempt, not per attempt-and-status, so once the stale
  sweep marks a session INTERRUPTED (default 180 s without a heartbeat) it
  cannot be reopened, while the exam clock keeps running. `ProctoringRecovery`
  detects `PROCTORING_SESSION_CLOSED` and says so plainly rather than offering
  a button that will fail again. This is a real product gap inherited from
  Part 4's locked schema, not something this part introduced.

## Done when

- A proctored attempt that is refreshed shows recovery, never the exam.
- Both pages are wired, with matching grep counts.
- A non-proctored attempt issues no camera prompt and no extra requests —
  verified in the browser, not only in tests.
- Camera and mic tracks stop on submit and on unmount.
- `npm run build` succeeds and no R2 credential appears in `.next/static`.
