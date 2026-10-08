import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canWrite, isOwner } from "@/lib/tenancy";
import { assemble } from "@/lib/assembler";
import { boardLock } from "@/lib/seats";
import { citationQueueReasons, mergedExhibit } from "@/lib/rubric";
import { addComment, citeFinding, resolveComment, promoteProposal, signSeat, overrideSeat } from "@/app/actions/policy";

export default async function ReviewPage() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId);
  const byTitle = Object.fromEntries(out.sections.map((s) => [s.title, s.html]));
  const tools = await prisma.districtTool.findMany({ where: { districtId: user.districtId }, include: { catalogTool: true }, orderBy: { rawName: "asc" } });
  const clauses = await prisma.clause.findMany({ orderBy: [{ id: "asc" }, { version: "desc" }] });
  const clauseIds = [...new Map(clauses.map((c) => [c.id, c])).values()];
  const comments = await prisma.comment.findMany({ where: { districtId: user.districtId }, orderBy: { createdAt: "desc" } });
  const seats = await prisma.reviewSeat.findMany({ where: { districtId: user.districtId }, orderBy: { seat: "asc" } });
  const lock = await boardLock(prisma, user.districtId);
  const writable = canWrite(user);
  const openRequests = await prisma.districtTool.findMany({
    where: { districtId: user.districtId, source: "request", decision: "hold" },
    include: { requests: { orderBy: { createdAt: "asc" } } },
    orderBy: { rawName: "asc" },
  });

  async function comment(form: FormData) {
    "use server";
    await addComment({
      targetType: String(form.get("targetType") || "clause"),
      targetId: String(form.get("targetId") || ""),
      kind: String(form.get("kind") || "accept"),
      note: String(form.get("note") || ""),
      proposal: String(form.get("proposal") || ""),
    });
  }
  async function resolve(form: FormData) {
    "use server";
    await resolveComment(String(form.get("id")), String(form.get("status")) === "accepted" ? "accepted" : "rejected");
  }
  async function promote(form: FormData) {
    "use server";
    await promoteProposal(String(form.get("id")));
  }
  async function sign(form: FormData) {
    "use server";
    await signSeat(String(form.get("seat")));
  }
  async function override(form: FormData) {
    "use server";
    await overrideSeat(String(form.get("seat")), String(form.get("reason") || ""));
  }

  // Citation queue: in-use tools whose merged exhibit is missing usedForTraining
  // or whose signed agreement is silent on training. District-scoped by the query above.
  const queue = tools
    .filter((t) => t.inUse)
    .map((t) => ({
      tool: t,
      reasons: citationQueueReasons(
        mergedExhibit(t.catalogTool ?? null, (t.exhibitOverride ?? {}) as Record<string, unknown>),
        t.agreementStatus
      ),
    }))
    .filter((q) => q.reasons.length > 0);

  async function cite(form: FormData) {
    "use server";
    await citeFinding({
      toolId: String(form.get("toolId") || ""),
      usedForTraining: String(form.get("usedForTraining") || ""),
      trainingAddressed: String(form.get("trainingAddressed") || ""),
      citationUrl: String(form.get("citationUrl") || ""),
      citationDate: String(form.get("citationDate") || ""),
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  const packet = (title: string, html?: string) =>
    html === undefined ? null : (<section><h2>{title}</h2><div dangerouslySetInnerHTML={{ __html: html }} /></section>);

  return (
    <Shell user={user} title="Review packets">
      {lock.locked
        ? <div className="alert error"><b>Board packet locked.</b> {lock.reason}</div>
        : <div className="alert"><b>Board packet unlocked.</b> Required seats signed or overridden.</div>}

      <h2 id="requests">Open staff requests ({openRequests.length})</h2>
      {openRequests.length ? (
        <table className="sans"><tr><th>Tool</th><th>Asked by</th><th>Building</th><th>Students?</th><th>Note</th></tr>
          {openRequests.flatMap((t) => t.requests.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/tools/${t.id}`}>{t.rawName}</Link></td>
              <td>{r.requesterName || r.requesterEmail}{t.requests.length > 1 ? ` (+${t.requests.length - 1} more)` : ""}</td>
              <td>{r.building || "—"}</td>
              <td>{r.intendedUse === "with_students" ? "Students would use it" : "Staff only"}</td>
              <td>{r.note || "—"}</td>
            </tr>
          )))}
        </table>
      ) : <p className="hint sans">No open requests. Staff can ask from Inventory or the request link.</p>}

      <h2 id="citation-queue">Citation queue ({queue.length})</h2>
      <p className="hint sans">In-use tools whose merged exhibit blocks a verdict: training use unknown, or a signed agreement silent on training. Citing records the finding plus its source on the district override — never in notes.</p>
      {queue.length ? (
        <table className="sans"><tr><th>Tool</th><th>Missing fact</th><th className="no-print">Cite</th></tr>
          {queue.map(({ tool: t, reasons }) => (
            <tr key={t.id}>
              <td><Link href={`/tools/${t.id}`}>{t.rawName}</Link></td>
              <td>{reasons.join("; ")}</td>
              <td className="no-print">
                {writable ? (
                  <form action={cite}>
                    <input type="hidden" name="toolId" value={t.id} />
                    {reasons.includes("Training use unknown") && (
                      <label>Training use <select name="usedForTraining" defaultValue="">
                        <option value="">—</option><option value="false">Not used for training</option><option value="true">Used for training</option>
                      </select></label>
                    )}
                    {reasons.includes("Agreement silent on training") && (
                      <label>Agreement addresses training <select name="trainingAddressed" defaultValue="">
                        <option value="">—</option><option value="true">Yes, addressed</option><option value="false">No, silent</option>
                      </select></label>
                    )}
                    <label>Source URL <input type="text" name="citationUrl" placeholder="https://…" style={{ width: 220 }} /></label>
                    <label>Date <input type="date" name="citationDate" defaultValue={today} /></label>
                    <button className="btn secondary" type="submit">Cite</button>
                  </form>
                ) : <span className="hint">Read-only role.</span>}
              </td>
            </tr>
          ))}
        </table>
      ) : <p className="hint sans">All clear — every in-use tool has its training facts cited.</p>}

      <h2>Your packet ({user.role})</h2>
      {(user.role === "owner") && packet("Technology — tool table and no-training rule", (byTitle["Approved, limited, and prohibited tools"] || "") + (byTitle["Data and privacy"] || ""))}
      {user.role === "curriculum" && packet("Curriculum — academic integrity and grade-band rules", byTitle["Academic integrity by grade band"])}
      {user.role === "sped" && packet("Special education — data section", byTitle["Data and privacy"])}
      {user.role === "viewer" && (
        <section><h2>One-page decision log</h2>
          <table className="sans"><tr><th>Tool</th><th>Decision</th><th>Agreement</th><th>Decided by</th></tr>
            {tools.map((t) => <tr key={t.id}><td>{t.rawName}</td><td>{t.decision.toUpperCase()}</td><td>{t.agreementStatus.replace(/_/g, " ")}</td><td>{t.decidedBy ?? "—"}</td></tr>)}
          </table>
        </section>
      )}

      <h2>Review seats</h2>
      <table className="sans"><tr><th>Seat</th><th>Required</th><th>Status</th><th className="no-print">Act</th></tr>
        {seats.map((s) => (
          <tr key={s.seat}>
            <td>{s.seat}</td><td>{s.required ? "Yes" : "Optional"}</td>
            <td>{s.signedAt ? `Signed ${s.signedAt.toISOString().slice(0, 10)} by ${s.signedBy}` : s.overrideReason ? `Override: ${s.overrideReason}` : "Pending"}</td>
            <td className="no-print">
              {writable && (
                <form action={sign} style={{ display: "inline" }}>
                  <input type="hidden" name="seat" value={s.seat} />
                  <button className="btn secondary" type="submit">Sign</button>
                </form>
              )}
              {isOwner(user) && (
                <form action={override} style={{ display: "inline" }}>
                  <input type="hidden" name="seat" value={s.seat} />
                  <input type="text" name="reason" placeholder="Override reason (required)" style={{ width: 220, display: "inline" }} />
                  <button className="btn secondary" type="submit">Override</button>
                </form>
              )}
            </td>
          </tr>
        ))}
      </table>

      <h2>Comments ({comments.length})</h2>
      <p className="hint sans">Bound to a clause or a tool row. Accept, reject, or propose. A free note never changes adopted text — only owner promotion of a proposal creates a clause version.</p>
      {writable && (
        <form action={comment} className="sans no-print">
          <label>Target type <select name="targetType"><option value="clause">clause</option><option value="tool">tool</option></select></label>
          <label>Target <select name="targetId">
            <optgroup label="Clauses">{clauseIds.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.title}</option>)}</optgroup>
            <optgroup label="Tools">{tools.map((t) => <option key={t.id} value={t.id}>{t.rawName}</option>)}</optgroup>
          </select></label>
          <label>Kind <select name="kind"><option value="accept">accept</option><option value="reject">reject</option><option value="propose">propose replacement</option></select></label>
          <label>Note <textarea name="note" rows={2} /></label>
          <label>Proposed replacement (only for propose) <textarea name="proposal" rows={2} /></label>
          <button className="btn" type="submit">Add comment</button>
        </form>
      )}
      {comments.length ? (
        <table className="sans"><tr><th>On</th><th>Kind</th><th>Note</th><th>By</th><th>Status</th><th className="no-print">Resolve</th></tr>
          {comments.map((c) => (
            <tr key={c.id}>
              <td>{c.targetType}:{c.targetType === "tool" ? tools.find((t) => t.id === c.targetId)?.rawName ?? c.targetId : c.targetId}</td>
              <td>{c.kind}</td><td>{c.note}{c.proposal ? <><br /><i>Proposal: {c.proposal}</i></> : null}</td>
              <td>{c.author}</td><td>{c.status}</td>
              <td className="no-print">
                {writable && c.status === "open" && (
                  <>
                    <form action={resolve} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="accepted" />
                      <button className="btn secondary" type="submit">Accept</button>
                    </form>
                    <form action={resolve} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="rejected" />
                      <button className="btn secondary" type="submit">Reject</button>
                    </form>
                    {isOwner(user) && c.kind === "propose" && c.proposal && (
                      <form action={promote} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn" type="submit">Promote to clause library</button>
                      </form>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </table>
      ) : <p className="hint sans">No comments yet.</p>}
    </Shell>
  );
}
