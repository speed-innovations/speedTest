# Part 8 — Gaze detection

**Delivers:** the MediaPipe Face Landmarker integration, split into a pure
classifier, a pure state machine, and a thin shell. The PRD's threshold and
cooldown cases are locked as tests here.

**Files**
- Create: `public/mediapipe/` (WASM bundle + `face_landmarker.task`)
- Create: `src/lib/proctoring/client/gaze-classify.ts` (pure)
- Create: `src/lib/proctoring/client/gaze-state.ts` (pure)
- Create: `src/lib/proctoring/client/gaze-monitor.ts` (shell)
- Create: `tests/proctoring-gaze-classify.test.ts`
- Create: `tests/proctoring-gaze-state.test.ts`
- Modify: `.gitignore` (ensure `public/mediapipe/` is NOT ignored)

**Interfaces — Produces**

```ts
// gaze-classify.ts — pure
export interface GazeSignals { yaw: number; pitch: number; irisOffsetX: number | null; faceCount: number }
export interface GazeBaseline { yaw: number; pitch: number }
export interface GazeThresholds { yawDeg: number; pitchDeg: number; irisRatio: number; hysteresisDeg: number }
export function classifyGaze(s: GazeSignals, b: GazeBaseline, t: GazeThresholds, prev: GazeDirection): GazeDirection
export function extractSignals(result: FaceLandmarkerResult): GazeSignals | null

// gaze-state.ts — pure, injected clock
export class GazeStateMachine {
  observe(direction: GazeDirection, tMs: number): GazeWarning | null
  reset(): void
}

// gaze-monitor.ts — shell
export class GazeMonitor {
  static async create(opts): Promise<GazeMonitor>
  start(video: HTMLVideoElement): void
  stop(): void
}
```

---

## The split, and why

`classifyGaze` and `GazeStateMachine` are pure functions with an injected clock.
They run in the existing node test environment with no browser, no WASM, and no
camera. That matters because **the math is the part most likely to be wrong**,
and it is the part a reviewer will be asked to trust when looking at a
candidate's evidence.

`GazeMonitor` is the only file that touches MediaPipe, and it contains no
thresholds or decisions.

---

## Baseline calibration, and its honest limits

The first few seconds after start are used as a neutral baseline, on the
assumption the candidate is looking at the screen. That assumption is sometimes
wrong, and when it is, the baseline is skewed for the whole session.

Mitigations that are in scope: require a minimum number of stable samples before
accepting a baseline, discard frames where no face is detected, and re-calibrate
if the candidate is centred and stable for a long stretch. What is **not** in
scope is pretending this is solved. The baseline lives in memory for the session
only, is never uploaded, and never persisted — and gaze never auto-fails anyone,
which is the real safeguard.

---

## Steps

- [ ] **Step 1: Install and vendor MediaPipe**

```bash
npm install @mediapipe/tasks-vision
```

Copy the WASM bundle out of the package and fetch the model:

```bash
mkdir -p public/mediapipe/wasm
cp node_modules/@mediapipe/tasks-vision/wasm/* public/mediapipe/wasm/
curl -L -o public/mediapipe/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

```bash
ls -la public/mediapipe/wasm && du -h public/mediapipe/face_landmarker.task
```

The model should be roughly 3.7 MB. Committing it is deliberate: the default CDN
fetch means a blocked or slow CDN breaks proctoring **mid-assessment**, after the
candidate has already granted permissions and started the clock.

Confirm nothing in `.gitignore` excludes it:

```bash
git check-ignore -v public/mediapipe/face_landmarker.task || echo "OK: will be committed"
```

- [ ] **Step 2: Write the classifier test first** — `tests/proctoring-gaze-classify.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { classifyGaze } from '@/lib/proctoring/client/gaze-classify'

const T = { yawDeg: 18, pitchDeg: 15, irisRatio: 0.28, hysteresisDeg: 5 }
const B = { yaw: 0, pitch: 0 }
const sig = (yaw: number, pitch = 0, iris: number | null = null, faceCount = 1) =>
  ({ yaw, pitch, irisOffsetX: iris, faceCount })

describe('classifyGaze', () => {
  it('calls a centred face CENTER', () => {
    expect(classifyGaze(sig(0), B, T, 'CENTER')).toBe('CENTER')
    expect(classifyGaze(sig(10), B, T, 'CENTER')).toBe('CENTER')
  })

  it('classifies sustained head turn past the threshold', () => {
    expect(classifyGaze(sig(25), B, T, 'CENTER')).toBe('RIGHT')
    expect(classifyGaze(sig(-25), B, T, 'CENTER')).toBe('LEFT')
  })

  it('applies hysteresis so a face hovering at the threshold does not flicker', () => {
    // Already RIGHT: it takes dropping below (threshold - hysteresis) to return.
    expect(classifyGaze(sig(15), B, T, 'RIGHT')).toBe('RIGHT')
    expect(classifyGaze(sig(12), B, T, 'RIGHT')).toBe('CENTER')
    // From CENTER, 15 is not enough to trigger.
    expect(classifyGaze(sig(15), B, T, 'CENTER')).toBe('CENTER')
  })

  it('measures against the baseline, not absolute zero', () => {
    // A candidate whose camera sits off to one side reads 20 while looking straight on.
    const offset = { yaw: 20, pitch: 0 }
    expect(classifyGaze(sig(20), offset, T, 'CENTER')).toBe('CENTER')
    expect(classifyGaze(sig(45), offset, T, 'CENTER')).toBe('RIGHT')
  })

  it('reports vertical deviation', () => {
    expect(classifyGaze(sig(0, 22), B, T, 'CENTER')).toBe('UP')
    expect(classifyGaze(sig(0, -22), B, T, 'CENTER')).toBe('DOWN')
  })

  it('prefers the horizontal reading when both axes exceed threshold', () => {
    // Looking down-left at a phone reads as LEFT, which is the more useful signal.
    expect(classifyGaze(sig(-30, -30), B, T, 'CENTER')).toBe('LEFT')
  })

  it('reports face presence problems before direction', () => {
    expect(classifyGaze(sig(0, 0, null, 0), B, T, 'CENTER')).toBe('FACE_NOT_DETECTED')
    expect(classifyGaze(sig(40, 0, null, 2), B, T, 'CENTER')).toBe('MULTIPLE_FACES')
  })

  it('combines iris offset with head pose rather than relying on head alone', () => {
    // Head near-centre but eyes hard over: still a deviation.
    expect(classifyGaze(sig(8, 0, 0.45), B, T, 'CENTER')).toBe('RIGHT')
    // Head near-centre, eyes centred: not a deviation.
    expect(classifyGaze(sig(8, 0, 0.05), B, T, 'CENTER')).toBe('CENTER')
  })
})
```

- [ ] **Step 3: Implement `gaze-classify.ts`**

`extractSignals` derives yaw and pitch from
`result.facialTransformationMatrixes[0].data` — a column-major 4×4. Take the
rotation submatrix and convert to Euler angles in degrees. Iris offset uses the
iris landmark centres relative to the eye corners, normalised by eye width, and
is `null` when the model did not return iris points.

Order of precedence inside `classifyGaze`, which the tests above pin:
face count problems first, then horizontal, then vertical, with hysteresis
applied against `prev`.

- [ ] **Step 4: Write the state machine test — the PRD's cases, verbatim**

`tests/proctoring-gaze-state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { GazeStateMachine } from '@/lib/proctoring/client/gaze-state'

/**
 * These are the acceptance cases from the PRD, stated as tests. A warning must
 * require sustained deviation, must not repeat inside the cooldown, and must
 * reset when the candidate looks back.
 */
const opts = { gazeWarningMs: 1500, cooldownMs: 10_000, faceMissingMs: 3000, multipleFacesMs: 3000 }

describe('GazeStateMachine', () => {
  let m: GazeStateMachine
  beforeEach(() => { m = new GazeStateMachine(opts) })

  it('CENTER never warns', () => {
    for (let t = 0; t <= 30_000; t += 200) expect(m.observe('CENTER', t)).toBeNull()
  })

  it('LEFT for 500ms does not warn', () => {
    expect(m.observe('LEFT', 0)).toBeNull()
    expect(m.observe('LEFT', 500)).toBeNull()
  })

  it('LEFT for 1500ms warns exactly once', () => {
    m.observe('LEFT', 0)
    expect(m.observe('LEFT', 1400)).toBeNull()
    const w = m.observe('LEFT', 1500)
    expect(w).toMatchObject({ type: 'GAZE_LEFT', direction: 'LEFT' })
    // Still deviating, but already warned.
    expect(m.observe('LEFT', 1700)).toBeNull()
  })

  it('does not warn again inside the cooldown', () => {
    m.observe('LEFT', 0)
    expect(m.observe('LEFT', 1500)).not.toBeNull()
    expect(m.observe('LEFT', 2500)).toBeNull()
    expect(m.observe('LEFT', 9000)).toBeNull()
  })

  it('warns again once the cooldown has elapsed and deviation is sustained', () => {
    m.observe('LEFT', 0)
    m.observe('LEFT', 1500)          // first warning at t=1500
    m.observe('CENTER', 2000)        // look back
    m.observe('LEFT', 11_000)        // deviate again, after the cooldown
    expect(m.observe('LEFT', 12_500)).not.toBeNull()
  })

  it('returning to CENTER resets the sustained timer', () => {
    m.observe('LEFT', 0)
    m.observe('CENTER', 1000)
    m.observe('LEFT', 1200)
    // Only 300ms of the new deviation has elapsed - no warning.
    expect(m.observe('LEFT', 1500)).toBeNull()
  })

  it('RIGHT for 1500ms warns, independently of an earlier LEFT', () => {
    m.observe('LEFT', 0)
    m.observe('LEFT', 1500)
    m.observe('CENTER', 2000)
    m.observe('RIGHT', 20_000)
    expect(m.observe('RIGHT', 21_500)).toMatchObject({ type: 'GAZE_RIGHT' })
  })

  it('a missing face warns on its own, longer threshold', () => {
    m.observe('FACE_NOT_DETECTED', 0)
    expect(m.observe('FACE_NOT_DETECTED', 2000)).toBeNull()
    expect(m.observe('FACE_NOT_DETECTED', 3000)).toMatchObject({ type: 'FACE_NOT_DETECTED' })
  })

  it('recovers automatically when the face comes back', () => {
    m.observe('FACE_NOT_DETECTED', 0)
    m.observe('FACE_NOT_DETECTED', 3000)
    expect(m.observe('CENTER', 3200)).toBeNull()
    m.observe('FACE_NOT_DETECTED', 3400)
    // Fresh 3s window, not a continuation of the old one.
    expect(m.observe('FACE_NOT_DETECTED', 5000)).toBeNull()
  })

  it('multiple faces warn on their own threshold', () => {
    m.observe('MULTIPLE_FACES', 0)
    expect(m.observe('MULTIPLE_FACES', 3000)).toMatchObject({ type: 'MULTIPLE_FACES_DETECTED' })
  })

  it('UNCERTAIN neither warns nor resets a run in progress', () => {
    m.observe('LEFT', 0)
    m.observe('UNCERTAIN', 700)     // a dropped frame must not look like recovery
    expect(m.observe('LEFT', 1500)).not.toBeNull()
  })

  it('reports the duration of the deviation in the warning', () => {
    m.observe('LEFT', 0)
    const w = m.observe('LEFT', 2100)
    expect(w?.durationMs).toBe(2100)
  })
})
```

- [ ] **Step 5: Implement `gaze-state.ts`** until those pass. Independent
      cooldowns per warning type; `UNCERTAIN` is explicitly a no-op.

```bash
npx vitest run tests/proctoring-gaze-state.test.ts tests/proctoring-gaze-classify.test.ts
```

- [ ] **Step 6: Write `gaze-monitor.ts`** — the shell

```
- FilesetResolver.forVisionTasks('/mediapipe/wasm'), local path not a CDN
- FaceLandmarker.createFromOptions with modelAssetPath '/mediapipe/face_landmarker.task',
  runningMode 'VIDEO', numFaces 2, outputFacialTransformationMatrixes true,
  outputFaceBlendshapes false (unused, and it costs time per frame)
- throttled to ~6 FPS via a timestamp check inside requestAnimationFrame, NOT
  one inference per frame - this shares a thread with the exam UI
- collects baseline samples for the first ~3s, requiring a minimum count of
  stable CENTER-ish frames before accepting it
- emits warnings through a callback; it neither uploads nor renders
- stop() closes the FaceLandmarker and cancels the rAF loop
```

Single-threaded WASM only: there are no COOP/COEP headers on this app, so
`SharedArrayBuffer` is unavailable and the threaded build will not run. Do not
add those headers as part of this work — they change behaviour app-wide.

- [ ] **Step 7: Typecheck and full suite**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

- [ ] **Step 8: Confirm no frame ever leaves the browser**

```bash
grep -rn "fetch\|XMLHttpRequest\|sendBeacon" src/lib/proctoring/client/gaze-monitor.ts src/lib/proctoring/client/gaze-classify.ts src/lib/proctoring/client/gaze-state.ts || echo "OK: gaze modules make no network calls"
```

This must print the OK line. Gaze analysis is local by design, and this is the
check that keeps it that way as the code changes.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "proctoring part 8: local MediaPipe gaze detection with pure classifier and state machine"
```

Do not push. Note this commit includes ~6 MB of vendored model and WASM.

- [ ] **Step 10: Update `PROGRESS.md`.**

---

## Done when

- Every PRD threshold case in `proctoring-gaze-state.test.ts` passes.
- The classifier and state machine have no browser dependency.
- The gaze modules make no network calls whatsoever.
- MediaPipe assets are served from `public/mediapipe/`, not a CDN.

**Not verified here:** that real faces classify correctly. Synthetic signals
prove the logic, not the model. Part 14's manual test is where looking left
actually has to produce a warning.
