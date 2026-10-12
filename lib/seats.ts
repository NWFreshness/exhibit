import type { PrismaClient } from "@prisma/client";

/** Board packet stays locked until every required seat is signed or the owner
 *  records an override with a reason. A signature or override counts only for
 *  the draft it approved: pass the current draft hash and a changed draft
 *  lapses it. Rows signed before hashes were recorded (null) stay valid. */
export async function boardLock(
  db: PrismaClient,
  districtId: string,
  draftHash?: string
): Promise<{ locked: boolean; reason?: string; pending: string[]; lapsed: string[] }> {
  const seats = await db.reviewSeat.findMany({ where: { districtId } });
  const required = seats.filter((s) => s.required);
  const acted = (s: (typeof seats)[number]) => Boolean(s.signedAt || s.overrideReason);
  const current = (s: (typeof seats)[number]) => !draftHash || !s.signedHash || s.signedHash === draftHash;
  const lapsed = seats.filter((s) => acted(s) && !current(s)).map((s) => s.seat);
  const pending = required.filter((s) => !acted(s) || !current(s)).map((s) => s.seat);
  if (pending.length === 0) return { locked: false, pending: [], lapsed };
  const stale = pending.filter((s) => lapsed.includes(s));
  return {
    locked: true,
    reason: `Waiting on required seats: ${pending.join(", ")}.` +
      (stale.length ? ` The draft changed after ${stale.join(", ")} signed, so ${stale.length === 1 ? "that signature needs" : "those signatures need"} renewing.` : ""),
    pending,
    lapsed,
  };
}

export const REQUIRED_SEATS = ["technology", "teaching", "sped"] as const;
export const OPTIONAL_SEATS = ["association", "cabinet"] as const;
