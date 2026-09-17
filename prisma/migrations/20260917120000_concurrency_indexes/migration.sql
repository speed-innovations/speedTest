-- CreateIndex
CREATE INDEX "User_collegeId_idx" ON "User"("collegeId");

-- CreateIndex
CREATE INDEX "StudentProfile_collegeId_idx" ON "StudentProfile"("collegeId");

-- CreateIndex
CREATE INDEX "StudentProfile_status_idx" ON "StudentProfile"("status");

-- CreateIndex
CREATE INDEX "TestSchedule_collegeId_scheduledAt_idx" ON "TestSchedule"("collegeId", "scheduledAt");

-- CreateIndex
CREATE INDEX "TestSchedule_testId_idx" ON "TestSchedule"("testId");

-- CreateIndex
CREATE INDEX "Question_area_isActive_idx" ON "Question"("area", "isActive");

-- CreateIndex
CREATE INDEX "Question_isActive_idx" ON "Question"("isActive");

-- CreateIndex
CREATE INDEX "TestAttempt_studentId_idx" ON "TestAttempt"("studentId");

-- CreateIndex
CREATE INDEX "TestAttempt_userId_idx" ON "TestAttempt"("userId");

-- CreateIndex
CREATE INDEX "CandidateResponse_questionId_idx" ON "CandidateResponse"("questionId");

-- CreateIndex
CREATE INDEX "WalkInAttempt_studentId_idx" ON "WalkInAttempt"("studentId");

-- CreateIndex
CREATE INDEX "WalkInAttempt_userId_idx" ON "WalkInAttempt"("userId");

-- CreateIndex
CREATE INDEX "WalkInResponse_questionId_idx" ON "WalkInResponse"("questionId");

