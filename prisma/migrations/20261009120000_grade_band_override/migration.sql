-- AlterTable: DistrictTool gains per-tool grade-band overrides (spec 4.5).
-- Null means inherit the questionnaire band (today's behavior); no backfill.
ALTER TABLE "DistrictTool" ADD COLUMN "integrityK5Override" TEXT;
ALTER TABLE "DistrictTool" ADD COLUMN "integrity68Override" TEXT;
ALTER TABLE "DistrictTool" ADD COLUMN "integrity912Override" TEXT;
