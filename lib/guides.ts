// Per-tool teacher guides. Templated from adopted data only — the model is
// never involved. Covers approved + limited in-use tools; banned/hold tools
// get no guide because there is nothing to train on except "don't use it".
import { esc } from "./escape";
import { agreementPill, type SnapshotTool } from "./training";
import type { Answers } from "./assembler";

export type { SnapshotTool as GuideTool };

const BAND_WORDS: Record<string, string> = {
  red: "not permitted for student use",
  yellow: "teacher-guided classroom use only",
  green: "permitted with citation and teacher review",
};

export type ToolGuide = { toolName: string; decision: string; html: string };

export function buildToolGuides(
  tools: SnapshotTool[],
  answers: Answers,
  districtName: string,
  ownerName: string
): ToolGuide[] {
  const usable = tools.filter((t) => t.decision === "approved" || t.decision === "limited");
  // Per-tool resolved bands (spec 4.5, Q5): the pinned row band wins when the
  // snapshot recorded it, otherwise the district answers. Rows from older
  // snapshots carry no band keys and say so explicitly.
  const bandWords = (v: string | null | undefined) =>
    v && BAND_WORDS[v] ? BAND_WORDS[v] : "to be decided";
  const hasBandKeys = (t: SnapshotTool) =>
    t.integrityK5 !== undefined || t.integrity68 !== undefined || t.integrity912 !== undefined;
  const toolBands = (t: SnapshotTool) =>
    `K–5: ${bandWords(t.integrityK5 ?? answers.integrityK5)}; ` +
    `6–8: ${bandWords(t.integrity68 ?? answers.integrity68)}; ` +
    `9–12: ${bandWords(t.integrity912 ?? answers.integrity912)}.`;
  return usable.map((t) => {
    const limits = t.notes && t.notes.trim() !== "" ? t.notes : "No extra limits recorded — follow the rules below.";
    const row = (k: string, v: string) => `<div class="guide-row"><span>${esc(k)}</span><span>${v}</span></div>`;
    const legacy = hasBandKeys(t) ? "" : row(
      "Grade bands",
      "District bands from this snapshot's pinned answers — per-tool bands were not recorded at adoption."
    );
    const html =
      `<details class="guide" open>` +
      `<summary><b>${esc(t.rawName)}</b> <span class="status">${esc(t.decision.toUpperCase())}</span></summary>` +
      `<div class="guide-body">` +
      row("Filed under", `${esc(t.category || "General")} · ${agreementPill(t.agreementStatus)}`) +
      row("How we allow it", esc(limits)) +
      row("Who may use it", esc(toolBands(t))) +
      legacy +
      row("Data rules", `${esc(answers.dataRule || "to be decided")} · no-training: ${esc(answers.noTrainingRule || "to be decided")} · disclosure: ${esc(answers.disclosure || "to be decided")}`) +
      `</div><ul class="tidy">` +
      `<li><b>Check output</b><span>Review AI output for accuracy before using it with students.</span></li>` +
      `<li><b>Personal info</b><span>Never enter student or staff personal information except through this approved listing.</span></li>` +
      `<li><b>Decisions stay human</b><span>No automated system alone determines discipline or placement.</span></li>` +
      `<li><b>Stuck?</b><span>Ask ${esc(ownerName)} — not the tool vendor.</span></li>` +
      `</ul></details>`;
    return { toolName: t.rawName, decision: t.decision, html };
  });
}
