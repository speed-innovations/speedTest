-- Metadata-only proctoring: no media is stored any more.

-- 1. Media storage is gone.
DROP TABLE "ProctoringAsset";
DROP TYPE "ProctoringAssetStatus";
DROP TYPE "ProctoringAssetType";

-- 2. Session: media counters out, health in.
ALTER TABLE "ProctoringSession"
  DROP COLUMN "recordingStarted",
  DROP COLUMN "storageReservedBytes",
  DROP COLUMN "storageUsedBytes",
  DROP COLUMN "uploadFailureCount",
  ADD COLUMN "missedHeartbeatCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastHealth" JSONB;

-- 3. Event taxonomy. Upload events described media that no longer exists.
DELETE FROM "ProctoringEvent" WHERE "type" IN ('UPLOAD_FAILURE', 'UPLOAD_RECOVERED');

CREATE TYPE "ProctoringEventType_new" AS ENUM (
  'FACE_MISSING', 'MULTIPLE_FACES',
  'LOOKING_LEFT', 'LOOKING_RIGHT', 'LOOKING_UP', 'LOOKING_DOWN',
  'SUSTAINED_DOWNWARD_ATTENTION', 'REPEATED_DOWNWARD_ATTENTION',
  'CAMERA_INTERRUPTED', 'CAMERA_RESTORED',
  'MICROPHONE_INTERRUPTED', 'MICROPHONE_RESTORED',
  'SCREEN_SHARE_STARTED', 'SCREEN_SHARE_INTERRUPTED', 'SCREEN_SHARE_RESUMED',
  'TAB_HIDDEN', 'TAB_VISIBLE', 'FULLSCREEN_EXITED', 'FULLSCREEN_ENTERED',
  'WINDOW_BLUR', 'WINDOW_FOCUS', 'PAGE_HIDDEN', 'GAZE_MONITOR_UNAVAILABLE',
  'PROCTORING_STARTED', 'PROCTORING_ENDED',
  'HEARTBEAT_MISSED', 'PROCTORING_RESUMED'
);

ALTER TABLE "ProctoringEvent"
  ALTER COLUMN "type" TYPE "ProctoringEventType_new"
  USING (
    CASE "type"::text
      WHEN 'GAZE_LEFT' THEN 'LOOKING_LEFT'
      WHEN 'GAZE_RIGHT' THEN 'LOOKING_RIGHT'
      WHEN 'GAZE_UP' THEN 'LOOKING_UP'
      WHEN 'GAZE_DOWN' THEN 'LOOKING_DOWN'
      WHEN 'FACE_NOT_DETECTED' THEN 'FACE_MISSING'
      WHEN 'MULTIPLE_FACES_DETECTED' THEN 'MULTIPLE_FACES'
      WHEN 'SCREEN_SHARE_STOPPED' THEN 'SCREEN_SHARE_INTERRUPTED'
      WHEN 'CAMERA_STOPPED' THEN 'CAMERA_INTERRUPTED'
      WHEN 'MICROPHONE_STOPPED' THEN 'MICROPHONE_INTERRUPTED'
      WHEN 'WINDOW_BLURRED' THEN 'WINDOW_BLUR'
      ELSE "type"::text
    END
  )::"ProctoringEventType_new";

DROP TYPE "ProctoringEventType";
ALTER TYPE "ProctoringEventType_new" RENAME TO "ProctoringEventType";

-- 4. Event shape: a start, an optional end, a confidence.
ALTER TABLE "ProctoringEvent" RENAME COLUMN "occurredAt" TO "startedAt";
ALTER TABLE "ProctoringEvent"
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "confidence" DOUBLE PRECISION;
ALTER INDEX "ProctoringEvent_proctoringSessionId_occurredAt_idx"
  RENAME TO "ProctoringEvent_proctoringSessionId_startedAt_idx";
