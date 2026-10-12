-- AlterTable
ALTER TABLE "AdoptedSnapshot" ADD COLUMN     "boardAdoptedOn" TIMESTAMP(3),
ADD COLUMN     "boardResolution" TEXT,
ADD COLUMN     "familyText" TEXT,
ADD COLUMN     "familyTranslations" JSONB;

-- AlterTable
ALTER TABLE "DistrictTool" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "limitText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "teacherGuidance" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "familyText" TEXT,
ADD COLUMN     "familyTranslations" JSONB,
ADD COLUMN     "purposeText" TEXT;

-- AlterTable
ALTER TABLE "ReviewSeat" ADD COLUMN     "signedHash" TEXT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "staffCount" INTEGER;

-- AlterTable
ALTER TABLE "TrainingAck" ADD COLUMN     "toolListId" TEXT;

-- CreateTable
CREATE TABLE "ToolListVersion" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toolHash" TEXT NOT NULL,
    "toolTable" JSONB NOT NULL,

    CONSTRAINT "ToolListVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedFinding" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "catalogToolId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" BOOLEAN NOT NULL,
    "citationUrl" TEXT NOT NULL,
    "citationDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolListVersion_districtId_idx" ON "ToolListVersion"("districtId");

-- CreateIndex
CREATE INDEX "ToolListVersion_snapshotId_idx" ON "ToolListVersion"("snapshotId");

-- CreateIndex
CREATE INDEX "SharedFinding_districtId_idx" ON "SharedFinding"("districtId");

-- CreateIndex
CREATE INDEX "SharedFinding_catalogToolId_idx" ON "SharedFinding"("catalogToolId");

-- AddForeignKey
ALTER TABLE "ToolListVersion" ADD CONSTRAINT "ToolListVersion_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolListVersion" ADD CONSTRAINT "ToolListVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AdoptedSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedFinding" ADD CONSTRAINT "SharedFinding_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedFinding" ADD CONSTRAINT "SharedFinding_catalogToolId_fkey" FOREIGN KEY ("catalogToolId") REFERENCES "CatalogTool"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Snapshots adopted before the council/board split count as board-adopted,
-- so nothing already public or trained on disappears.
UPDATE "AdoptedSnapshot" SET "boardAdoptedOn" = "adoptedAt" WHERE "boardAdoptedOn" IS NULL;
