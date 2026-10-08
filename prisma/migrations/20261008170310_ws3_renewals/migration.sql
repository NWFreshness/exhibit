-- AlterTable
ALTER TABLE "DistrictTool" ADD COLUMN     "agreementEndsOn" TIMESTAMP(3),
ADD COLUMN     "renewalOwnerUserId" TEXT,
ADD COLUMN     "vendorContact" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "RenewalFlag" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "districtToolId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "RenewalFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RenewalFlag_districtId_idx" ON "RenewalFlag"("districtId");

-- CreateIndex
CREATE INDEX "RenewalFlag_districtToolId_idx" ON "RenewalFlag"("districtToolId");

-- AddForeignKey
ALTER TABLE "RenewalFlag" ADD CONSTRAINT "RenewalFlag_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalFlag" ADD CONSTRAINT "RenewalFlag_districtToolId_fkey" FOREIGN KEY ("districtToolId") REFERENCES "DistrictTool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
