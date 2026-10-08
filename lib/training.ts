// Training packet is generated ONLY from the adopted snapshot — never from the
// live inventory. Templated text only; the model is not involved.
import { esc } from "./escape";

export type SnapshotTool = {
  rawName: string; aiStatus: string; agreementStatus: string; decision: string; notes: string;
  category?: string;
  // Resolved grade bands pinned at adopt (spec 4.5). Absent on older snapshots.
  integrityK5?: string | null;
  integrity68?: string | null;
  integrity912?: string | null;
};

export function agreementPill(status: string): string {
  const key = status.replace(/[^a-z_]/gi, "").toLowerCase();
  const cls = ["signed", "refused", "expired", "not_requested"].includes(key) ? key : "not_requested";
  const words: Record<string, string> = {
    signed: "Signed", refused: "Refused", expired: "Expired", not_requested: "Not requested",
  };
  return `<span class="ag ag-${cls}">${esc(words[cls])}</span>`;
}

export function buildTrainingPacket(opts: {
  districtName: string;
  adoptedOn: string;
  adoptedBy: string;
  stale: boolean;
  tools: SnapshotTool[];
}): { principalScript: string; teacherCard: string } {
  const { districtName, adoptedOn, adoptedBy, stale, tools } = opts;
  const banner = stale
    ? `<div class="alert stale"><b>This packet is behind the inventory.</b> It reflects the adopted snapshot of ${esc(adoptedOn)}, not later edits. Re-adopt to refresh training.</div>`
    : "";
  const bandText = (t: SnapshotTool): string => {
    if (t.integrityK5 === undefined && t.integrity68 === undefined && t.integrity912 === undefined) return "";
    const w = (v: string | null | undefined) => esc(v ?? "to be decided");
    return ` — bands K–5 ${w(t.integrityK5)} · 6–8 ${w(t.integrity68)} · 9–12 ${w(t.integrity912)}`;
  };
  const rows = (list: SnapshotTool[]) =>
    list.length
      ? "<ul class=\"tidy\">" + list.map((t) => `<li><b>${esc(t.rawName)}</b><span>${agreementPill(t.agreementStatus)}${t.notes ? " — " + esc(t.notes) : ""}${bandText(t)}</span></li>`).join("") + "</ul>"
      : `<p class="hint">None.</p>`;
  const by = (d: string) => tools.filter((t) => t.decision === d);
  const step = (time: string, title: string, body: string) =>
    `<li><span class="step-time">${esc(time)}</span><div><b>${esc(title)}</b><p>${body}</p></div></li>`;
  const principalScript =
    banner +
    `<h2>15-minute principal script</h2>` +
    `<p class="hint">From the adopted snapshot of ${esc(adoptedOn)} · adopted by ${esc(adoptedBy)}. Read aloud, one step at a time.</p>` +
    `<ol class="steps">` +
    step("0–3", "The rule.", `${esc(districtName)} allows only Exhibit-listed tools for student work. Anything on hold or unlisted is not permitted until it clears review.`) +
    step("3–7", "Walk the list.", `Approved: ${esc(by("approved").map((t) => t.rawName).join(", ") || "none")}. Limited: ${esc(by("limited").map((t) => t.rawName).join(", ") || "none")}. Off limits: ${esc([...by("banned"), ...by("hold")].map((t) => t.rawName).join(", ") || "none")}.`) +
    step("7–11", "Data.", `Never enter student or staff personal information into an AI tool except through approved tools with a signed agreement. Opt-out students get an equivalent non-AI alternative.`) +
    step("11–15", "Sign.", `Every staff member signs name plus date below. Questions go to the council chair, not to the model.`) +
    `</ol>`;
  const group = (title: string, list: SnapshotTool[]) =>
    `<h3>${esc(title)} (${list.length})</h3>${rows(list)}`;
  const teacherCard =
    `<h2>One-page teacher card</h2>` +
    `<p class="hint">Keep this where you plan lessons. If a tool is not Approved or Limited below, do not use it with students.</p>` +
    group("APPROVED", by("approved")) +
    group("LIMITED", by("limited")) +
    group("BANNED / HOLD — do not use with students", [...by("banned"), ...by("hold")]);
  return { principalScript, teacherCard };
}
