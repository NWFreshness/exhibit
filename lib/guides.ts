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
  const bands = `K–5: ${answers.integrityK5 ? BAND_WORDS[answers.integrityK5] : "to be decided"}; ` +
    `6–8: ${answers.integrity68 ? BAND_WORDS[answers.integrity68] : "to be decided"}; ` +
    `9–12: ${answers.integrity912 ? BAND_WORDS[answers.integrity912] : "to be decided"}.`;
  return usable.map((t) => {
    const limits = t.notes && t.notes.trim() !== "" ? t.notes : "No extra limits recorded — follow the rules below.";
    const row = (k: string, v: string) => `<div class="guide-row"><span>${esc(k)}</span><span>${v}</span></div>`;
    const html =
      `<details class="guide" open>` +
      `<summary><b>${esc(t.rawName)}</b> <span class="status">${esc(t.decision.toUpperCase())}</span></summary>` +
      `<div class="guide-body">` +
      row("Filed under", `${esc(t.category || "General")} · ${agreementPill(t.agreementStatus)}`) +
      row("How we allow it", esc(limits)) +
      row("Who may use it", esc(bands)) +
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
