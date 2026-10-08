import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export default async function SnapshotPage() {
  const user = await requireUser();
  const snaps = await prisma.adoptedSnapshot.findMany({ where: { districtId: user.districtId }, orderBy: { adoptedAt: "desc" } });
  const snap = snaps[0];
  if (!snap) {
    return <Shell user={user} title="Adopted snapshot"><div className="alert">No adopted snapshot yet. <Link href="/draft">Open the working draft</Link>.</div></Shell>;
  }
  const refs = snap.clauseRefs as Array<{ clauseId: string; version: number }>;
  const table = snap.toolTable as Array<{ rawName: string; decision: string }>;
  return (
    <Shell user={user} title="Adopted snapshot">
      <p className="sans">Adopted {snap.adoptedAt.toISOString().slice(0, 16).replace("T", " ")} by <b>{snap.adoptedBy}</b>. Immutable — later inventory edits do not change this page. {snaps.length > 1 && <>(Showing latest of {snaps.length}.)</>}</p>
      <p className="sans">Clause refs: {refs.map((r) => `${r.clauseId}@v${r.version}`).join(", ")} · Tool-table hash: <code>{snap.toolHash.slice(0, 16)}…</code> · Tools: {table.length} · Export: {snap.exportKey ? <code>{snap.exportKey}</code> : "—"}</p>
      <div className="card"><div dangerouslySetInnerHTML={{ __html: snap.html }} /></div>
    </Shell>
  );
}
