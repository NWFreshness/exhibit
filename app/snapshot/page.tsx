import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isOwner } from "@/lib/tenancy";
import { toolListFor } from "@/lib/policy";
import { recordBoardAdoption } from "@/app/actions/policy";

export default async function SnapshotPage() {
  const user = await requireUser();
  const snaps = await prisma.adoptedSnapshot.findMany({ where: { districtId: user.districtId }, orderBy: { adoptedAt: "desc" } });
  const snap = snaps[0];
  if (!snap) {
    return <Shell user={user} title="Approved policy"><div className="alert">Nothing approved yet. <Link href="/draft">Open the working draft</Link>.</div></Shell>;
  }
  const refs = snap.clauseRefs as Array<{ clauseId: string; version: number }>;
  const toolList = await toolListFor(prisma, snap);
  const table = (toolList.toolTable ?? []) as unknown[];
  const versions = await prisma.toolListVersion.count({ where: { snapshotId: snap.id } });
  const snapId = snap.id;

  async function board(form: FormData) {
    "use server";
    await recordBoardAdoption(snapId, String(form.get("date") || ""), String(form.get("resolution") || ""));
  }

  return (
    <Shell user={user} title="Approved policy">
      <p className="sans">Approved by the council {snap.adoptedAt.toISOString().slice(0, 16).replace("T", " ")}, recorded by <b>{snap.adoptedBy}</b>. The policy text below is frozen — later edits do not change this page. {snaps.length > 1 && <>(Showing latest of {snaps.length}.)</>}</p>
      {snap.boardAdoptedOn ? (
        <div className="alert"><b>Adopted by the board on {snap.boardAdoptedOn.toISOString().slice(0, 10)}</b>{snap.boardResolution ? <> · resolution {snap.boardResolution}</> : null}. This policy is in force: the public list and the training packet read from it.</div>
      ) : (
        <div className="alert stale">
          <b>Waiting for the board.</b> The council approved this policy, but it is not in force, public, or trained on until the board adopts it.
          {isOwner(user) ? (
            <form action={board} className="sans no-print">
              <label>Board meeting date <input type="date" name="date" required /></label>
              <label>Resolution number (optional) <input type="text" name="resolution" maxLength={120} /></label>
              <button className="btn" type="submit">Record board adoption</button>
            </form>
          ) : <> The owner records the board meeting date here.</>}
        </div>
      )}
      <p className="sans">Clause refs: {refs.map((r) => `${r.clauseId}@v${r.version}`).join(", ")} · Export: {snap.exportKey ? <code>{snap.exportKey}</code> : "—"}</p>
      <p className="sans">Tool list: {table.length} tools, published {toolList.publishedAt.toISOString().slice(0, 10)} by {toolList.publishedBy}{versions > 1 ? ` (version ${versions} under this policy)` : ""}. Publish a newer list from the <Link href="/draft">draft page</Link> without re-adopting the policy.</p>
      <div className="card"><div dangerouslySetInnerHTML={{ __html: snap.html }} /></div>
    </Shell>
  );
}
