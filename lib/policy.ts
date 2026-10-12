// Policy and tool list are two things. The board adopts the policy text about
// once a year; the council publishes a new tool list under it as tools change.
import type { AdoptedSnapshot, PrismaClient } from "@prisma/client";

/** The policy in force: the latest snapshot the board has adopted. A snapshot
 *  the council approved but the board has not adopted yet is not in force. */
export async function currentPolicy(db: PrismaClient, districtId: string): Promise<AdoptedSnapshot | null> {
  return db.adoptedSnapshot.findFirst({
    where: { districtId, boardAdoptedOn: { not: null } },
    orderBy: { adoptedAt: "desc" },
  });
}

export async function latestSnapshot(db: PrismaClient, districtId: string): Promise<AdoptedSnapshot | null> {
  return db.adoptedSnapshot.findFirst({ where: { districtId }, orderBy: { adoptedAt: "desc" } });
}

export type ToolList = { versionId: string | null; toolTable: unknown; toolHash: string; publishedAt: Date; publishedBy: string };

/** The tool list published under one snapshot: its latest version, or the
 *  table pinned at approval for snapshots that predate versions. */
export async function toolListFor(db: PrismaClient, snap: AdoptedSnapshot): Promise<ToolList> {
  const v = await db.toolListVersion.findFirst({ where: { snapshotId: snap.id }, orderBy: { publishedAt: "desc" } });
  return v
    ? { versionId: v.id, toolTable: v.toolTable, toolHash: v.toolHash, publishedAt: v.publishedAt, publishedBy: v.publishedBy }
    : { versionId: null, toolTable: snap.toolTable, toolHash: snap.toolHash, publishedAt: snap.adoptedAt, publishedBy: snap.adoptedBy };
}
