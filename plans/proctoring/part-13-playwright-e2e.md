# Part 13 — Playwright end-to-end tests

**Delivers:** the PRD's 15-step browser flow, with mocked media APIs, plus the CI
workflow step (written, not pushed).

**Files**
- Create: `playwright.config.ts`
- Create: `e2e/fixtures/media-mocks.ts`
- Create: `e2e/fixtures/seed.ts`
- Create: `e2e/proctoring-candidate.spec.ts`
- Create: `e2e/proctoring-admin.spec.ts`
- Create: `e2e/non-proctored-regression.spec.ts`
- Modify: `.github/workflows/deploy.yml` (**not pushed** until Part 15)
- Modify: `package.json` (`test:e2e` script)
- Modify: `.gitignore` (`playwright-report/`, `test-results/`)

---

## Real permissions cannot be granted in CI

Chromium headless has no camera, no microphone, and no screen to share.
`getDisplayMedia` in particular cannot be satisfied by a browser flag — the
picker is a user gesture on real hardware.

So the media layer is replaced at the `navigator.mediaDevices` boundary via
`page.addInitScript`, before any app code runs. What that does and does not prove:

**Proves:** the state machine, the pre-check UI, permission-denied handling,
segment and screenshot generation, the upload queue, the API contracts end to
end, the admin review flow, and that a non-proctored assessment is unaffected.

**Does not prove:** that a real camera produces a usable stream, that MediaPipe
classifies a real face correctly, that R2 accepts the presigned PUT, or that the
screen picker works. Those are Part 14's manual test. Do not describe this suite
as proving proctoring works end to end — it proves the application logic does.

---

## Steps

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
```

```bash
npx playwright install --with-deps chromium
```

Chromium only. Firefox and WebKit have materially different `getDisplayMedia`
support, and the PRD scopes this feature to desktop Chrome/Edge-class browsers.

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // These share one database and one dev server; parallel workers would race on
  // fixtures. Correctness over speed for a suite this small.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    // localhost is a secure context, so the media APIs the app feature-detects
    // are present and our init script can replace them cleanly.
    permissions: ['camera', 'microphone'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

Note `npm run start`, not `npm run dev`: E2E runs against a production build, the
same artefact CI builds.

- [ ] **Step 3: Write `e2e/fixtures/media-mocks.ts`**

An init script installed before app code runs. It must provide:

```
- navigator.mediaDevices.getUserMedia  -> a canvas-captureStream MediaStream with
  one video and one audio track (from an AudioContext oscillator), so real track
  objects exist and `stop()` is observable
- navigator.mediaDevices.getDisplayMedia -> a canvas-captureStream video track,
  with a hook to fire `onended` on demand, for the interruption test
- MediaRecorder -> a working stub that emits `dataavailable` with a small Blob on
  a timer and on stop, and reports a supported mimeType
- MediaRecorder.isTypeSupported -> true for video/webm;codecs=vp8,opus
- a deny mode: getUserMedia / getDisplayMedia reject with NotAllowedError, to
  test the refusal path
- a hook to force the gaze classifier's output, so a warning can be triggered
  deterministically without a real face
```

The gaze hook matters: the assertion is that a sustained deviation produces a
warning and an event, and that must not depend on what a headless browser renders
into a canvas.

- [ ] **Step 4: Write `e2e/fixtures/seed.ts`**

Creates, per run, with a unique tag: a college, an admin user, a student user
with a profile, a proctored test, a non-proctored test, and a schedule. Tears all
of it down afterwards in FK-safe order. Reuse the fixture conventions from
`tests/attempt-ownership.test.ts` — `TAG = \`e2e-${Date.now()}\``.

- [ ] **Step 5: Write `e2e/proctoring-candidate.spec.ts`** — the PRD's flow

```
1.  sign in as the seeded student
2.  open the proctored assessment
3.  the pre-check appears, and the exam does not
4.  camera reports Ready
5.  microphone reports Ready
6.  screen sharing reports Ready
7.  Start Proctored Assessment -> questions render, timer runs
8.  force a sustained gaze deviation -> the warning banner appears
9.  a screenshot asset is created (assert via the API, as the admin)
10. a webcam segment asset is created
11. both reach UPLOADED
12. submit the assessment
13. the proctoring session is COMPLETED
14. the camera and microphone tracks are stopped
15. the score is unchanged by any proctoring event
```

Step 15 is worth an explicit assertion — it is the PRD's firmest guarantee:

```ts
test('proctoring events never change the score', async ({ page, request }) => {
  // ... answer 3 of 5 correctly, trigger several gaze warnings, submit ...
  const detail = await adminGet(request, `/api/admin/results/detail?attemptId=${attemptId}&type=scheduled`)
  expect(detail.totalScore).toBe(expectedScoreFromAnswersAlone)

  const evidence = await adminGet(request, `/api/admin/proctoring/${attemptId}?type=scheduled`)
  expect(evidence.events.length).toBeGreaterThan(0)   // events were recorded
  expect(detail.totalScore).toBe(expectedScoreFromAnswersAlone)  // and changed nothing
})
```

Also cover the refusal and interruption paths:

```
- camera denied -> the camera message, a retry button, and no attempt is started
- screen denied -> the screen message, and the assessment does not begin
- screen share ended mid-test -> the resume prompt, a SCREEN_SHARE_STOPPED event,
  and the same attempt id afterwards (never a second attempt)
- reload mid-test -> the recovery screen, not the exam, and still one attempt
```

The reload case is the one most likely to regress, because the non-proctored path
looks identical and works.

- [ ] **Step 6: Write `e2e/proctoring-admin.spec.ts`**

```
- an admin opens the attempt and sees the proctoring panel
- the event timeline lists the gaze warning with a neutral description
- the screenshot gallery renders at least one image
- the recording player reports the segment count
- a student cannot reach the admin proctoring endpoint
- no signed URL or object key appears anywhere in the page HTML
```

- [ ] **Step 7: Write `e2e/non-proctored-regression.spec.ts`**

The most valuable file in this part. Run a full attempt on the **non-proctored**
test and assert the feature is invisible:

```ts
test('a non-proctored assessment is completely unaffected', async ({ page }) => {
  const mediaCalls: string[] = []
  await page.exposeFunction('__recordMediaCall', (n: string) => { mediaCalls.push(n) })
  await installMediaSpies(page)

  const proctoringRequests: string[] = []
  page.on('request', r => { if (r.url().includes('/proctoring/')) proctoringRequests.push(r.url()) })

  // ... sign in, start, answer, submit ...

  expect(mediaCalls).toEqual([])          // no camera or screen prompt, ever
  expect(proctoringRequests).toEqual([])  // no proctoring endpoint touched
  await expect(page.getByText(/camera/i)).toHaveCount(0)
})
```

- [ ] **Step 8: Add the script and ignores**

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

Append to `.gitignore`:

```
# playwright
/playwright-report
/test-results
/e2e/.auth
```

- [ ] **Step 9: Add the CI step** — `.github/workflows/deploy.yml`, **not pushed**

In the `check` job, after `Build`:

```yaml
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: End-to-end tests
        run: npm run test:e2e
        env:
          PROCTORING_ENABLED: 'true'
          PROCTORING_STORAGE_PROVIDER: 'mock'
          NEXTAUTH_SECRET: e2e-secret-not-used-in-production
          NEXTAUTH_URL: http://localhost:3001

      - name: Upload the Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

`PROCTORING_STORAGE_PROVIDER: mock` is deliberate — CI has no R2 credentials and
must never need them.

This adds roughly 2–4 minutes to every run: the browser download (cached after
the first) plus the suite. That cost was accepted when Playwright was chosen.

- [ ] **Step 10: Run locally**

```bash
npm run build
```

```bash
npm run test:e2e
```

- [ ] **Step 11: Typecheck and full unit suite**

```bash
npx tsc --noEmit -p tsconfig.json && npm test
```

Playwright specs live in `e2e/`, outside Vitest's `tests/**` include, so the two
runners do not collide.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "proctoring part 13: Playwright end-to-end coverage with mocked media"
```

Do not push. The CI change is inert until Part 15.

- [ ] **Step 13: Update `PROGRESS.md`** — record the suite's runtime, so Part 15
      knows what it is adding to every CI run.

---

## Done when

- The 15-step flow passes against a production build.
- Permission denial, screen interruption, and mid-test reload are covered.
- The non-proctored regression spec proves zero media calls and zero proctoring
  requests.
- The CI step is written but not yet active.

**State the limits honestly** when reporting this part: mocked media does not
prove a real camera, MediaPipe on a real face, or that R2 accepts the upload.
