# Part 7 — Client core services

**Delivers:** the browser-side machinery, as plain TypeScript modules with no
React in them — state machine, MIME selection, webcam recorder, screen capture,
upload queue, API client. Plus the Vitest jsdom setup they need.

**Files**
- Modify: `vitest.config.ts`
- Create: `src/lib/proctoring/client/state-machine.ts`
- Create: `src/lib/proctoring/client/media-support.ts`
- Create: `src/lib/proctoring/client/webcam-recorder.ts`
- Create: `src/lib/proctoring/client/screen-capture.ts`
- Create: `src/lib/proctoring/client/upload-queue.ts`
- Create: `src/lib/proctoring/client/proctoring-api.ts`
- Create: `tests/proctoring-state-machine.test.ts` (pure, node)
- Create: `tests/proctoring-media-support.test.ts` (pure, node)
- Create: `tests/proctoring-upload-queue.test.ts` (pure, node)
- Create: `tests/proctoring-screen-capture.test.tsx` (jsdom)

**Interfaces — Consumes:** Parts 4–6 endpoint shapes.

**Interfaces — Produces**

```ts
export function nextState(current: ProctoringClientState, event: ProctoringEventName): ProctoringClientState
export function checkBrowserSupport(): SupportReport
export function selectRecorderMimeType(): string | null
export class WebcamRecorder      // segment lifecycle over one stream
export class ScreenCapture       // periodic compressed snapshots
export class UploadQueue         // bounded, retrying, observable
export const proctoringApi       // typed fetch wrappers
```

---

## Keep React out of these files

Media handles are long-lived and mutable; React state is neither. Putting a
`MediaStream` or a `Blob` in `useState` causes re-render storms and retains
memory the GC should have taken. These modules own the handles; Part 9's hook
subscribes to their callbacks and stores only small scalars.

This is also what makes them testable: pure logic in the node runner, and only
the two DOM-touching classes needing jsdom.

---

## Steps

- [x] **Step 1: Widen the Vitest config**

`vitest.config.ts` currently has `include: ['tests/**/*.test.ts']` and
`environment: 'node'` — `.tsx` is excluded outright.

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    // Node by default: most of this suite is pure logic and does not want a DOM.
    // Files that need one opt in with a `// @vitest-environment jsdom` docblock,
    // rather than environmentMatchGlobs, which is deprecated in Vitest 3.
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

```bash
npm install -D jsdom @testing-library/react @testing-library/jest-dom "@vitejs/plugin-react@^4"
```

**Pin the plugin to the v4 line.** Its current major (6.x) peers on `vite@^8`,
while vitest 2.1.9 pins `vite@5`; installing it unpinned fails with `ERESOLVE`.
Do not reach for `--legacy-peer-deps` — v4 supports vite 5 properly.

Run the existing suite immediately — this config change touches every test:

```bash
npm test
```

All six pre-existing test files must still pass before you go further.

- [x] **Step 2: Write the state machine test** — `tests/proctoring-state-machine.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { nextState } from '@/lib/proctoring/client/state-machine'

/**
 * The state machine exists to make contradictory states unrepresentable - a
 * session cannot be both COMPLETED and recording, and a denied permission must
 * not fall through into ACTIVE.
 */
describe('nextState', () => {
  it('walks the happy path', () => {
    let s = nextState('IDLE', 'CHECK_DEVICES')
    expect(s).toBe('CHECKING_DEVICES')
    s = nextState(s, 'DEVICES_OK')
    expect(s).toBe('READY')
    s = nextState(s, 'START_REQUESTED')
    expect(s).toBe('AWAITING_PERMISSION')
    s = nextState(s, 'PERMISSIONS_GRANTED')
    expect(s).toBe('STARTING')
    s = nextState(s, 'SESSION_STARTED')
    expect(s).toBe('ACTIVE')
  })

  it('routes a denied permission to PERMISSION_DENIED, never onward', () => {
    expect(nextState('AWAITING_PERMISSION', 'PERMISSIONS_DENIED')).toBe('PERMISSION_DENIED')
    // And a retry returns to the permission step rather than skipping it.
    expect(nextState('PERMISSION_DENIED', 'START_REQUESTED')).toBe('AWAITING_PERMISSION')
  })

  it('degrades and recovers without leaving ACTIVE permanently', () => {
    expect(nextState('ACTIVE', 'UPLOADS_BACKLOGGED')).toBe('UPLOAD_DEGRADED')
    expect(nextState('UPLOAD_DEGRADED', 'UPLOADS_RECOVERED')).toBe('ACTIVE')
  })

  it('treats a stopped screen share as interrupting, and resumable', () => {
    expect(nextState('ACTIVE', 'SCREEN_SHARE_ENDED')).toBe('SCREEN_SHARE_STOPPED')
    expect(nextState('SCREEN_SHARE_STOPPED', 'SCREEN_SHARE_RESUMED')).toBe('ACTIVE')
  })

  it('ignores events that do not apply to the current state', () => {
    // A late SESSION_STARTED after completion must not reanimate the session.
    expect(nextState('COMPLETED', 'SESSION_STARTED')).toBe('COMPLETED')
    expect(nextState('COMPLETED', 'UPLOADS_BACKLOGGED')).toBe('COMPLETED')
  })

  it('always allows finalization from any live state', () => {
    for (const s of ['ACTIVE', 'DEGRADED', 'UPLOAD_DEGRADED', 'SCREEN_SHARE_STOPPED'] as const) {
      expect(nextState(s, 'FINALIZE')).toBe('FINALIZING')
    }
    expect(nextState('FINALIZING', 'FINALIZED')).toBe('COMPLETED')
  })

  it('refuses to leave an unsupported browser state', () => {
    expect(nextState('UNSUPPORTED_BROWSER', 'START_REQUESTED')).toBe('UNSUPPORTED_BROWSER')
  })
})
```

- [x] **Step 3: Implement `state-machine.ts`** as an explicit transition table.
      Anything not in the table returns the current state unchanged — that is
      what makes "ignores events that do not apply" true by construction rather
      than by a pile of `if`s.

- [x] **Step 4: Write `media-support.ts` with its test**

```ts
/**
 * Browser capability check and recorder format selection.
 *
 * Screen capture support varies enough that a partially-proctored assessment is
 * a real risk: the PRD requires refusing outright rather than starting something
 * that silently records nothing.
 */
export interface SupportReport {
  supported: boolean
  missing: string[]
}

export function checkBrowserSupport(): SupportReport {
  const missing: string[] = []
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) missing.push('MediaDevices')
  else {
    if (typeof navigator.mediaDevices.getUserMedia !== 'function') missing.push('getUserMedia')
    if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') missing.push('getDisplayMedia')
  }
  if (typeof MediaRecorder === 'undefined') missing.push('MediaRecorder')
  else if (!selectRecorderMimeType()) missing.push('a supported WebM recording format')
  return { supported: missing.length === 0, missing }
}

/**
 * Preference order, most to least desirable. VP8/Opus first: it is the most
 * widely supported combination and decodes everywhere the admin player runs.
 * Never hardcode a single type - isTypeSupported is the only reliable answer.
 */
const CANDIDATES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
  'video/mp4',
]

export function selectRecorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}
```

Test it by stubbing `MediaRecorder.isTypeSupported` to accept only the third
candidate, and assert the picker falls back rather than failing. Also assert
`checkBrowserSupport()` reports every missing capability, not just the first.

- [x] **Step 5: Write `upload-queue.ts` with its test**

The queue is pure logic over injected callbacks — no DOM, so it tests in node.

Required behaviour:

```
- enqueue moves an item PENDING -> UPLOADING -> UPLOADED
- a transient failure retries with exponential backoff
- after maxRetries the item is FAILED and the onDegraded callback fires
- the queue is bounded: enqueueing past maxItems drops the OLDEST pending item
  and reports it, rather than growing without limit
- concurrency is capped at 1 so a segment upload never competes with a screenshot
- drain() resolves once every item is terminal
- items are attempted in FIFO order
```

The bounded-drop rule deserves a comment in the code: dropping the oldest is
deliberate, because recent evidence is more useful than old evidence when the
network is failing and something has to give. Accumulating hundreds of MB of
unuploaded webcam video in the tab is the outcome being avoided.

Inject the clock and the uploader so backoff is testable without real waiting:

```ts
export interface UploadQueueOptions {
  maxItems: number
  maxRetries: number
  baseDelayMs: number
  upload: (item: QueueItem) => Promise<void>
  onStateChange?: (summary: QueueSummary) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}
```

- [x] **Step 6: Write `webcam-recorder.ts`**

Key rules, each worth a comment in the source:

- **Never stop the stream between segments.** Stop and restart `MediaRecorder`
  only; stopping the track would drop the camera light and re-prompt on some
  browsers.
- **Wait for the final `dataavailable` before building the Blob.** Resolving on
  `onstop` alone truncates the last chunk.
- **Track elapsed time with `performance.now()`**, not by counting timeslices —
  MediaRecorder's timing drifts and the admin timeline depends on this.
- Emit each finished segment through a callback with its sequence, duration, and
  `elapsedMs`; the recorder does not know about uploading.

- [x] **Step 7: Write `screen-capture.ts`**

```
- holds the display stream purely to take snapshots; it NEVER constructs a
  MediaRecorder over it. Screen video is never recorded.
- waits for non-zero videoWidth/videoHeight before the first capture
- draws to a canvas scaled to max 1280px wide, preserving aspect ratio
- encodes WebP at ~0.65, falling back to JPEG when toBlob yields null
- if the blob exceeds maxScreenshotBytes: lower quality, then lower dimensions,
  then give up and report rather than uploading something oversized
- listens for track.onended and reports it; does not try to re-acquire silently
```

Its test is the jsdom one (`tests/proctoring-screen-capture.test.tsx`): stub
`HTMLCanvasElement.prototype.toBlob` to return blobs of controlled sizes and
assert the re-encode ladder runs in the right order and terminates.

- [x] **Step 8: Write `proctoring-api.ts`** — thin typed wrappers over the Part
      4–6 endpoints. One place that knows the URLs, so Part 9 has no `fetch`
      calls in it. Every method returns a discriminated result rather than
      throwing, so the caller can degrade instead of crashing a live assessment.

- [x] **Step 9: Run the client tests**

```bash
npx vitest run tests/proctoring-state-machine.test.ts tests/proctoring-media-support.test.ts tests/proctoring-upload-queue.test.ts tests/proctoring-screen-capture.test.tsx
```

- [x] **Step 10: Typecheck and full suite**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
npm test
```

- [x] **Step 11: Commit**

```bash
git add -A && git commit -m "proctoring part 7: client core services and jsdom test setup"
```

Do not push.

- [x] **Step 12: Update `PROGRESS.md`** — note whether the Vitest config change
      disturbed any existing test, since that is the riskiest edit in this part.

---

## Done when

- The six pre-existing test files still pass under the new Vitest config.
- No module in `client/` imports React.
- `screen-capture.ts` contains no `MediaRecorder` reference at all — grep it:

```bash
grep -n "MediaRecorder" src/lib/proctoring/client/screen-capture.ts && echo "FAIL: screen must never be recorded" || echo "OK: no recorder over the display stream"
```

- The upload queue is bounded and its drop policy is tested.
