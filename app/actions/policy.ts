"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sessionUser } from "@/lib/session";
import { canWrite, clauseScope, isOwner, scope } from "@/lib/tenancy";
import { refuseStudentData } from "@/lib/guard";
import { isCitationUrlValid, withCitation, inCitationQueue, mergedExhibit } from "@/lib/rubric";
import { assemble, familyLetterText, isOpenRequest, pinToolRow, toolTableHash, FAMILY_LANGUAGES, type Answers, type Assembled, type FamilyTranslations } from "@/lib/assembler";
import { boardLock, REQUIRED_SEATS, OPTIONAL_SEATS } from "@/lib/seats";
import { promoteClause } from "@/lib/clauses";
import { buildTrainingPacket, guidanceOf, type SnapshotTool } from "@/lib/training";
import { currentPolicy, toolListFor } from "@/lib/policy";
import { esc } from "@/lib/escape";
import { shareFinding } from "@/lib/shared";
import { putBlob } from "@/lib/store";

const band = z.enum(["red", "yellow", "green"]);
const answersSchema = z.object({
  stance: z.string().max(60).optional(),
  whoMayUse: z.string().max(60).optional(),
  integrityK5: band.optional(),
  integrity68: band.optional(),
  integrity912: band.optional(),
  dataRule: z.string().max(60).optional(),
  noTrainingRule: z.string().max(60).optional(),
  noSoleDecision: z.boolean().optional(),
  disclosure: z.string().max(60).optional(),
  ownerName: z.string().max(120).optional(),
  reviewCadence: z.string().max(60).optional(),
  rupName: z.string().max(120).optional(),
  amendmentChoice: z.enum(["amend_existing", "separate_aup"]).optional(),
  nothingApproved: z.boolean().optional(),
  toolApprovalClause: z.string().max(60).optional(),
  disciplineClause: z.string().max(60).optional(),
  privacyClause: z.string().max(60).optional(),
  staffUseClause: z.string().max(60).optional(),
  rolesClause: z.string().max(60).optional(),
});

export async function saveAnswers(input: Record<string, unknown>): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const parsed = answersSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid answers." };
  for (const v of [parsed.data.ownerName, parsed.data.rupName]) {
    const blocked = refuseStudentData(v || "");
    if (blocked) return { error: blocked };
  }
  await prisma.questionnaireAnswer.upsert({
    where: { districtId: user.districtId },
    update: { answers: { ...parsed.data } },
    create: { districtId: user.districtId, answers: { ...parsed.data } },
  });
  for (const seat of REQUIRED_SEATS) {
    await prisma.reviewSeat.upsert({
      where: { districtId_seat: { districtId: user.districtId, seat } },
      update: { required: true },
      create: { districtId: user.districtId, seat, required: true },
    });
  }
  for (const seat of OPTIONAL_SEATS) {
    await prisma.reviewSeat.upsert({
      where: { districtId_seat: { districtId: user.districtId, seat } },
      update: {},
      create: { districtId: user.districtId, seat, required: false },
    });
  }
  revalidatePath("/questionnaire");
  revalidatePath("/draft");
  return {};
}

// ---- Comments: bound to a clause id or a DistrictTool id. accept | reject | propose.
// A free note never changes adopted text; only owner promotion creates a clause version.
const commentSchema = z.object({
  targetType: z.enum(["clause", "tool"]),
  targetId: z.string().min(1).max(100),
  kind: z.enum(["accept", "reject", "propose"]),
  note: z.string().max(2000).default(""),
  proposal: z.string().max(4000).optional(),
});

export async function addComment(input: { targetType: string; targetId: string; kind: string; note: string; proposal?: string }): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid comment." };
  const blocked = refuseStudentData(parsed.data.note) || refuseStudentData(parsed.data.proposal || "");
  if (blocked) return { error: blocked };
  if (parsed.data.targetType === "tool") {
    const t = await prisma.districtTool.findFirst({ where: { id: parsed.data.targetId, districtId: user.districtId } });
    if (!t) return { error: "Tool not found in your district." };
  } else {
    const c = await prisma.clause.findFirst({ where: { id: parsed.data.targetId, ...clauseScope(user.districtId) } });
    if (!c) return { error: "Clause not found." };
  }
  await prisma.comment.create({
    data: {
      districtId: user.districtId, targetType: parsed.data.targetType, targetId: parsed.data.targetId,
      toolId: parsed.data.targetType === "tool" ? parsed.data.targetId : null,
      clauseId: parsed.data.targetType === "clause" ? parsed.data.targetId : null,
      kind: parsed.data.kind, note: parsed.data.note,
      proposal: parsed.data.kind === "propose" ? parsed.data.proposal || null : null,
      author: user.email,
    },
  });
  revalidatePath("/review");
  return {};
}

export async function resolveComment(id: string, status: "accepted" | "rejected"): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const c = await prisma.comment.findFirst({ where: { id, districtId: user.districtId } });
  if (!c) return { error: "Not found." };
  await prisma.comment.update({ where: { id }, data: { status } });
  revalidatePath("/review");
  return {};
}

/** Owner promotes an accepted proposal into the clause library as a new version. */
export async function promoteProposal(id: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const c = await prisma.comment.findFirst({ where: { id, districtId: user.districtId } });
  if (!c || c.targetType !== "clause" || !c.clauseId || !c.proposal) return { error: "Only propose-comments on clauses with replacement text can be promoted." };
  try {
    await promoteClause(prisma, user.districtId, c.clauseId, c.proposal);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Promotion failed." };
  }
  await prisma.comment.update({ where: { id }, data: { status: "accepted" } });
  revalidatePath("/review");
  return {};
}

// ---- Seats ----
export async function signSeat(seat: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Viewers cannot sign." };
  const s = await prisma.reviewSeat.findUnique({ where: { districtId_seat: { districtId: user.districtId, seat } } });
  if (!s) return { error: "Unknown seat." };
  if (s.assignedEmail && s.assignedEmail !== user.email.toLowerCase()) {
    return { error: `This seat is assigned to ${s.assignedEmail}. Only they can sign it; the owner can record an override.` };
  }
  const { draftHash } = await assemble(prisma, user.districtId, { prose: false });
  await prisma.reviewSeat.update({ where: { id: s.id }, data: { signedAt: new Date(), signedBy: `${user.email} (${user.role})`, overrideReason: null, signedHash: draftHash } });
  revalidatePath("/review");
  return {};
}

export async function overrideSeat(seat: string, reason: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  if (reason.trim().length < 10) return { error: "Record why: an override reason of at least 10 characters is required." };
  const blocked = refuseStudentData(reason);
  if (blocked) return { error: blocked };
  const s = await prisma.reviewSeat.findUnique({ where: { districtId_seat: { districtId: user.districtId, seat } } });
  if (!s) return { error: "Unknown seat." };
  const { draftHash } = await assemble(prisma, user.districtId, { prose: false });
  await prisma.reviewSeat.update({ where: { id: s.id }, data: { signedAt: null, signedBy: null, overrideReason: `${user.email}: ${reason.trim().slice(0, 1000)}`, signedHash: draftHash } });
  revalidatePath("/review");
  return {};
}

// ---- Citations (spec 4.1): one action records the finding value plus the
// citation triple (source URL, date, actor email) in a single exhibitOverride
// write. Never touches notes; the actor is the session email, never input.
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function parseFindingFlag(v: string | undefined): boolean | undefined | "invalid" {
  if (v === undefined || v === "") return undefined;
  if (v === "true") return true;
  if (v === "false") return false;
  return "invalid";
}

export async function citeFinding(input: {
  toolId: string;
  usedForTraining?: string;
  trainingAddressed?: string;
  citationUrl: string;
  citationDate?: string;
  /** Also offer this cited finding to other districts (no district named). */
  share?: boolean;
}): Promise<{ error?: string; field?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const toolId = (input.toolId || "").trim().slice(0, 100);
  if (!toolId) return { error: "Not found." };
  const usedForTraining = parseFindingFlag(input.usedForTraining);
  const trainingAddressed = parseFindingFlag(input.trainingAddressed);
  if (usedForTraining === "invalid" || trainingAddressed === "invalid") {
    return { error: "Invalid finding value.", field: "finding" };
  }
  if (usedForTraining === undefined && trainingAddressed === undefined) {
    return { error: "Add a finding: training use true/false, or agreement-addressed true/false.", field: "finding" };
  }
  const url = (input.citationUrl || "").trim().slice(0, 2000);
  if (!isCitationUrlValid(url)) {
    return { error: "Invalid citation URL: must start with http:// or https://.", field: "citationUrl" };
  }
  let date = (input.citationDate || "").trim().slice(0, 10);
  if (!date) date = new Date().toISOString().slice(0, 10);
  else if (!dateRe.test(date)) return { error: "Citation date must be YYYY-MM-DD.", field: "citationDate" };
  const blocked = refuseStudentData(url);
  if (blocked) return { error: blocked };
  // District-scoped lookup: another district's id resolves to the same
  // generic "Not found." as a missing row, so no existence signal leaks.
  const tool = await prisma.districtTool.findFirst({
    where: { id: toolId, ...scope(user) },
    include: { catalogTool: true },
  });
  if (!tool) return { error: "Not found." };
  if (!tool.inUse) return { error: "Tool is not in the citation queue." };
  const over = (tool.exhibitOverride ?? {}) as Record<string, unknown>;
  const merged = mergedExhibit(tool.catalogTool ?? null, over);
  if (!inCitationQueue(merged, tool.agreementStatus)) {
    return { error: "Tool is not in the citation queue." };
  }
  const next = withCitation(
    over,
    {
      ...(usedForTraining !== undefined ? { usedForTraining } : {}),
      ...(trainingAddressed !== undefined ? { trainingAddressed } : {}),
    },
    { citationUrl: url, citationDate: date, citedBy: user.email }
  );
  await prisma.districtTool.update({ where: { id: tool.id }, data: { exhibitOverride: JSON.parse(JSON.stringify(next)) } });
  if (input.share && tool.catalogToolId) {
    await shareFinding(prisma, user.districtId, tool.catalogToolId,
      { usedForTraining, trainingAddressed }, { citationUrl: url, citationDate: date });
  }
  revalidatePath("/review");
  return {};
}

/** Take another district's shared finding into this district's own record.
 *  Nothing merges until this runs; the citation keeps the original source. */
export async function acceptSharedFinding(toolId: string, findingId: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const tool = await prisma.districtTool.findFirst({ where: { id: toolId, ...scope(user) } });
  if (!tool || !tool.catalogToolId) return { error: "Not found." };
  const f = await prisma.sharedFinding.findFirst({ where: { id: findingId, catalogToolId: tool.catalogToolId } });
  if (!f || (f.key !== "usedForTraining" && f.key !== "trainingAddressed")) return { error: "Not found." };
  const next = withCitation(
    (tool.exhibitOverride ?? {}) as Record<string, unknown>,
    { [f.key]: f.value },
    { citationUrl: f.citationUrl, citationDate: f.citationDate, citedBy: user.email }
  );
  await prisma.districtTool.update({ where: { id: tool.id }, data: { exhibitOverride: JSON.parse(JSON.stringify(next)) } });
  revalidatePath(`/tools/${tool.id}`);
  revalidatePath("/review");
  return {};
}

// ---- Draft, model-written text, approval, board adoption, tool list ----

/** Write the working draft row, keeping the model-written text it already has. */
async function saveDraft(districtId: string, out: Assembled, prose: { purposeText?: string; familyText?: string; familyTranslations?: FamilyTranslations } = {}) {
  const data = { clauseRefs: out.clauseRefs, toolHash: out.toolHash, answersHash: out.answersHash, html: out.html, ...prose };
  const existing = await prisma.draft.findFirst({ where: { districtId }, orderBy: { createdAt: "desc" } });
  if (existing) return prisma.draft.update({ where: { id: existing.id }, data });
  return prisma.draft.create({ data: { districtId, ...data } });
}

export async function refreshDraft(): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  await saveDraft(user.districtId, await assemble(prisma, user.districtId, { prose: false }));
  revalidatePath("/draft");
  return {};
}

/** Ask the model for the purpose paragraph and the family letter and store
 *  both on the draft. Overwrites any edits; translations are cleared because
 *  they no longer match. This is the only place a page click calls the model
 *  for these two texts. */
export async function writeProse(): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  try {
    const out = await assemble(prisma, user.districtId, { prose: true, regenerate: true });
    const familyText = await familyLetterText(prisma, user.districtId);
    await saveDraft(user.districtId, out, { purposeText: out.purpose, familyText, familyTranslations: {} });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Generation failed." };
  }
  revalidatePath("/draft");
  return {};
}

/** Owner edit of the two model-written texts. Editing lapses seat signatures. */
export async function saveProse(purposeText: string, familyText: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const purpose = purposeText.trim().slice(0, 4000);
  const family = familyText.trim().slice(0, 6000);
  if (!purpose || !family) return { error: "Both texts are required. Use Write with AI to start." };
  const blocked = refuseStudentData(purpose) || refuseStudentData(family);
  if (blocked) return { error: blocked };
  const out = await assemble(prisma, user.districtId, { prose: false });
  await saveDraft(user.districtId, out, { purposeText: purpose, familyText: family });
  // Re-save so the stored draft html carries the edited paragraph.
  await saveDraft(user.districtId, await assemble(prisma, user.districtId, { prose: false }));
  revalidatePath("/draft");
  return {};
}

/** Add or redo one translation of the stored family letter. Machine text
 *  starts unreviewed; a person marks it reviewed in saveTranslation. */
export async function translateFamily(language: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  if (!(FAMILY_LANGUAGES as readonly string[]).includes(language)) return { error: "Unknown language." };
  const draft = await prisma.draft.findFirst({ where: { districtId: user.districtId }, orderBy: { createdAt: "desc" } });
  if (!draft?.familyText) return { error: "Write the family letter first." };
  let text: string;
  try {
    text = await familyLetterText(prisma, user.districtId, { language, sourceText: draft.familyText });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Translation failed." };
  }
  const all = { ...((draft.familyTranslations ?? {}) as FamilyTranslations), [language]: { text, reviewed: false } };
  await prisma.draft.update({ where: { id: draft.id }, data: { familyTranslations: all } });
  revalidatePath("/draft");
  return {};
}

export async function saveTranslation(language: string, text: string, reviewed: boolean): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const draft = await prisma.draft.findFirst({ where: { districtId: user.districtId }, orderBy: { createdAt: "desc" } });
  const all = { ...((draft?.familyTranslations ?? {}) as FamilyTranslations) };
  if (!draft || !all[language]) return { error: "Not found." };
  const body = text.trim().slice(0, 8000);
  if (!body) delete all[language];
  else {
    const blocked = refuseStudentData(body);
    if (blocked) return { error: blocked };
    all[language] = { text: body, reviewed };
  }
  await prisma.draft.update({ where: { id: draft.id }, data: { familyTranslations: all } });
  revalidatePath("/draft");
  return {};
}

/** Live tool rows pinned for a snapshot or a published list. Archived rows and
 *  open staff requests stay out. */
async function pinnedTools(districtId: string, answers: Answers) {
  const tools = (await prisma.districtTool.findMany({
    where: { districtId, archivedAt: null },
    orderBy: { rawName: "asc" },
    include: { agreements: { orderBy: { createdAt: "desc" } } },
  })).filter((t) => !isOpenRequest(t));
  return {
    toolHash: toolTableHash(tools),
    toolTable: JSON.parse(JSON.stringify(tools.map((t) => pinToolRow(t, answers)))) as SnapshotTool[],
  };
}

/** Council approval: freezes the policy text and the tool list as a snapshot.
 *  It is not in force, public, or trained on until the board adopts it
 *  (recordBoardAdoption). */
export async function adoptSnapshot(): Promise<{ error?: string; id?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const out = await assemble(prisma, user.districtId);
  const lock = await boardLock(prisma, user.districtId, out.draftHash);
  if (lock.locked) return { error: `Board packet is locked. ${lock.reason} Sign all required seats or record an owner override with a reason.` };
  if (out.gate.length) return { error: `Cannot adopt: ${out.gate.join("; ")}.` };
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const qRow = await prisma.questionnaireAnswer.findUnique({ where: { districtId: user.districtId } });
  const answers = (qRow?.answers ?? {}) as Answers;
  const draft = await prisma.draft.findFirst({ where: { districtId: user.districtId }, orderBy: { createdAt: "desc" } });
  // Model call first: if it fails, nothing is adopted and a retry is clean.
  let famText = draft?.familyText ?? "";
  if (!famText) {
    try {
      famText = await familyLetterText(prisma, user.districtId);
    } catch (e) {
      return { error: `Cannot adopt: the family letter could not be written. ${e instanceof Error ? e.message : ""}`.trim() };
    }
  }
  const translations = (draft?.familyTranslations ?? {}) as FamilyTranslations;
  const pinned = await pinnedTools(user.districtId, answers);
  const snap = await prisma.adoptedSnapshot.create({
    data: {
      districtId: user.districtId, adoptedBy: user.email,
      clauseRefs: out.clauseRefs, toolHash: out.toolHash, answersHash: out.answersHash,
      answersJson: answers as object,
      toolTable: pinned.toolTable as object[],
      html: out.html,
      familyText: famText, familyTranslations: translations,
    },
  });
  await prisma.toolListVersion.create({
    data: { districtId: user.districtId, snapshotId: snap.id, publishedBy: user.email, toolHash: pinned.toolHash, toolTable: pinned.toolTable as object[] },
  });
  const packet = buildTrainingPacket({
    districtName: district.name, adoptedOn: snap.adoptedAt.toISOString().slice(0, 10),
    adoptedBy: user.email, stale: false, tools: pinned.toolTable,
  });
  // The snapshot is the record; the export file is a copy. A storage failure
  // leaves exportKey null instead of reporting a failed adoption.
  try {
    const stored = await putBlob(
      `exports/${user.districtId}/${snap.id}.html`,
      `<!doctype html><html><head><meta charset="utf-8"><title>Adopted packet</title></head><body>${out.html}<hr><p>${esc(famText)}</p><hr>${packet.principalScript}${packet.teacherCard}</body></html>`,
      "text/html"
    );
    await prisma.adoptedSnapshot.update({ where: { id: snap.id }, data: { exportKey: stored.key } });
  } catch (e) {
    console.error("[adopt] export not stored:", e instanceof Error ? e.message.slice(0, 300) : e);
  }
  await saveDraft(user.districtId, out, { purposeText: out.purpose, familyText: famText });
  revalidatePath("/draft");
  revalidatePath("/snapshot");
  revalidatePath("/");
  return { id: snap.id };
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** The board vote. Puts a council-approved snapshot in force. */
export async function recordBoardAdoption(snapshotId: string, date: string, resolution: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const snap = await prisma.adoptedSnapshot.findFirst({ where: { id: snapshotId, districtId: user.districtId } });
  if (!snap) return { error: "Not found." };
  if (!isoDate.test(date) || Number.isNaN(new Date(date + "T00:00:00").getTime())) return { error: "Board meeting date must be YYYY-MM-DD." };
  const res = resolution.trim().slice(0, 120);
  const blocked = refuseStudentData(res);
  if (blocked) return { error: blocked };
  await prisma.adoptedSnapshot.update({
    where: { id: snap.id },
    data: { boardAdoptedOn: new Date(date + "T00:00:00"), boardResolution: res || null },
  });
  for (const p of ["/snapshot", "/draft", "/training", "/", `/exhibit/${user.districtId}`]) revalidatePath(p);
  return {};
}

/** Publish the live tool list under the policy in force. No seat sign-off and
 *  no board vote: the policy text is untouched. Grade bands resolve against
 *  the adopted answers, not unadopted edits. */
export async function publishToolList(): Promise<{ error?: string; id?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const policy = await currentPolicy(prisma, user.districtId);
  if (!policy) return { error: "No policy is in force yet. The board must adopt one first." };
  const live = (await prisma.questionnaireAnswer.findUnique({ where: { districtId: user.districtId } }))?.answers;
  const pinned = await pinnedTools(user.districtId, (policy.answersJson ?? live ?? {}) as Answers);
  const v = await prisma.toolListVersion.create({
    data: { districtId: user.districtId, snapshotId: policy.id, publishedBy: user.email, toolHash: pinned.toolHash, toolTable: pinned.toolTable as object[] },
  });
  for (const p of ["/draft", "/training", "/", `/exhibit/${user.districtId}`]) revalidatePath(p);
  return { id: v.id };
}

export async function ackTraining(snapshotId: string, name: string, schoolId?: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user) return { error: "Sign in required." };
  const snap = await prisma.adoptedSnapshot.findFirst({ where: { id: snapshotId, districtId: user.districtId } });
  if (!snap) return { error: "Snapshot not found." };
  const nm = name.trim().slice(0, 120);
  if (nm.length < 2) return { error: "Name required." };
  const blocked = refuseStudentData(nm);
  if (blocked) return { error: blocked };
  let school: string | null = null;
  if (schoolId) {
    const s = await prisma.school.findFirst({ where: { id: schoolId, districtId: user.districtId } });
    if (!s) return { error: "Unknown building." };
    school = s.id;
  }
  const toolListId = (await toolListFor(prisma, snap)).versionId;
  await prisma.trainingAck.create({ data: { districtId: user.districtId, snapshotId: snap.id, toolListId, name: nm, schoolId: school } });
  revalidatePath("/training");
  return {};
}

/** Generate an AI training script for an adopted snapshot. Stored as its own
 *  row — the snapshot is never rewritten. Needs LLM_BASE_URL/KEY; without
 *  them you get clearly-labeled sample text so the flow still works. */
export async function generateTrainingScript(snapshotId: string): Promise<{ error?: string; id?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Staff writers only (owner, curriculum, sped)." };
  const snap = await prisma.adoptedSnapshot.findFirst({ where: { id: snapshotId, districtId: user.districtId } });
  if (!snap) return { error: "Snapshot not found." };
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const answers = ((snap.answersJson ?? {}) as Record<string, string>);
  const tools = ((await toolListFor(prisma, snap)).toolTable ?? []) as SnapshotTool[];
  const usable = tools.filter((t) => t.decision === "approved" || t.decision === "limited");
  const { writeRestricted } = await import("@/lib/llm");
  let body: string;
  try {
    body = await writeRestricted("training", {
      districtName: district.name,
      rupName: answers.rupName || "the Responsible Use Policy",
      approved: usable.filter((t) => t.decision === "approved").map((t) => t.rawName),
      limited: usable.filter((t) => t.decision === "limited").map((t) => t.rawName),
      toolDetails: usable.map((t) => `${t.rawName} (${t.decision}${guidanceOf(t) ? `: ${guidanceOf(t)}` : ""})`).join(" "),
      dataRule: answers.dataRule,
      ownerName: answers.ownerName,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Generation failed." };
  }
  const row = await prisma.trainingScript.create({
    data: {
      districtId: user.districtId, snapshotId: snap.id, body,
      model: process.env.LLM_BASE_URL ? (process.env.LLM_MODEL || "default") : "stub",
      createdBy: user.email,
    },
  });
  revalidatePath("/training");
  return { id: row.id };
}

export type { Answers };
