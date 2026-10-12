// Findings a district chose to share. Readers get the value and its source,
// never the sharing district, and nothing here touches another district's
// exhibit: accepting is a separate, explicit action.
import type { PrismaClient } from "@prisma/client";

export async function shareFinding(
  db: PrismaClient,
  districtId: string,
  catalogToolId: string,
  finding: { usedForTraining?: boolean | "invalid"; trainingAddressed?: boolean | "invalid" },
  citation: { citationUrl: string; citationDate: string }
): Promise<void> {
  for (const key of ["usedForTraining", "trainingAddressed"] as const) {
    const value = finding[key];
    if (typeof value !== "boolean") continue;
    // One live row per district, tool, and fact: a re-cite replaces the old one.
    await db.sharedFinding.deleteMany({ where: { districtId, catalogToolId, key } });
    await db.sharedFinding.create({ data: { districtId, catalogToolId, key, value, ...citation } });
  }
}

/** Other districts' shared findings for one catalog tool. No district id leaves here. */
export async function sharedFindingsFor(db: PrismaClient, districtId: string, catalogToolId: string) {
  return db.sharedFinding.findMany({
    where: { catalogToolId, districtId: { not: districtId } },
    select: { id: true, key: true, value: true, citationUrl: true, citationDate: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}
