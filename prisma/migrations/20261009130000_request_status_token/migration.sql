-- AlterTable: ToolRequest gains an unguessable status token (spec 4.6).
-- Null on rows created before tokens; never backfilled with anything guessable.
ALTER TABLE "ToolRequest" ADD COLUMN "statusToken" TEXT;
CREATE UNIQUE INDEX "ToolRequest_statusToken_key" ON "ToolRequest"("statusToken");
