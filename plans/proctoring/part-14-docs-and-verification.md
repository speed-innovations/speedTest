# Part 14 — Documentation and the local verification gate

**Delivers:** the architecture and setup documentation, the manual browser test
script, and the full local gate that must pass before anything is pushed.

**Files**
- Create: `docs/proctoring.md`
- Create: `docs/proctoring-r2-setup.md`
- Create: `docs/proctoring-manual-test.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

---

## What the documentation must not claim

The PRD is explicit, and it is easy to drift into marketing language:

- Not "prevents cheating" — **"proctoring evidence"**.
- Not "AI detects cheating" — **"gaze warning"**, produced by a local model, for
  a human to interpret.
- Not "deleted after exactly 72 hours" — **access stops at 72 hours; the bytes
  are removed shortly after** by R2's lifecycle rule, on Cloudflare's schedule.
- Not "cannot be bypassed" — gaze detection runs in the candidate's browser and a
  modified client can defeat it. Say so, and say what remains trustworthy: the
  uploaded recording, the uploaded screenshots, the server's timestamps, the
  ownership checks, and the `/start` gate.

Overstating this is worse than saying nothing, because a reviewer would then
treat a gaze warning as proof.

---

## Steps

- [ ] **Step 1: Write `docs/proctoring.md`**

Sections, in this order:

```
Overview and what it does not do
Architecture (text diagram: browser -> presigned PUT -> private R2; events -> API -> Postgres)
Why there are two attempt tables and how ProctoringSession bridges them
Candidate flow
Admin review flow
Gaze detection algorithm - signals, baseline, hysteresis, sustained thresholds
  and its honest failure modes
Storage and quota rules - including the ~75 attempts per 3 days ceiling
Retention rules - the two mechanisms and why both
Browser compatibility
Environment variables
Testing
Troubleshooting
Free-tier safety
```

The architecture diagram in text:

```
Candidate browser                         Server                    Cloudflare R2
-----------------                         ------                    -------------
getUserMedia  ──> MediaRecorder ──┐
getDisplayMedia ─> canvas snapshot┤
MediaPipe (local, never uploaded) │
                                  │
                                  ├─ POST /proctoring/upload-url ──> presign ──┐
                                  │                                            │
                                  └────────── PUT (direct, presigned) ─────────┘
                                                                          private
                                     POST /proctoring/asset-complete
                                       └─ HeadObject verifies real size
                                       └─ records bytes against the budget

Admin: requireAdmin -> short-lived presigned GET -> browser plays/displays
```

The capacity section must carry the arithmetic, not just the number:

```
One 60-minute proctored attempt stores about 92 MB:
  video+audio  3600s x (160000 + 32000) bits/s / 8  = 86.4 MB
  screenshots  61 x ~100 KB                          =  6.1 MB

With PROCTORING_STORAGE_SAFETY_BYTES = 7 GB that is roughly 75 attempts - and
it is a ROLLING figure, not a concurrent one. A reservation is released when an
attempt is submitted, but the media it produced is held for the full 72-hour
retention. Yesterday's cohort still occupies the budget today, so splitting a
large batch into waves does not increase capacity.

To gain headroom without raising the budget:
  - lower PROCTORING_VIDEO_BITS_PER_SECOND (the dominant term)
  - shorten PROCTORING_RETENTION_HOURS
  - lengthen PROCTORING_SCREENSHOT_INTERVAL_MS
```

- [ ] **Step 2: Write `docs/proctoring-r2-setup.md`**

Numbered, followable by someone who has not read the code:

```
1.  Create a Cloudflare account and enable R2.
2.  Create a bucket. Keep it PRIVATE - do not enable public access or a
    public r2.dev domain.
3.  Create an API token scoped to Object Read & Write on THAT BUCKET ONLY.
    Not an account-wide token.
4.  Note the account id; the endpoint is https://<account id>.r2.cloudflarestorage.com
5.  Set R2_* in the environment. Never commit them.
6.  Configure CORS - the JSON below.
7.  Configure the lifecycle rule on the assessment-proctoring/ prefix.
8.  Verify an upload, a download, and cleanup.
```

CORS, with localhost first because that is what local testing needs:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3001", "https://speedtest-45s1.onrender.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Document why `AllowedHeaders` is only `content-type`: that is the single header
the signed PUT sends. A wildcard here would be a needless widening.

Lifecycle:

```
Prefix:            assessment-proctoring/
Delete objects:    3 days after upload
```

And the caveat, stated plainly:

```
Cloudflare applies lifecycle rules on its own schedule, so deletion may happen
somewhat after the 3-day mark. This is why the application enforces expiresAt
independently: access is refused at 72 hours regardless of whether the bytes are
physically gone. Do not describe the bytes as deleted at exactly 72 hours.
```

- [ ] **Step 3: Write `docs/proctoring-manual-test.md`**

A checklist for a real Chrome/Edge session at `http://localhost:3001` — localhost
is a secure context, so no certificate setup is needed.

```
Setup
  [ ] PROCTORING_ENABLED=true, PROCTORING_STORAGE_PROVIDER=r2, R2_* set
  [ ] a test with proctoringEnabled = true
  [ ] a test with proctoringEnabled = false (the control)

Permissions
  [ ] pre-check shows Checking, then Ready for camera, microphone, screen
  [ ] deny camera -> the camera message and a retry button; no attempt starts
  [ ] deny screen  -> the screen message; the assessment does not begin
  [ ] retry after granting -> proceeds

Capture
  [ ] camera preview shows live video
  [ ] a screenshot appears in R2 within ~60s (check the bucket)
  [ ] a webcam segment appears after the segment interval
  [ ] screenshots are under ~100 KB
  [ ] NO screen video object is ever created            <- the key negative check

Detection
  [ ] look left ~2s      -> warning appears
  [ ] look left ~0.5s    -> no warning
  [ ] look left again immediately -> no duplicate (cooldown)
  [ ] look right ~2s     -> warning
  [ ] cover the camera ~4s -> face-not-detected warning
  [ ] a second person in frame ~4s -> multiple-faces warning
  [ ] typing stays responsive throughout       <- the performance check

Interruption
  [ ] stop screen sharing -> prompt, event logged, same attempt id
  [ ] resume screen sharing -> assessment continues
  [ ] disable the network ~30s -> upload warning, no false "saved"
  [ ] re-enable -> queue drains, status recovers
  [ ] refresh mid-test -> RECOVERY SCREEN, not the exam; still one attempt

Submission
  [ ] submit -> final segment uploads
  [ ] camera light goes OUT                    <- check the hardware indicator
  [ ] the microphone indicator clears
  [ ] the screen-share bar disappears

Admin
  [ ] the panel shows segments, screenshots, and the timeline
  [ ] segments play in order and advance automatically
  [ ] screenshots enlarge on click
  [ ] events read neutrally, with no risk score
  [ ] the score matches the answers, unaffected by proctoring

Control
  [ ] the NON-proctored test: no pre-check, no camera prompt, no proctoring
      requests in the Network tab, behaviour identical to before

Retention
  [ ] set an asset's expiresAt into the past
  [ ] the admin download is refused and the asset flips to EXPIRED
  [ ] run the cleanup endpoint -> the object is gone from R2
  [ ] run it again -> a clean no-op

Known limitations to confirm are documented
  [ ] Safari and Firefox are not supported for screen capture here
  [ ] mobile browsers are not supported
  [ ] a modified client can defeat gaze detection
```

- [ ] **Step 4: Update `README.md`** — a short Proctoring section pointing at the
      three docs, plus the new environment variables in the existing table.

- [ ] **Step 5: Update `CLAUDE.md`** — proctoring is now part of this repo's
      context. Add, in the file's existing voice:

```
- ProctoringSession bridges the two attempt tables with a CHECK constraint;
  resolveOwnedAttempt is the only code that should branch on attempt kind.
- The storage budget allows ~75 proctored attempts per rolling 3-day window.
  This is not a concurrency limit - media is held for the full retention period.
- Proctoring media needs R2 credentials; tests use
  PROCTORING_STORAGE_PROVIDER=mock and must never need real ones.
- The retention cleanup workflow must reach main to become active.
```

- [ ] **Step 6: Run the full local gate**

Everything below must pass, and the output must be read, not assumed.

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npx tsc --noEmit -p scripts/tsconfig.json
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run test:e2e
```

Do **not** run `npm run lint` — eslint is not installed and has no config, so it
fails for reasons unrelated to this work. Note that in the report rather than
quietly skipping it.

- [ ] **Step 7: Run the security sweep**

```bash
grep -rl "R2_SECRET_ACCESS_KEY\|R2_ACCESS_KEY_ID" .next/static 2>/dev/null && echo "FAIL: credential in client bundle" || echo "OK: no R2 credentials in client bundle"
```

```bash
grep -rn "r2.dev\|pub-.*\.r2\.dev" src/ docs/ 2>/dev/null && echo "FAIL: public R2 URL referenced" || echo "OK: no public R2 URL"
```

```bash
grep -rn "MediaRecorder" src/lib/proctoring/client/screen-capture.ts && echo "FAIL: screen video recorder" || echo "OK: screen is never recorded"
```

```bash
grep -rn "fetch\|sendBeacon\|XMLHttpRequest" src/lib/proctoring/client/gaze-*.ts && echo "FAIL: gaze module makes network calls" || echo "OK: gaze is local only"
```

```bash
git diff main --stat -- .env .env.local 2>/dev/null | grep . && echo "FAIL: env file modified" || echo "OK: no env file committed"
```

- [ ] **Step 8: Complete the manual browser test** from Step 3. Tick every box.
      An untested box is an untested feature — do not mark this part done with
      boxes outstanding.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "proctoring part 14: documentation and local verification"
```

Do not push.

- [ ] **Step 10: Update `PROGRESS.md`** — mark Part 14 done, and record the
      actual results of Steps 6–8, including anything that failed or was skipped.

- [ ] **Step 11: Report and stop**

Parts 1–14 are complete. **Do not proceed to Part 15.** Report to the owner:

```
- what was built, in a few lines
- the verification results, stated plainly, including anything that failed
- any manual-test box that could not be ticked, and why
- that release requires their explicit go-ahead
```

---

## Done when

- All three documents exist and make no overstated claim.
- The full local gate passes, with output read rather than assumed.
- The security sweep is clean.
- The manual browser test is complete, every box ticked.
- Nothing has been pushed.
