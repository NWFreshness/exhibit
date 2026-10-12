-- Promoted clause versions belong to one district. Null = shared library row.
ALTER TABLE "Clause" ADD COLUMN "districtId" TEXT;
CREATE INDEX "Clause_districtId_idx" ON "Clause"("districtId");
ALTER TABLE "Clause" ADD CONSTRAINT "Clause_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE ON UPDATE CASCADE;
