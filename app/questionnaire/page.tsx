import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canWrite } from "@/lib/tenancy";
import { saveAnswers } from "@/app/actions/policy";
import type { Answers } from "@/lib/assembler";

function sel(name: string, opts: Array<[string, string]>, cur?: string) {
  return (
    <select name={name} defaultValue={cur ?? ""}>
      <option value="">— decide —</option>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export default async function QuestionnairePage() {
  const user = await requireUser();
  const row = await prisma.questionnaireAnswer.findUnique({ where: { districtId: user.districtId } });
  const a = (row?.answers ?? {}) as Answers;
  const seats = await prisma.reviewSeat.findMany({ where: { districtId: user.districtId }, orderBy: { seat: "asc" } });
  const writable = canWrite(user);

  async function save(form: FormData) {
    "use server";
    const get = (k: string) => { const v = String(form.get(k) || ""); return v === "" ? undefined : v; };
    await saveAnswers({
      stance: get("stance"), whoMayUse: get("whoMayUse"),
      integrityK5: get("integrityK5"), integrity68: get("integrity68"), integrity912: get("integrity912"),
      dataRule: get("dataRule"), noTrainingRule: get("noTrainingRule"),
      noSoleDecision: form.get("noSoleDecision") === "on",
      disclosure: get("disclosure"), ownerName: get("ownerName"), reviewCadence: get("reviewCadence"),
      rupName: get("rupName"), amendmentChoice: get("amendmentChoice"),
      nothingApproved: form.get("nothingApproved") === "on",
      toolApprovalClause: get("toolApprovalClause"), disciplineClause: get("disciplineClause"),
      privacyClause: get("privacyClause"), staffUseClause: get("staffUseClause"), rolesClause: get("rolesClause"),
    });
  }

  const bands: Array<[string, string]> = [["red", "Red — not permitted"], ["yellow", "Yellow — teacher-guided only"], ["green", "Green — permitted with citation"]];
  const form = (
    <form action={save} className="sans no-print">
      <div className="card">
        <label>Stance {sel("stance", [["no_ai", "No AI in classrooms"], ["guided_use", "Guided use"], ["active_adoption", "Active adoption"]], a.stance)}</label>
        <label>Who may use AI {sel("whoMayUse", [["staff_only", "Staff only"], ["staff_and_students", "Staff and students"], ["grade_banded", "By grade band"]], a.whoMayUse)}</label>
      </div>
      <div className="card">
        <label>Academic integrity K–5 (required) {sel("integrityK5", bands, a.integrityK5)}</label>
        <label>Academic integrity 6–8 (required) {sel("integrity68", bands, a.integrity68)}</label>
        <label>Academic integrity 9–12 (required) {sel("integrity912", bands, a.integrity912)}</label>
      </div>
      <div className="card">
        <label>Data rule (required) {sel("dataRule", [["no_student_pii", "No student/staff personal information in AI tools"], ["deidentified_only", "De-identified only"], ["consent_required", "Parent notice/consent required"]], a.dataRule)}</label>
        <label>No-training rule {sel("noTrainingRule", [["require_addendum", "Require no-training addendum"], ["prefer_addendum", "Prefer vendors that sign"], ["case_by_case", "Case by case"]], a.noTrainingRule)}</label>
        <label><input type="checkbox" name="noSoleDecision" defaultChecked={a.noSoleDecision} style={{ width: "auto" }} /> No sole automated decision for discipline or placement</label>
        <label>Disclosure {sel("disclosure", [["required", "AI assistance must be disclosed"], ["on_request", "Disclose on request"], ["silent", "No disclosure rule"]], a.disclosure)}</label>
      </div>
      <div className="card">
        <label>Tool-approval clause {sel("toolApprovalClause", [["allowlist", "Allowlist only"], ["tiered", "Tiered approval with pilot"]], a.toolApprovalClause)}</label>
        <label>Discipline clause {sel("disciplineClause", [["educational", "Educational response first"], ["code-aligned", "Code-aligned progressive discipline"]], a.disciplineClause)}</label>
        <label>Privacy clause {sel("privacyClause", [["minimization", "Data minimization, no-training vendors"], ["consent-gated", "Consent-gated use"]], a.privacyClause)}</label>
        <label>Staff-use clause {sel("staffUseClause", [["guardrails", "Professional-use guardrails"], ["transparency", "Transparency and disclosure"]], a.staffUseClause)}</label>
        <label>Roles-and-review clause {sel("rolesClause", [["annual", "Annual review"], ["semiannual", "Semiannual review with incident log"]], a.rolesClause)}</label>
      </div>
      <div className="card">
        <label>Amendment or separate policy? {sel("amendmentChoice", [["amend_existing", "Amend existing RUP (a separate AI policy is optional)"], ["separate_aup", "Adopt a separate AI acceptable-use policy"]], a.amendmentChoice)}</label>
        <label>Existing RUP name <input type="text" name="rupName" defaultValue={a.rupName || ""} maxLength={120} /></label>
        <label>Named owner <input type="text" name="ownerName" defaultValue={a.ownerName || ""} maxLength={120} placeholder="e.g. Technology Director" /></label>
        <label>Review cadence {sel("reviewCadence", [["annual", "Annual"], ["semiannual", "Semiannual"], ["quarterly", "Quarterly"]], a.reviewCadence)}</label>
      </div>
      <div className="card">
        <label><input type="checkbox" name="nothingApproved" defaultChecked={a.nothingApproved} style={{ width: "auto" }} /> Nothing approved yet — the district approves no AI tool for student use at this time.</label>
      </div>
      <button className="btn" type="submit">Save answers</button>
    </form>
  );

  return (
    <Shell user={user} title="Questionnaire">
      <p className="sans">District decisions, not prose. Discipline, privacy, tool-approval, and staff-use sections are clause selections — free text never enters adopted text.</p>
      {writable ? form : <div className="alert">Your role is read-only.</div>}
      <h2>Review seats</h2>
      <table className="sans"><tr><th>Seat</th><th>Required</th><th>Signed</th><th>Override reason</th></tr>
        {seats.map((s) => <tr key={s.seat}><td>{s.seat}</td><td>{s.required ? "Yes" : "No (optional)"}</td><td>{s.signedAt ? `${s.signedAt.toISOString().slice(0, 10)} by ${s.signedBy}` : "—"}</td><td>{s.overrideReason ?? "—"}</td></tr>)}
      </table>
      <p className="hint sans">Required: technology, teaching and learning, special education. Optional: association, cabinet. Sign from the <a href="/review">review page</a>.</p>
    </Shell>
  );
}
