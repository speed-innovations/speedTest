# Live monitoring hardening — spec (metadata only, no media storage)

Source: the owner's ticket of 2026-09-24. This file restates every requirement
as a checkable item, numbered by the ticket's phases, so the plan
(`live-monitoring-plan.md`) can cite them. Where the ticket gave exact copy,
it is quoted verbatim.

## Non-negotiables

- N1. No video upload, no audio upload, no webcam recording, no microphone
  recording, no screenshots, no stored screen frames.
- N2. No S3 / R2 / GCS / Azure credentials required. No storage quota. The exam
  does not depend on a storage provider.
- N3. No fake "evidence saved" / "recording" / "uploaded" states anywhere in the UI.
- N4. Webcam and mic are accessed only for live, in-browser processing. The
  webcam stream is never sent to an API endpoint.
- N5. Build on the existing implementation; do not replace working components.
  Keep MediaPipe Face Landmarker (`@mediapipe/tasks-vision` 1.0.1, self-hosted
  `public/mediapipe/face_landmarker.task`, `numFaces: 2`, 478-point mesh, iris,
  transformation matrix, `outputFaceBlendshapes: false`).
- N6. Nothing outside this ticket's scope.
- N7. Candidates are told plainly that mobile phones are not permitted.

## Phases → requirements

| # | Requirement |
|---|---|
| P1 | Architecture: webcam → browser memory → MediaPipe → signal extraction → behaviour detection → warning engine → lightweight metadata → server. No recorder, no screenshot path. |
| P2 | Camera: permission only for proctored tests; self-view; local inference; tracks stopped on assessment end, on setup cancel, on unmount. |
| P3 | Microphone: permission only (existing flow requires it). Monitor permission, track, `ended`, `muted`. Metadata events on change. Never store audio. |
| P4 | Screen share: still required. Detect started / active / stopped / track ended / resumed. Emit `SCREEN_SHARE_INTERRUPTED`. Show: "Screen sharing has stopped. Please resume screen sharing to continue the proctored assessment." Resume needs a user gesture. Never assume it is still active. |
| P5 | Faces: 0 → `FACE_MISSING`, 1 → normal, 2 → `MULTIPLE_FACES`. Only confirmed conditions are sent. |
| P6 | Iris centres 468/473, corners 33/133 and 362/263, offset normalised by eye width. Missing iris → `null`, never 0. |
| P7 | Head pose yaw/pitch/roll from the transformation matrix. Sign convention validated against a real face via a dev-only debug view (face count, yaw, pitch, roll, iris X, iris Y, direction, confidence). Manual cases: CENTER, LEFT, RIGHT, UP, DOWN, LEFT+DOWN, RIGHT+DOWN. |
| P8 | ~3 s personal baseline of yaw, pitch, iris position using medians. Deviation measured against it, not universal thresholds alone. |
| P9 | Signal fusion — never one signal. Inputs: face count, yaw, pitch, roll, iris direction, iris deviation, baseline deviation, landmark quality, face size. Eyes+head agree + sustained = strong. Eyes alone for 300 ms = ignored. Head without eyes = weak/moderate. |
| P10 | Temporal state machine NORMAL → POSSIBLE_DEVIATION → SUSTAINED_DEVIATION → WARNING → COOLDOWN → NORMAL. Side 1.5–2 s, down 2–3 s, face missing ~2 s, multiple faces short, cooldown ~10 s. One central config. |
| P11 | Repeated behaviour tracked in memory: occurrences, total duration, max duration, frequency, last occurrence. Emit `SUSTAINED_DOWNWARD_ATTENTION` / `REPEATED_DOWNWARD_ATTENTION`. Never `PHONE_DETECTED`. |
| P12 | Visible "● Proctoring Active ● Camera Active ● Screen Sharing Active". Non-blocking warnings (`role="status"`, `aria-live="polite"`): "Please look at the assessment screen." / "Please position your face clearly in front of the camera." / "More than one face was detected." / "Screen sharing has stopped. Please resume screen sharing." / "Your camera connection was interrupted." |
| P13 | Never reveal thresholds, durations, cooldowns or the algorithm to the candidate. |
| P14 | Browser events: `visibilitychange`, `visibilityState`, `pagehide`, `fullscreenchange`, `blur`, `focus` → `TAB_HIDDEN`, `TAB_VISIBLE`, `FULLSCREEN_EXITED`, `FULLSCREEN_ENTERED`, `WINDOW_BLUR`, `WINDOW_FOCUS`. Blur is an observation, never "cheating". |
| P15 | Server-authoritative session. `POST /api/student/proctoring/session` creates ACTIVE; `/start` verifies a valid active session. A client claiming `proctoringActive=true` achieves nothing. |
| P16 | Store metadata events only: `{ sessionId, attemptId, type, startedAt, endedAt, durationMs, confidence, metadata }`. No frames, images, video, audio, screenshots, base64 media. Types include FACE_MISSING, FACE_RETURNED, MULTIPLE_FACES, MULTIPLE_FACES_CLEARED, LOOKING_LEFT/RIGHT/UP/DOWN, GAZE_RETURNED, SUSTAINED_DOWNWARD_ATTENTION, CAMERA_INTERRUPTED, MICROPHONE_INTERRUPTED, SCREEN_SHARE_INTERRUPTED, SCREEN_SHARE_RESUMED, TAB_HIDDEN, TAB_VISIBLE, FULLSCREEN_EXITED, FULLSCREEN_ENTERED, WINDOW_BLUR, WINDOW_FOCUS, HEARTBEAT_MISSED. |
| P17 | No per-frame events. Aggregated events with duration + confidence, or STARTED/ENDED pairs. Cooldown and dedup. |
| P18 | Heartbeat ~20 s carrying session state, camera / mic / screen health, gaze monitor health, client timestamp. No media. Server decides validity. |
| P19 | Tamper detection: camera/mic/screen track ended or muted, heartbeat missing, unexpected session state, unexpected navigation. Never silently healthy. |
| P20 | Internal `PROCTORING_REVIEW_SIGNAL` aggregating observations (multiple faces strong; screen interruption strong; long face absence strong; repeated downward moderate; one glance negligible). Never `CHEATING_CONFIRMED`, never auto-fail. |
| P21 | Setup copy verbatim: "Proctoring is enabled for this assessment. Your camera, microphone permission status, screen-sharing status, and exam activity may be monitored during the assessment. Gaze analysis runs locally in your browser." In-exam panel: PROCTORING ACTIVE / Camera ● Active / Screen Share ● Active. |
| P22 | Remove every dependency that stops proctoring working without storage credentials. |
| P23 | On finish: stop camera, mic, screen tracks; stop inference; cancel frame callbacks; clear timers, event queues, calibration data, behavioural state. |
| P24 | ~6 FPS; no overlapping inference; no duplicate loops / streams / MediaPipe instances; no leaks, stale closures, unbounded timers. `requestVideoFrameCallback` where appropriate. |
| P25 | Dev-only diagnostics: face count, yaw, pitch, roll, iris offset, baseline, deviation, direction, confidence, temporal state, proctoring state, camera state, screen-share state. Not visible in production. |
| P26 | Tests — Face: 0/1/2 faces, disappears, returns. Gaze: CENTER/LEFT/RIGHT/UP/DOWN/UNKNOWN/missing iris. Temporal: brief, sustained, repeated, cooldown, recovery. Phone-like: brief down, long down, repeated down. Integrity: camera stopped, mic stopped, screen stopped, screen resumed, tab hidden, tab visible, fullscreen exit, heartbeat failure, heartbeat recovery. Regression: `proctoringEnabled=false` unchanged. |
| P27 | Document limitations honestly (hidden phones, gaze is an estimate, blur ≠ cheating, down ≠ phone, lighting, glasses, camera position, untrusted client). |
| P28 | Security review, 10 questions (start without session; camera off without event; screen off undetected; fake events for another session; another candidate's session id; bypass UI to `/start`; event spam; unbounded memory queue; camera left running; non-proctored unaffected). Fix all. |

## Owner working rules for this ticket

- Fetch latest `main` before coding (done 2026-09-24: `feat/proctoring` is 29
  commits ahead of `origin/main`, 0 behind — nothing to merge).
- The executor never starts the dev server or a browser to test. It hands the
  owner exact manual test steps instead.
- Report every changed file and why, verify each criterion one by one, and
  report what could not be done.
