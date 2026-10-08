import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble } from "@/lib/assembler";
import { openRequestCount } from "@/lib/requests";
import { openRenewalCount } from "@/lib/renewals";

export default async function Home() {
  const user = await requireUser();
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const tools = await prisma.districtTool.findMany({ where: { districtId: user.districtId } });
  const ai = (s: string) => tools.filter((t) => t.aiStatus === s).length;
  const hold = tools.filter((t) => t.decision === "hold").length;
  const snap = await prisma.adoptedSnapshot.findFirst({
    where: { districtId: user.districtId }, orderBy: { adoptedAt: "desc" },
  });
  let stale = false;
  if (snap) {
    const live = await assemble(prisma, user.districtId);
    stale = live.toolHash !== snap.toolHash || live.answersHash !== snap.answersHash;
  }
  const openRequests = await openRequestCount(prisma, user.districtId);
  const renewalsDue = await openRenewalCount(prisma, user.districtId);
  const schools = await prisma.school.findMany({ where: { districtId: user.districtId }, orderBy: { name: "asc" } });
  let untrained: string[] = [];
  if (snap && schools.length) {
    const counts = await prisma.trainingAck.groupBy({
      by: ["schoolId"], where: { districtId: user.districtId, snapshotId: snap.id }, _count: true,
    });
    const signed = new Set(counts.filter((c) => c.schoolId).map((c) => c.schoolId as string));
    untrained = schools.filter((s) => !signed.has(s.id)).map((s) => s.name);
  }
  return (
    <Shell user={user} title={district.name} kicker="At a glance">
      <p>{tools.length} tools on file. The tiles show which ones use AI, in plain terms. Only your district can see this list.</p>
      {snap ? (stale
        ? <div className="alert stale"><b>Working draft is STALE.</b> Inventory or answers changed after adoption on {snap.adoptedAt.toISOString().slice(0, 10)}. <Link href="/snapshot">View adopted snapshot</Link>.</div>
        : <div className="alert"><b>Adopted snapshot is current.</b> Adopted {snap.adoptedAt.toISOString().slice(0, 10)} by {snap.adoptedBy}. <Link href="/snapshot">View snapshot</Link>.</div>)
        : <div className="alert"><b>No adopted snapshot yet.</b> Work in the <Link href="/draft">draft</Link>; adopt when the council is ready.</div>}
      <div className="counts sans">
        <div className="count"><b>{ai("calls_model")}</b><span className="status">Calls a model</span></div>
        <div className="count"><b>{ai("no_model")}</b><span className="status">No model</span></div>
        <div className="count"><b>{ai("unknown")}</b><span className="status">Unknown</span></div>
        <div className="count"><b>{hold}</b><span className="status">Hold</span></div>
      </div>
      <p className="hint sans">{tools.length} total: {ai("calls_model")} use AI, {ai("no_model")} don&apos;t, {ai("unknown")} still to check. Separately, {hold} {hold === 1 ? "is" : "are"} waiting on a decision (Hold){openRequests > 0 ? <> — including <Link href="/review#requests">{openRequests} open staff request{openRequests === 1 ? "" : "s"}</Link></> : null}.</p>
      <p className="sans no-print">
        <Link className="btn" href="/inventory">Open inventory</Link>
        <Link className="btn secondary" href="/draft">Open draft</Link>
        <Link className="btn secondary" href="/export">Open export</Link>
      </p>
      {renewalsDue > 0 ? (
        <div className="alert stale"><b>{renewalsDue} renewal{renewalsDue === 1 ? "" : "s"} due.</b> <Link href="/renewals">Open the renewal list →</Link></div>
      ) : null}
      {snap && untrained.length > 0 ? (
        <div className="alert"><b>{untrained.length} building{untrained.length === 1 ? "" : "s"} not yet trained</b> on the adopted snapshot: {untrained.join(", ")}. <Link href="/training">Open training →</Link></div>
      ) : null}
    </Shell>
  );
}
