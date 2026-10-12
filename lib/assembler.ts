import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { writeRestricted } from "./llm";
import { esc } from "./escape";
import { clauseScope } from "./tenancy";

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
  /** What a review seat signs: the answers hash plus the stored purpose text. */
  draftHash: string;
  /** The purpose paragraph in use: stored draft text, fresh model text, or "". */
  purpose: string;
  html: string;
  inUseCount: number;
};

/** Languages a district may add to the family letter. */
export const FAMILY_LANGUAGES = ["Spanish", "Vietnamese", "Russian", "Ukrainian", "Somali", "Chinese", "Arabic", "Tagalog", "Korean"] as const;
export type FamilyTranslations = Record<string, { text: string; reviewed: boolean }>;

/** The printed guidance for one tool: the limit, then the teacher guidance.
 *  Internal notes never print. */
export function guidanceText(t: { limitText?: string | null; teacherGuidance?: string | null }): string {
  return [t.limitText, t.teacherGuidance].map((v) => (v ?? "").trim()).filter(Boolean).join(" ");
}

/** Ask the model for the family letter. `translate` asks for the same letter
 *  in another language, from the given source text. Plain text out. */
export async function familyLetterText(
  db: PrismaClient,
  districtId: string,
  translate?: { language: string; sourceText: string }
): Promise<string> {
  const district = await db.district.findUniqueOrThrow({ where: { id: districtId } });
  const row = await db.questionnaireAnswer.findUnique({ where: { districtId } });
  const a = (row?.answers ?? {}) as Answers;
  const tools = await db.districtTool.findMany({ where: { districtId, inUse: true, archivedAt: null } });
  return writeRestricted("family", {
    districtName: district.name,
    rupName: a.rupName || "the Responsible Use Policy",
    approved: tools.filter((t) => t.decision === "approved").map((t) => t.rawName),
    limited: tools.filter((t) => t.decision === "limited").map((t) => t.rawName),
    ...(translate ?? {}),
  });
}

export async function familyLetter(db: PrismaClient, districtId: string): Promise<string> {
  return `<p>${esc(await familyLetterText(db, districtId))}</p>`;
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

/** An untouched staff request: still on hold, entered by the request form.
 *  Anyone can create one without a login, so it stays out of the hash, the
 *  snapshot, and the diff until the council decides on it. */
export function isOpenRequest(t: { source?: string | null; decision: string }): boolean {
  return t.source === "request" && t.decision === "hold";
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
      // Printed guidance is part of the published list. Added only when set,
      // so hashes pinned before these fields existed still match.
      ...(t.limitText ? { limitText: t.limitText } : {}),
      ...(t.teacherGuidance ? { teacherGuidance: t.teacherGuidance } : {}),
      agreementPointer: latestPointerSummary(
        (t.agreements as Parameters<typeof latestPointerSummary>[0]) ??
          ((t.agreementPointer as unknown as Parameters<typeof latestPointerSummary>[0]) || null)
      ),
    }));
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

/** One tool row as pinned into a snapshot or a published tool list. Bands are
 *  resolved against the given answers: the tool override wins when set. */
export function pinToolRow(
  t: {
    rawName: string; category: string; aiStatus: string; agreementStatus: string; decision: string;
    notes: string; teacherGuidance: string; limitText: string; exhibitOverride: unknown;
    integrityK5Override: string | null; integrity68Override: string | null; integrity912Override: string | null;
    agreements?: Parameters<typeof latestPointerSummary>[0];
  },
  answers: Answers
) {
  // Pin the citation triple alongside the row fields so the cited fact
  // survives exactly as adopted. Older/uncited rows keep nulls: no backfill.
  const over = (t.exhibitOverride ?? {}) as Record<string, unknown>;
  const triple = (k: string): string | null => typeof over[k] === "string" ? (over[k] as string) : null;
  // Canonical pointer summary (spec 4.2, Q4): latest Agreement per tool.
  const pointer = latestPointerSummary(t.agreements ?? null);
  // Resolved grade-band triple (spec 4.5, Q4).
  const bands = resolvedToolBands(t, answers);
  return {
    rawName: t.rawName, category: t.category, aiStatus: t.aiStatus,
    agreementStatus: t.agreementStatus, decision: t.decision, notes: t.notes,
    teacherGuidance: t.teacherGuidance, limitText: t.limitText,
    citationUrl: triple("citationUrl"), citationDate: triple("citationDate"), citedBy: triple("citedBy"),
    agreementKind: pointer?.kind ?? null,
    registryUrl: pointer?.registryUrl ?? null,
    registryId: pointer?.registryId ?? null,
    originator: pointer?.originator ?? null,
    integrityK5: bands.integrityK5,
    integrity68: bands.integrity68,
    integrity912: bands.integrity912,
  };
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

/** The purpose paragraph comes from the stored draft text when there is one.
 *  `prose: false` never calls the model: with no stored text, section 1 says
 *  the paragraph is not written yet. Pages use it, so a view never costs a
 *  model call. `prose: true` (actions only) asks the model when nothing is
 *  stored; `regenerate` asks even when something is. */
export async function assemble(
  db: PrismaClient,
  districtId: string,
  opts: { prose: boolean; regenerate?: boolean } = { prose: true }
): Promise<Assembled> {
  const district = await db.district.findUniqueOrThrow({ where: { id: districtId } });
  const row = await db.questionnaireAnswer.findUnique({ where: { districtId } });
  const a = (row?.answers ?? {}) as Answers;
  const tools = await db.districtTool.findMany({
    where: { districtId, archivedAt: null },
    include: { catalogTool: true, agreements: { orderBy: { createdAt: "desc" } } },
    orderBy: { rawName: "asc" },
  });
  const stored = (await db.draft.findFirst({ where: { districtId }, orderBy: { createdAt: "desc" } }))?.purposeText ?? "";

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
    const id = key || fallback;
    const clause =
      (await db.clause.findFirst({
        where: { id, jurisdiction: district.state === "WA" ? { in: ["WA", "common"] } : "common", section, ...clauseScope(districtId) },
        orderBy: [{ jurisdiction: "desc" }, { version: "desc" }],
      })) ??
      (await db.clause.findFirst({ where: { id, section, ...clauseScope(districtId) }, orderBy: { version: "desc" } }));
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
  const purpose = stored && !opts.regenerate ? stored : opts.prose ? await writeRestricted("purpose", ctx) : "";
  const purposeHtml = purpose
    ? `<p>${esc(purpose)}</p>`
    : `<p><i>The purpose paragraph is not written yet. Write it on the draft page.</i></p>`;

  const toolRows = (list: typeof tools) =>
    list.length
      ? `<table><tr><th>Tool</th><th>AI status</th><th>Agreement</th><th>Decision</th><th>Guidance</th></tr>` +
        list.map((t) => `<tr><td>${esc(t.rawName)}</td><td>${esc(t.aiStatus.replace(/_/g, " "))}</td><td>${esc(t.agreementStatus.replace(/_/g, " "))}</td><td>${esc(t.decision.toUpperCase())}</td><td>${esc(guidanceText(t))}</td></tr>`).join("") +
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
    { n: 1, title: "Purpose and scope", html: `${purposeHtml}${scopeLine}`, source: "Model-written paragraph the owner can edit on the draft page, plus your stance and who-may-use answers." },
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

  const toolHash = toolTableHash(tools.filter((t) => !isOpenRequest(t)));
  const answersHash = createHash("sha256")
    .update(JSON.stringify({ answers: a, clauseRefs }))
    .digest("hex");
  const html =
    `<p>District: ${esc(district.name)}</p>` +
    sections.map((s) => `<h2>${s.n}. ${esc(s.title)}</h2>${s.html}`).join("");

  // Seats sign the stored text only, so a fresh model call never lapses a signature by itself.
  const draftHash = createHash("sha256").update(`${answersHash}\n${stored}`).digest("hex");

  return { sections, missing, gate, clauseRefs, toolHash, answersHash, draftHash, purpose, html, inUseCount: inUse.length };
}
