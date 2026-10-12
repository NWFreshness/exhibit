import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble, isOpenRequest } from "@/lib/assembler";
import { diffToolTables, normalizeLiveRow, type DiffEntry } from "@/lib/diff";
import { openRequestCount } from "@/lib/requests";
import { openRenewalCount } from "@/lib/renewals";
import { latestSnapshot, currentPolicy, toolListFor } from "@/lib/policy";

export default async function Home() {
  const user = await requireUser();
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const tools = await prisma.districtTool.findMany({
    where: { districtId: user.districtId, archivedAt: null },
    include: { agreements: { orderBy: { createdAt: "desc" } } },
  });
  const ai = (s: string) => tools.filter((t) => t.aiStatus === s).length;
  const hold = tools.filter((t) => t.decision === "hold").length;
  const snap = await latestSnapshot(prisma, user.districtId);
  const policy = await currentPolicy(prisma, user.districtId);
  const toolList = policy ? await toolListFor(prisma, policy) : null;
  const live = snap ? await assemble(prisma, user.districtId, { prose: false }) : null;
  const policyStale = Boolean(snap && live && live.answersHash !== snap.answersHash);
  const toolsStale = Boolean(toolList && live && live.toolHash !== toolList.toolHash);
  let moved: DiffEntry[] | null = null;
  if (toolList && toolsStale) {
    const answers = (policy!.answersJson ?? {}) as { integrityK5?: string | null; integrity68?: string | null; integrity912?: string | null };
    moved = diffToolTables(toolList.toolTable, tools.filter((t) => !isOpenRequest(t)).map((t) => normalizeLiveRow(t, answers)));
  }
  const openRequests = await openRequestCount(prisma, user.districtId);
  const renewalsDue = await openRenewalCount(prisma, user.districtId);
  const schools = await prisma.school.findMany({ where: { districtId: user.districtId }, orderBy: { name: "asc" } });
  let untrained: string[] = [];
  if (policy && schools.length) {
    const counts = await prisma.trainingAck.groupBy({
      by: ["schoolId"], where: { districtId: user.districtId, snapshotId: policy.id }, _count: true,
    });
    const signed = new Set(counts.filter((c) => c.schoolId).map((c) => c.schoolId as string));
    untrained = schools.filter((s) => !signed.has(s.id)).map((s) => s.name);
  }
  return (
    <Shell user={user} title={district.name} kicker="At a glance">
      <p>{tools.length} tools on file. The tiles show which ones use AI, in plain terms. Only your district can see this list.</p>
      {!snap && <div className="alert"><b>No approved policy yet.</b> Work in the <Link href="/draft">draft</Link>; record council approval when the seats have signed.</div>}
      {snap && !snap.boardAdoptedOn && <div className="alert stale"><b>Council approved, waiting for the board.</b> The policy approved on {snap.adoptedAt.toISOString().slice(0, 10)} is not in force yet. <Link href="/snapshot">Record the board date</Link>.</div>}
      {policy && !policyStale && !toolsStale && <div className="alert"><b>Policy and tool list are current.</b> Board adopted {policy.boardAdoptedOn!.toISOString().slice(0, 10)}; tool list published {toolList!.publishedAt.toISOString().slice(0, 10)}. <Link href="/snapshot">View</Link>.</div>}
      {policyStale && <div className="alert stale"><b>The policy text changed</b> since the council approved it. That needs seat sign-off and a board vote. <Link href="/draft">Open the draft</Link>.</div>}
      {toolsStale && <div className="alert stale"><b>The tool list changed</b> since it was published on {toolList!.publishedAt.toISOString().slice(0, 10)}. No board vote needed: <Link href="/draft">publish the new list</Link>.</div>}
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
      {policy && untrained.length > 0 ? (
        <div className="alert"><b>{untrained.length} building{untrained.length === 1 ? "" : "s"} not yet trained</b> on the adopted policy: {untrained.join(", ")}. <Link href="/training">Open training →</Link></div>
      ) : null}
      {moved && moved.length > 0 && (
        <details className="alert stale"><summary>What moved since the tool list was published ({moved.length})</summary>
          <ul>{moved.map((m, i) => (
            <li key={i}>{m.kind === "field"
              ? <>{m.toolName} — {m.field}: {m.before} → {m.after}</>
              : <>{m.toolName} — {m.kind === "added" ? "added since the list was published" : "removed since the list was published"}</>}</li>
          ))}</ul>
        </details>
      )}
    </Shell>
  );
}
