// Monthly renewal pass. Flags rows, never emails. No outbound HTTP anywhere
// in this module: no vendor pages are fetched, no policy change is guessed.
import type { PrismaClient } from "@prisma/client";

export const RENEWAL_REASONS = ["ends_soon", "expired", "still_hold"] as const;
export type RenewalReason = (typeof RENEWAL_REASONS)[number];

const DAY = 86_400_000;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function runRenewalPass(
  db: PrismaClient,
  districtId?: string
): Promise<{ flagged: number; cleared: number; forcedHold: number }> {
  const today = startOfToday();
  const soon = new Date(today.getTime() + 90 * DAY);
  let flagged = 0, cleared = 0, forcedHold = 0;

  const districts = districtId
    ? await db.district.findMany({ where: { id: districtId }, select: { id: true } })
    : await db.district.findMany({ select: { id: true } });

  for (const d of districts) {
    const tools = await db.districtTool.findMany({ where: { districtId: d.id } });
    for (const t of tools) {
      const reasons = new Set<RenewalReason>();
      const endsOn = t.agreementEndsOn ? new Date(t.agreementEndsOn) : null;
      if (t.agreementStatus === "expired" || (endsOn && endsOn < today)) reasons.add("expired");
      else if (endsOn && endsOn <= soon) reasons.add("ends_soon");
      if (t.decision === "hold") reasons.add("still_hold");

      // Expiry forces hold for approved/limited rows. Stale draft follows via hash.
      if (reasons.has("expired") && (t.decision === "approved" || t.decision === "limited")) {
        await db.districtTool.update({
          where: { id: t.id },
          data: { agreementStatus: "expired", decision: "hold", decidedBy: "renewal-pass", decidedAt: new Date() },
        });
        await db.decisionEvent.create({
          data: {
            districtId: d.id, toolId: t.id, actor: "renewal-pass",
            fromStatus: `${t.agreementStatus}/${t.decision}`, toStatus: "expired/hold",
          },
        });
        forcedHold++;
      }

      const open = await db.renewalFlag.findMany({
        where: { districtToolId: t.id, clearedAt: null },
      });
      for (const f of open) {
        if (!reasons.has(f.reason as RenewalReason)) {
          await db.renewalFlag.update({ where: { id: f.id }, data: { clearedAt: new Date() } });
          cleared++;
        } else {
          reasons.delete(f.reason as RenewalReason);
        }
      }
      for (const reason of reasons) {
        await db.renewalFlag.create({ data: { districtId: d.id, districtToolId: t.id, reason } });
        flagged++;
      }
    }
  }
  return { flagged, cleared, forcedHold };
}

export async function openRenewalCount(db: PrismaClient, districtId: string): Promise<number> {
  return db.renewalFlag.count({ where: { districtId, clearedAt: null } });
}
