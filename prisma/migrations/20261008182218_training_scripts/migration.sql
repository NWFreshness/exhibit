-- CreateTable
CREATE TABLE "TrainingScript" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'stub',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingScript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingScript_districtId_idx" ON "TrainingScript"("districtId");

-- CreateIndex
CREATE INDEX "TrainingScript_snapshotId_idx" ON "TrainingScript"("snapshotId");

-- AddForeignKey
ALTER TABLE "TrainingScript" ADD CONSTRAINT "TrainingScript_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE ON UPDATE CASCADE;
