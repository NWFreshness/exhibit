import type { PrismaClient } from "@prisma/client";

/** Board packet stays locked until every required seat is signed or the owner
 *  records an override with a reason. Returns lock reason when locked. */
export async function boardLock(
  db: PrismaClient,
  districtId: string
): Promise<{ locked: boolean; reason?: string; pending: string[] }> {
  const seats = await db.reviewSeat.findMany({ where: { districtId } });
  const required = seats.filter((s) => s.required);
  const pending = required
    .filter((s) => !s.signedAt && !s.overrideReason)
    .map((s) => s.seat);
  if (pending.length === 0) return { locked: false, pending: [] };
  return {
    locked: true,
    reason: `Waiting on required seats: ${pending.join(", ")}.`,
    pending,
  };
}

export const REQUIRED_SEATS = ["technology", "teaching", "sped"] as const;
export const OPTIONAL_SEATS = ["association", "cabinet"] as const;
