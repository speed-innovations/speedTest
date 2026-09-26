-- CreateEnum
CREATE TYPE "ProctoringSessionStatus" AS ENUM ('PENDING', 'ACTIVE', 'DEGRADED', 'COMPLETED', 'INTERRUPTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProctoringAssetType" AS ENUM ('WEBCAM_SEGMENT', 'SCREENSHOT');

-- CreateEnum
CREATE TYPE "ProctoringAssetStatus" AS ENUM ('PENDING', 'UPLOADED', 'FAILED', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProctoringEventType" AS ENUM ('GAZE_LEFT', 'GAZE_RIGHT', 'GAZE_UP', 'GAZE_DOWN', 'FACE_NOT_DETECTED', 'MULTIPLE_FACES_DETECTED', 'SCREEN_SHARE_STOPPED', 'SCREEN_SHARE_RESUMED', 'CAMERA_STOPPED', 'MICROPHONE_STOPPED', 'TAB_HIDDEN', 'WINDOW_BLURRED', 'PROCTORING_STARTED', 'PROCTORING_ENDED', 'UPLOAD_FAILURE', 'UPLOAD_RECOVERED');

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "proctoringEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProctoringSession" (
    "id" TEXT NOT NULL,
    "testAttemptId" TEXT,
    "walkInAttemptId" TEXT,
    "status" "ProctoringSessionStatus" NOT NULL DEFAULT 'PENDING',
    "version" TEXT NOT NULL DEFAULT '1',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "recordingStarted" BOOLEAN NOT NULL DEFAULT false,
    "screenShareStarted" BOOLEAN NOT NULL DEFAULT false,
    "storageReservedBytes" INTEGER NOT NULL DEFAULT 0,
    "storageUsedBytes" INTEGER NOT NULL DEFAULT 0,
    "uploadFailureCount" INTEGER NOT NULL DEFAULT 0,
    "gazeWarningCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProctoringSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctoringAsset" (
    "id" TEXT NOT NULL,
    "proctoringSessionId" TEXT NOT NULL,
    "type" "ProctoringAssetType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "sequence" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "ProctoringAssetStatus" NOT NULL DEFAULT 'PENDING',
    "elapsedMs" INTEGER,
    "questionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctoringAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctoringEvent" (
    "id" TEXT NOT NULL,
    "proctoringSessionId" TEXT NOT NULL,
    "type" "ProctoringEventType" NOT NULL,
    "direction" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "elapsedMs" INTEGER,
    "durationMs" INTEGER,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "questionId" TEXT,
    "metadata" JSONB,
    "clientEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctoringEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProctoringSession_testAttemptId_key" ON "ProctoringSession"("testAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "ProctoringSession_walkInAttemptId_key" ON "ProctoringSession"("walkInAttemptId");

-- CreateIndex
CREATE INDEX "ProctoringSession_status_idx" ON "ProctoringSession"("status");

-- CreateIndex
CREATE INDEX "ProctoringSession_retentionExpiresAt_idx" ON "ProctoringSession"("retentionExpiresAt");

-- CreateIndex
CREATE INDEX "ProctoringSession_lastHeartbeatAt_idx" ON "ProctoringSession"("lastHeartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProctoringAsset_objectKey_key" ON "ProctoringAsset"("objectKey");

-- CreateIndex
CREATE INDEX "ProctoringAsset_proctoringSessionId_capturedAt_idx" ON "ProctoringAsset"("proctoringSessionId", "capturedAt");

-- CreateIndex
CREATE INDEX "ProctoringAsset_expiresAt_status_idx" ON "ProctoringAsset"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProctoringAsset_proctoringSessionId_type_sequence_key" ON "ProctoringAsset"("proctoringSessionId", "type", "sequence");

-- CreateIndex
CREATE INDEX "ProctoringEvent_proctoringSessionId_occurredAt_idx" ON "ProctoringEvent"("proctoringSessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProctoringEvent_type_idx" ON "ProctoringEvent"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ProctoringEvent_proctoringSessionId_clientEventId_key" ON "ProctoringEvent"("proctoringSessionId", "clientEventId");

-- AddForeignKey
ALTER TABLE "ProctoringSession" ADD CONSTRAINT "ProctoringSession_testAttemptId_fkey" FOREIGN KEY ("testAttemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctoringSession" ADD CONSTRAINT "ProctoringSession_walkInAttemptId_fkey" FOREIGN KEY ("walkInAttemptId") REFERENCES "WalkInAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctoringAsset" ADD CONSTRAINT "ProctoringAsset_proctoringSessionId_fkey" FOREIGN KEY ("proctoringSessionId") REFERENCES "ProctoringSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctoringEvent" ADD CONSTRAINT "ProctoringEvent_proctoringSessionId_fkey" FOREIGN KEY ("proctoringSessionId") REFERENCES "ProctoringSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one attempt FK must be set. Without this a session could reference
-- both kinds, or neither, and every downstream query would have to defend
-- against a state the schema allowed.
ALTER TABLE "ProctoringSession"
  ADD CONSTRAINT "ProctoringSession_exactly_one_attempt"
  CHECK (
    ("testAttemptId" IS NOT NULL AND "walkInAttemptId" IS NULL)
    OR
    ("testAttemptId" IS NULL AND "walkInAttemptId" IS NOT NULL)
  );
