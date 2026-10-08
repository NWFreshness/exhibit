import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { writeRestricted } from "./llm";
import { esc } from "./escape";

export type Answers = {
  stance?: string;
  whoMayUse?: string;
  integrityK5?: "red" | "yellow" | "green";
  integrity68?: "red" | "yellow" | "green";
  integrity912?: "red" | "yellow" | "green";
  dataRule?: string;
  noTrainingRule?: string;
  noSoleDecision?: boolean;
  disclosure?: string;
  ownerName?: string;
  reviewCadence?: string;
  rupName?: string;
  amendmentChoice?: "amend_existing" | "separate_aup";
  nothingApproved?: boolean;
  toolApprovalClause?: string;
  disciplineClause?: string;
  privacyClause?: string;
  staffUseClause?: string;
  rolesClause?: string;
};

export type ClauseRef = { clauseId: string; version: number };
export type Section = { n: number; title: string; html: string; source: string };

export type Assembled = {
  sections: Section[];
  missing: string[];
  gate: string[];
  clauseRefs: ClauseRef[];
  toolHash: string;
  answersHash: string;
  html: string;
  inUseCount: number;
};

export async function familyLetter(db: PrismaClient, districtId: string): Promise<string> {
  const district = await db.district.findUniqueOrThrow({ where: { id: districtId } });
  const row = await db.questionnaireAnswer.findUnique({ where: { districtId } });
  const a = (row?.answers ?? {}) as Answers;
  const tools = await db.districtTool.findMany({ where: { districtId, inUse: true } });
  const text = await writeRestricted("family", {
    districtName: district.name,
    rupName: a.rupName || "the Responsible Use Policy",
    approved: tools.filter((t) => t.decision === "approved").map((t) => t.rawName),
    limited: tools.filter((t) => t.decision === "limited").map((t) => t.rawName),
  });
  return `<p>${esc(text)}</p>`;
}

export type AgreementPointerSummary = {
  kind: string;
  registryUrl: string | null;
  registryId: string | null;
  originator: string | null;
} | null;

/** Latest Agreement per tool by createdAt as a canonical pointer summary.
 *  Null when the tool has no agreement; upload rows read as
 *  {kind: local_upload, nulls}; pointer rows carry their typed fields.
 *  Sorted into toolTableHash and pinned at adopt (spec 4.2, Q4). */
export function latestPointerSummary(
  agreements?: Array<{
    kind?: string | null;
    registryUrl?: string | null;
    registryId?: string | null;
    originator?: string | null;
    createdAt?: Date | string;
  }> | null
): AgreementPointerSummary {
  if (!agreements || agreements.length === 0) return null;
  const latest = [...agreements].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bt - at;
  })[0];
  return {
    kind: typeof latest.kind === "string" && latest.kind ? latest.kind : "local_upload",
    registryUrl: typeof latest.registryUrl === "string" ? latest.registryUrl : null,
    registryId: typeof latest.registryId === "string" ? latest.registryId : null,
    originator: typeof latest.originator === "string" ? latest.originator : null,
  };
}

export const GRADE_BANDS = ["red", "yellow", "green"] as const;
export type GradeBand = (typeof GRADE_BANDS)[number];

/** Resolve one grade band (spec 4.5, Q3): the tool override wins when it is a
 *  valid band, otherwise the questionnaire band, otherwise null (Missing). */
export function resolveBand(
  override: string | null | undefined,
  questionnaire: string | null | undefined
): GradeBand | null {
  if (override && (GRADE_BANDS as readonly string[]).includes(override)) return override as GradeBand;
  if (questionnaire && (GRADE_BANDS as readonly string[]).includes(questionnaire)) {
    return questionnaire as GradeBand;
  }
  return null;
}

/** Resolve the K–5 / 6–8 / 9–12 triple for a tool row against questionnaire answers. */
export function resolvedToolBands(
  tool: {
    integrityK5Override?: string | null;
    integrity68Override?: string | null;
    integrity912Override?: string | null;
  },
  answers: {
    integrityK5?: string | null;
    integrity68?: string | null;
    integrity912?: string | null;
  } | null | undefined
): { integrityK5: GradeBand | null; integrity68: GradeBand | null; integrity912: GradeBand | null } {
  const a = answers ?? {};
  return {
    integrityK5: resolveBand(tool.integrityK5Override ?? null, a.integrityK5 ?? null),
    integrity68: resolveBand(tool.integrity68Override ?? null, a.integrity68 ?? null),
    integrity912: resolveBand(tool.integrity912Override ?? null, a.integrity912 ?? null),
  };
}

export function toolTableHash(tools: Array<Record<string, unknown>>): string {
  const canon = [...tools]
    .sort((a, b) => String(a.rawName).localeCompare(String(b.rawName)))
    .map((t) => ({
      rawName: t.rawName, aiStatus: t.aiStatus, agreementStatus: t.agreementStatus,
      decision: t.decision, catalogToolId: t.catalogToolId ?? null,
      inUse: t.inUse, exhibitOverride: t.exhibitOverride ?? null,
      integrityK5Override: t.integrityK5Override ?? null,
      integrity68Override: t.integrity68Override ?? null,
      integrity912Override: t.integrity912Override ?? null,
      agreementPointer: latestPointerSummary(
        (t.agreements as Parameters<typeof latestPointerSummary>[0]) ??
          ((t.agreementPointer as unknown as Parameters<typeof latestPointerSummary>[0]) || null)
      ),
    }));
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

const INTEGRITY_WORDS = {
  red: "Red — not permitted for student use in this band.",
  yellow: "Yellow — teacher-guided classroom use only.",
  green: "Green — permitted with citation and teacher review.",
} as const;

function fillVars(body: string, a: Answers): string {
  return body
    .replaceAll("{{rup_name}}", a.rupName || "the Responsible Use Policy")
    .replaceAll("{{owner_name}}", a.ownerName || "[named owner not set]")
    .replaceAll("{{review_cadence}}", a.reviewCadence || "[cadence not set]");
}

export async function assemble(db: PrismaClient, districtId: string): Promise<Assembled> {
  const district = await db.district.findUniqueOrThrow({ where: { id: districtId } });
  const row = await db.questionnaireAnswer.findUnique({ where: { districtId } });
  const a = (row?.answers ?? {}) as Answers;
  const tools = await db.districtTool.findMany({
    where: { districtId },
    include: { catalogTool: true, agreements: { orderBy: { createdAt: "desc" } } },
    orderBy: { rawName: "asc" },
  });

  const missing: string[] = [];
  if (!a.dataRule) missing.push("data rule");
  if (!a.integrityK5) missing.push("academic integrity K–5");
  if (!a.integrity68) missing.push("academic integrity 6–8");
  if (!a.integrity912) missing.push("academic integrity 9–12");
  if (!a.toolApprovalClause) missing.push("tool-approval clause");
  if (!a.disciplineClause) missing.push("discipline clause");
  if (!a.privacyClause) missing.push("privacy clause");
  if (!a.staffUseClause) missing.push("staff-use clause");
  if (!a.rolesClause) missing.push("roles-and-review clause");
  if (!a.amendmentChoice) missing.push("amendment choice");

  const inUse = tools.filter((t) => t.inUse);
  const gate: string[] = [];
  if (!a.dataRule) gate.push("data rule");
  if (!a.integrityK5) gate.push("academic integrity K–5");
  if (!a.integrity68) gate.push("academic integrity 6–8");
  if (!a.integrity912) gate.push("academic integrity 9–12");
  if (inUse.length === 0 && !a.nothingApproved) {
    gate.push("imported tool list, or an explicit “nothing approved yet”");
  }

  // Clause resolution: adopted text references id+version only.
  const amendmentId =
    a.amendmentChoice === "separate_aup"
      ? "separate_aup"
      : district.state === "WA"
        ? "amend_rup_wa"
        : "amend_rup";
  const picks: Array<[string, string | undefined, string]> = [
    ["tool_approval", a.toolApprovalClause, "allowlist"],
    ["discipline", a.disciplineClause, "educational"],
    ["privacy", a.privacyClause, "minimization"],
    ["staff_use", a.staffUseClause, "guardrails"],
    ["roles", a.rolesClause, "annual"],
    ["amendment", amendmentId, amendmentId],
  ];
  const clauseRefs: ClauseRef[] = [];
  const bodies: Record<string, string> = {};
  for (const [section, key, fallback] of picks) {
    const id = key || (missing.includes(`${section} clause`) || section === "amendment" ? fallback : fallback);
    const clause =
      (await db.clause.findFirst({
        where: { id, jurisdiction: district.state === "WA" ? { in: ["WA", "common"] } : "common", section },
        orderBy: [{ jurisdiction: "desc" }, { version: "desc" }],
      })) ??
      (await db.clause.findFirst({ where: { id, section }, orderBy: { version: "desc" } }));
    if (clause) {
      clauseRefs.push({ clauseId: clause.id, version: clause.version });
      bodies[section] = fillVars(clause.body, a);
    } else {
      bodies[section] = `[Missing decision: ${section} clause not selected.]`;
    }
  }

  const approved = inUse.filter((t) => t.decision === "approved").map((t) => t.rawName);
  const limited = inUse.filter((t) => t.decision === "limited").map((t) => t.rawName);
  const ctx = {
    districtName: district.name,
    rupName: a.rupName || "the Responsible Use Policy",
    approved, limited,
    integrityK5: a.integrityK5, integrity68: a.integrity68, integrity912: a.integrity912,
  };
  const purpose = await writeRestricted("purpose", ctx);

  const toolRows = (list: typeof tools) =>
    list.length
      ? `<table><tr><th>Tool</th><th>AI status</th><th>Agreement</th><th>Decision</th><th>Note</th></tr>` +
        list.map((t) => `<tr><td>${esc(t.rawName)}</td><td>${esc(t.aiStatus.replace(/_/g, " "))}</td><td>${esc(t.agreementStatus.replace(/_/g, " "))}</td><td>${esc(t.decision.toUpperCase())}</td><td>${esc(t.notes)}</td></tr>`).join("") +
        `</table>`
      : `<p>None.</p>`;
  const band = (label: string, v: Answers["integrityK5"]) =>
    `<tr><td>${label}</td><td>${v ? esc(INTEGRITY_WORDS[v]) : "<b>Missing decision.</b>"}</td></tr>`;

  const stanceWords: Record<string, string> = {
    no_ai: "No AI in classrooms",
    guided_use: "Guided use",
    active_adoption: "Active adoption",
  };
  const whoWords: Record<string, string> = {
    staff_only: "Staff only",
    staff_and_students: "Staff and students",
    grade_banded: "By grade band",
  };
  const scopeLine = `<p>Scope: stance — <b>${esc(a.stance ? stanceWords[a.stance] ?? a.stance : "Decision missing.")}</b> Who may use AI — <b>${esc(a.whoMayUse ? whoWords[a.whoMayUse] ?? a.whoMayUse : "Decision missing.")}</b></p>`;

  const sections: Section[] = [
    { n: 1, title: "Purpose and scope", html: `<p>${esc(purpose)}</p>${scopeLine}`, source: "Model-written paragraph, plus your stance and who-may-use answers. Change the answers in Questions." },
    { n: 2, title: "Principles", html: `<ul><li>Student safety and privacy come before convenience.</li><li>Unknown vendor facts are treated as unknown — never assumed safe.</li><li>Teachers retain professional judgment over any AI suggestion.</li><li>No automated system alone determines discipline or placement.</li></ul>`, source: "Fixed template — same for every district." },
    { n: 3, title: "Approved, limited, and prohibited tools",
      html: inUse.length === 0
        ? `<p><b>No tool is approved until it clears review.</b> The inventory ${a.nothingApproved ? "declares nothing approved at this time" : "is empty"}.</p>`
        : `<h3>Approved</h3>${toolRows(inUse.filter((t) => t.decision === "approved"))}<h3>Limited</h3>${toolRows(inUse.filter((t) => t.decision === "limited"))}<h3>Prohibited</h3>${toolRows(inUse.filter((t) => t.decision === "banned"))}<h3>On hold</h3>${toolRows(inUse.filter((t) => t.decision === "hold"))}<p>Tool-approval rule: ${esc(bodies.tool_approval)}</p>`,
      source: "Live from your inventory, plus your tool-approval clause. Edit tools in Inventory; change the clause in Questions." },
    { n: 4, title: "Academic integrity by grade band",
      html: `<table><tr><th>Band</th><th>Rule</th></tr>${band("K–5", a.integrityK5)}${band("6–8", a.integrity68)}${band("9–12", a.integrity912)}</table><p>Discipline: ${esc(bodies.discipline)}</p>`,
      source: "Your grade-band choices and discipline clause. Change them in Questions." },
    { n: 5, title: "Data and privacy",
      html: `<p>${esc(bodies.privacy)}</p><p>District data rule: <b>${esc(a.dataRule || "Decision missing.")}</b> No-training rule: <b>${esc(a.noTrainingRule || "Decision missing.")}</b>${a.noSoleDecision ? " No automated system alone determines discipline or placement." : ""}</p>`,
      source: "Your privacy clause, data rule, and no-training rule. Change them in Questions." },
    { n: 6, title: "Staff use",
      html: `<p>${esc(bodies.staff_use)}</p><p>Disclosure: <b>${esc(a.disclosure || "Decision missing.")}</b></p>`,
      source: "Your staff-use clause and disclosure choice. Change them in Questions." },
    { n: 7, title: "Roles and review",
      html: `<p>${esc(bodies.roles)}</p><p>Named owner: <b>${esc(a.ownerName || "Decision missing.")}</b> Review cadence: <b>${esc(a.reviewCadence || "Decision missing.")}</b></p>`,
      source: "Your roles clause, named owner, and cadence. Change them in Questions." },
    { n: 8, title: "Amendment language",
      html: `<p>${esc(bodies.amendment)}</p>${district.state === "WA" && a.amendmentChoice !== "separate_aup" ? "<p>Washington note: a separate AI acceptable-use policy is optional.</p>" : ""}`,
      source: "Your amendment clause and choice. Change them in Questions." },
  ];

  const toolHash = toolTableHash(tools);
  const answersHash = createHash("sha256")
    .update(JSON.stringify({ answers: a, clauseRefs }))
    .digest("hex");
  const html =
    `<p>District: ${esc(district.name)}</p>` +
    sections.map((s) => `<h2>${s.n}. ${esc(s.title)}</h2>${s.html}`).join("");

  return { sections, missing, gate, clauseRefs, toolHash, answersHash, html, inUseCount: inUse.length };
}
