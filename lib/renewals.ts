// Monthly renewal pass. Flags rows, then lists them in one digest per person.
// No outbound web requests anywhere in this module: no vendor pages are read,
// no policy change is guessed. Sending the digest is the caller's job.
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
    const tools = await db.districtTool.findMany({ where: { districtId: d.id, archivedAt: null } });
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

const REASON_WORDS: Record<string, string> = {
  ends_soon: "agreement ends within 90 days",
  expired: "agreement expired",
  still_hold: "still on hold, needs a decision",
};

export type RenewalDigest = { to: string; districtName: string; lines: string[] };

/** One digest per recipient: a tool's renewal owner gets its flags; flags on
 *  tools with no renewal owner go to the district owners. Nothing open, no digest. */
export async function renewalDigests(db: PrismaClient, districtId?: string): Promise<RenewalDigest[]> {
  const flags = await db.renewalFlag.findMany({
    where: { clearedAt: null, ...(districtId ? { districtId } : {}), districtTool: { archivedAt: null } },
    include: { districtTool: true, district: { select: { name: true } } },
    orderBy: { flaggedAt: "asc" },
  });
  if (!flags.length) return [];
  const users = await db.user.findMany({
    where: { districtId: { in: [...new Set(flags.map((f) => f.districtId))] } },
    select: { id: true, email: true, role: true, districtId: true },
  });
  const out = new Map<string, RenewalDigest>();
  for (const f of flags) {
    const owner = users.find((u) => u.id === f.districtTool.renewalOwnerUserId && u.districtId === f.districtId);
    const to = owner ? [owner.email] : users.filter((u) => u.districtId === f.districtId && u.role === "owner").map((u) => u.email);
    const ends = f.districtTool.agreementEndsOn ? ` (ends ${f.districtTool.agreementEndsOn.toISOString().slice(0, 10)})` : "";
    for (const email of to) {
      const key = `${f.districtId}:${email}`;
      const d = out.get(key) ?? { to: email, districtName: f.district.name, lines: [] };
      d.lines.push(`${f.districtTool.rawName}: ${REASON_WORDS[f.reason] ?? f.reason}${ends}`);
      out.set(key, d);
    }
  }
  return [...out.values()];
}
