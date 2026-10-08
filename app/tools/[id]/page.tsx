import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canWrite } from "@/lib/tenancy";
import { evaluateRubric, mergedExhibit, overrideKeys, type AiStatus, type AgreementStatus } from "@/lib/rubric";
import { updateTool, uploadAgreement, recordAlliancePointer } from "@/app/actions/tools";

function V({ v, district }: { v: string | boolean | null | undefined; district?: boolean }) {
  const body = v === null || v === undefined || v === "" ? <span className="unknown">Unknown</span>
    : typeof v === "boolean" ? <>{v ? "Yes" : "No"}</> : <>{v}</>;
  return <>{body}{district && v !== null && v !== undefined && v !== "" ? <> <span className="status">Our finding</span></> : null}</>;
}

export default async function ToolPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const tool = await prisma.districtTool.findFirst({
    where: { id, districtId: user.districtId },
    include: { catalogTool: true, events: { orderBy: { createdAt: "desc" }, take: 10 }, agreements: { orderBy: { createdAt: "desc" } }, requests: { orderBy: { createdAt: "asc" } }, comments: { orderBy: { createdAt: "desc" } } },
  });
  if (!tool) notFound();
  const t = tool as NonNullable<typeof tool>;
  const over = (t.exhibitOverride ?? {}) as Record<string, unknown>;
  const set = overrideKeys(over);
  const merged = mergedExhibit(t.catalogTool ? {
    callsGenModel: t.catalogTool.callsGenModel,
    whoseModel: t.catalogTool.whoseModel,
    studentSent: t.catalogTool.studentSent,
    usedForTraining: t.catalogTool.usedForTraining,
    retention: t.catalogTool.retention,
    optOut: t.catalogTool.optOut,
    subprocessors: t.catalogTool.subprocessors,
    willSignAddendum: t.catalogTool.willSignAddendum,
  } : null, over);
  const rubric = evaluateRubric({
    aiStatus: t.aiStatus as AiStatus,
    agreementStatus: t.agreementStatus as AgreementStatus,
    usedForTraining: merged.usedForTraining,
    agreementAddressesTraining: merged.agreementAddressesTraining,
  });
  const writable = canWrite(user);

  async function save(form: FormData) {
    "use server";
    const ov: Record<string, string> = {};
    for (const k of ["callsGenModel", "studentSent", "usedForTraining", "trainingAddressed", "whoseModel", "retention", "optOut", "subprocessors", "willSignAddendum"]) {
      ov[k] = String(form.get(`ov_${k}`) ?? (k === "trainingAddressed" ? "unknown" : ""));
      if (["callsGenModel", "studentSent", "usedForTraining", "trainingAddressed"].includes(k) && ov[k] === "") ov[k] = "unknown";
    }
    await updateTool(t.id, {
      agreementStatus: String(form.get("agreementStatus") || t.agreementStatus),
      decision: String(form.get("decision") || t.decision),
      aiStatus: String(form.get("aiStatus") || t.aiStatus),
      inUse: form.get("inUse") === "on",
      notes: String(form.get("notes") || ""),
      override: ov,
      agreementEndsOn: String(form.get("agreementEndsOn") || ""),
      renewalOwnerUserId: String(form.get("renewalOwnerUserId") || ""),
      vendorContact: String(form.get("vendorContact") || ""),
    });
  }
  async function upload(form: FormData) {
    "use server";
    await uploadAgreement(t.id, form);
  }
  async function pointer(form: FormData) {
    "use server";
    await recordAlliancePointer({
      toolId: t.id,
      registryUrl: String(form.get("registry_url") || ""),
      registryId: String(form.get("registry_id") || ""),
      originator: String(form.get("originator") || ""),
      status: String(form.get("status") || "signed"),
      expiresOn: String(form.get("expires_on") || ""),
    });
  }

  const tri = (name: string, cur: boolean | null) => (
    <select name={`ov_${name}`} defaultValue={cur === null ? "unknown" : cur ? "true" : "false"}>
      <option value="unknown">Unknown — use catalog</option>
      <option value="true">Yes — our finding</option>
      <option value="false">No — our finding</option>
    </select>
  );
  const txt = (name: string, cur: unknown) => (
    <input type="text" name={`ov_${name}`} defaultValue={typeof cur === "string" ? cur : ""} placeholder="Leave blank to use catalog" maxLength={500} />
  );
  const cat = t.catalogTool;
  const members = await prisma.user.findMany({ where: { districtId: user.districtId }, orderBy: { email: "asc" }, select: { id: true, email: true, role: true } });
  const renewalOwner = members.find((m) => m.id === t.renewalOwnerUserId);

  return (
    <Shell user={user} title={t.rawName}>
      <p className="sans"><Link href="/inventory">← Inventory</Link> · <span className="status">{t.decision.toUpperCase()}</span> · agreement: <b>{t.agreementStatus.replace(/_/g, " ")}</b> · AI status: <b>{t.aiStatus.replace(/_/g, " ")}</b> · {t.inUse ? "in use" : "not in use"} · from: <b>{t.source === "request" ? "staff request" : t.source}</b></p>

      <h2>AI exhibit {cat ? `(catalog: ${cat.name})` : "(district-only tool)"}</h2>
      <div className="exhibit-grid sans">
        <div>Calls a generative model</div><div><V v={merged.callsGenModel} district={set.has("callsGenModel")} /></div>
        <div>Whose model</div><div><V v={merged.whoseModel} district={set.has("whoseModel")} /></div>
        <div>Student content sent</div><div><V v={merged.studentSent} district={set.has("studentSent")} /></div>
        <div>Student content used for training</div><div><V v={merged.usedForTraining} district={set.has("usedForTraining")} /></div>
        <div>Agreement addresses training</div><div>{merged.agreementAddressesTraining !== null ? <><b>{merged.agreementAddressesTraining ? "Yes" : "No"}</b> <span className="status">Our finding</span></> : <span className="unknown">Unknown</span>}</div>
        <div>Retention</div><div><V v={merged.retention} district={set.has("retention")} /></div>
        <div>Opt-out</div><div><V v={merged.optOut} district={set.has("optOut")} /></div>
        <div>Subprocessors</div><div><V v={merged.subprocessors} district={set.has("subprocessors")} /></div>
        <div>Will sign no-training addendum</div><div><V v={merged.willSignAddendum} district={set.has("willSignAddendum")} /></div>
        <div>Source</div><div>{cat?.sourceUrl ? <a href={cat.sourceUrl}>vendor page</a> : <span className="unknown">Unknown</span>}</div>
      </div>
      <p className="hint sans">Unknown is a valid state. Catalog rows are read-only; anything marked <b>Our finding</b> is this district&apos;s own record and wins over the catalog.</p>

      <h2>Rubric</h2>
      <div className="rubric sans">
        No agreement, or agreement silent on training: <b>Hold</b> · training use: <b>Limited or Banned, never Approved</b> · expired: <b>Hold</b> · unknown training: <b>Hold</b> · no model: <b>out of scope</b>.
        <ul>{rubric.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
        <b>Rubric result: {rubric.label}</b>
      </div>

      {writable ? (
        <>
          <h2>Update (recorded with your name and time)</h2>
          <form action={save} className="sans no-print">
            <label>AI status <select name="aiStatus" defaultValue={t.aiStatus}>
              <option value="calls_model">Calls a model</option>
              <option value="no_model">No model</option>
              <option value="unknown">Unknown</option>
            </select></label>
            <label>In use <input type="checkbox" name="inUse" defaultChecked={t.inUse} style={{ width: "auto" }} /></label>
            <label>Agreement status <select name="agreementStatus" defaultValue={t.agreementStatus}>
              <option value="signed">signed</option><option value="expired">expired</option>
              <option value="refused">refused</option><option value="not_requested">not requested</option>
            </select></label>
            <label>Decision <select name="decision" defaultValue={t.decision}>
              <option value="approved">approved</option><option value="limited">limited</option>
              <option value="banned">banned</option><option value="hold">hold</option>
            </select></label>
            <label>District findings — these are your records, not vendor claims</label>
            <label>Calls a generative model {tri("callsGenModel", (over.callsGenModel as boolean) ?? null)}</label>
            <label>Whose model {txt("whoseModel", over.whoseModel)}</label>
            <label>Student content sent {tri("studentSent", (over.studentSent as boolean) ?? null)}</label>
            <label>Content used for training {tri("usedForTraining", (over.usedForTraining as boolean) ?? null)}</label>
            <label>Agreement addresses training {tri("trainingAddressed", (over.trainingAddressed as boolean) ?? null)}</label>
            <label>Retention {txt("retention", over.retention)}</label>
            <label>Opt-out {txt("optOut", over.optOut)}</label>
            <label>Subprocessors {txt("subprocessors", over.subprocessors)}</label>
            <label>Will sign no-training addendum {txt("willSignAddendum", over.willSignAddendum)}</label>
            <label>Local notes <textarea name="notes" rows={3} defaultValue={t.notes} /></label>
            <label>Agreement ends on <input type="text" name="agreementEndsOn" defaultValue={t.agreementEndsOn ? t.agreementEndsOn.toISOString().slice(0, 10) : ""} placeholder="YYYY-MM-DD (optional)" /></label>
            <label>Renewal owner <select name="renewalOwnerUserId" defaultValue={t.renewalOwnerUserId ?? ""}>
              <option value="">— none —</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.email} ({m.role})</option>)}
            </select></label>
            <label>Vendor contact for the DPA letter <input type="text" name="vendorContact" defaultValue={t.vendorContact} maxLength={200} placeholder="e.g. privacy@vendor.com" /></label>
            <button className="btn" type="submit">Save decision</button>
          </form>
          <p className="sans no-print"><a className="btn secondary" href={`/agreements/dpa/${t.id}`}>Download DPA request letter</a></p>
          <h2>Agreement upload (contracts only)</h2>
          <form action={upload} className="sans no-print">
            <label>File <input type="file" name="file" required /></label>
            <label>Status <select name="status"><option value="signed">signed</option><option value="expired">expired</option><option value="refused">refused</option></select></label>
            <label>Expires on <input type="text" name="expires_on" placeholder="YYYY-MM-DD (optional)" /></label>
            <button className="btn secondary" type="submit">Upload agreement</button>
          </form>
          <h2>Alliance pointer (no file — typed registry reference)</h2>
          <form action={pointer} className="sans no-print">
            <label>Registry URL <input type="text" name="registry_url" required placeholder="https://..." maxLength={2000} /></label>
            <label>Registry id <input type="text" name="registry_id" required maxLength={200} placeholder="e.g. SDPC-12345" /></label>
            <label>Originator <input type="text" name="originator" required maxLength={200} placeholder="e.g. WA SDPC alliance" /></label>
            <label>Status <select name="status"><option value="signed">signed</option><option value="expired">expired</option><option value="refused">refused</option></select></label>
            <label>Expires on <input type="text" name="expires_on" placeholder="YYYY-MM-DD (optional)" /></label>
            <button className="btn secondary" type="submit">Record pointer</button>
          </form>
          <p className="hint sans">No vendor sites are ever checked. The pointer is typed by the council, never fetched.</p>
        </>
      ) : <div className="alert">Your role is read-only.</div>}

      <h2>Requested by ({t.requests.length})</h2>
      {t.requests.length ? (
        <table className="sans"><tr><th>Name</th><th>Email</th><th>Building</th><th>Students?</th><th>Note</th><th>When</th></tr>
          {t.requests.map((r) => <tr key={r.id}><td>{r.requesterName || "—"}</td><td>{r.requesterEmail || "—"}</td><td>{r.building || "—"}</td><td>{r.intendedUse === "with_students" ? "Students would use it" : "Staff only"}</td><td>{r.note || "—"}</td><td>{r.createdAt.toISOString().slice(0, 10)}</td></tr>)}
        </table>
      ) : <p className="hint sans">No staff requests on this row.</p>}

      <h2>Agreements ({t.agreements.length})</h2>      {t.agreements.length ? (
        <table className="sans"><tr><th>When</th><th>Kind</th><th>Status</th><th>Expires</th><th>By</th><th>Agreement</th></tr>
          {t.agreements.map((a) => {
            const kind = (a as { kind?: string }).kind ?? "local_upload";
            const isPointer = kind === "alliance_pointer";
            const pa = a as { registryUrl?: string | null; registryId?: string | null; originator?: string | null };
            return (
              <tr key={a.id}>
                <td>{a.createdAt.toISOString().slice(0, 10)}</td>
                <td>{kind.replace(/_/g, " ")}</td>
                <td>{a.status}</td>
                <td>{a.expiresOn?.toISOString().slice(0, 10) ?? "—"}</td>
                <td>{a.uploadedBy}</td>
                <td>{isPointer ? (
                  <>{pa.registryUrl ? <a href={pa.registryUrl}>{pa.registryUrl}</a> : "—"}{pa.registryId ? <> · {pa.registryId}</> : null}{pa.originator ? <> · {pa.originator}</> : null}</>
                ) : <code>{a.blobKey}</code>}</td>
              </tr>
            );
          })}
        </table>
      ) : <p className="hint sans">No agreements on file.</p>}

      <h2>Audit</h2>
      <p className="sans">Decided by <b>{t.decidedBy ?? "—"}</b>{t.decidedAt ? ` on ${t.decidedAt.toISOString().slice(0, 16).replace("T", " ")}` : " (no decision recorded yet)"}.</p>
      {t.events.length ? (
        <table className="sans"><tr><th>When</th><th>Who</th><th>From</th><th>To</th></tr>
          {t.events.map((e) => <tr key={e.id}><td>{e.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td><td>{e.actor}</td><td>{e.fromStatus}</td><td>{e.toStatus}</td></tr>)}
        </table>
      ) : <p className="hint sans">No decision events yet.</p>}

      <h2>Comments on this tool ({t.comments.length})</h2>
      {t.comments.length ? (
        <table className="sans"><tr><th>Kind</th><th>Note</th><th>By</th><th>Status</th></tr>
          {t.comments.map((c) => <tr key={c.id}><td>{c.kind}</td><td>{c.note}{c.proposal ? <><br /><i>Proposal: {c.proposal}</i></> : null}</td><td>{c.author}</td><td>{c.status}</td></tr>)}
        </table>
      ) : <p className="hint sans">No comments. Add them from the <Link href="/review">review page</Link>.</p>}
    </Shell>
  );
}
