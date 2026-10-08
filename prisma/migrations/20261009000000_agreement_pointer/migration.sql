-- AlterTable: Agreement gains kind + alliance-pointer columns (spec 4.2).
-- kind defaults to local_upload so existing rows keep their meaning; no backfill.
-- blobKey stays NOT NULL; pointer rows store an empty string, never a fake key.
ALTER TABLE "Agreement" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'local_upload';
ALTER TABLE "Agreement" ADD COLUMN "registryUrl" TEXT;
ALTER TABLE "Agreement" ADD COLUMN "registryId" TEXT;
ALTER TABLE "Agreement" ADD COLUMN "originator" TEXT;
