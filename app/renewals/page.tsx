import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canWrite } from "@/lib/tenancy";
import { runRenewalPass } from "@/lib/renewals";

const REASON_WORDS: Record<string, string> = {
  ends_soon: "Agreement ends within 90 days",
  expired: "Expired — forced to hold if it was approved or limited",
  still_hold: "Still on hold — needs a council decision",
};

export default async function RenewalsPage() {
  const user = await requireUser();
  const flags = await prisma.renewalFlag.findMany({
    where: { districtId: user.districtId, clearedAt: null },
    include: { districtTool: true },
    orderBy: { flaggedAt: "desc" },
  });
  const members = Object.fromEntries(
    (await prisma.user.findMany({ where: { districtId: user.districtId }, select: { id: true, email: true } }))
      .map((m) => [m.id, m.email])
  );

  async function recheck() {
    "use server";
    const u = await requireUser();
    if (!canWrite(u)) return;
    await runRenewalPass(prisma, u.districtId);
  }

  return (
    <Shell user={user} title="Renewals due">
      <p className="sans">Flagged by the monthly pass — end dates approaching, lapsed agreements, and rows still on hold. Flags are rows, not emails. No vendor sites are ever checked.</p>
      {canWrite(user) && (
        <form action={recheck} className="no-print"><button className="btn secondary" type="submit">Run the pass now</button></form>
      )}
      {flags.length ? (
        <table className="sans"><tr><th>Tool</th><th>Why</th><th>Ends on</th><th>Renewal owner</th><th>Flagged</th></tr>
          {flags.map((f) => (
            <tr key={f.id}>
              <td><Link href={`/tools/${f.districtToolId}`}>{f.districtTool.rawName}</Link></td>
              <td>{REASON_WORDS[f.reason] ?? f.reason}</td>
              <td>{f.districtTool.agreementEndsOn ? f.districtTool.agreementEndsOn.toISOString().slice(0, 10) : "—"}</td>
              <td>{(f.districtTool.renewalOwnerUserId && members[f.districtTool.renewalOwnerUserId]) || "—"}</td>
              <td>{f.flaggedAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </table>
      ) : <div className="alert">Nothing flagged. The next monthly pass runs on the 1st.</div>}
    </Shell>
  );
}
