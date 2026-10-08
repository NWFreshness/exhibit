"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sessionUser } from "@/lib/session";
import { canWrite, isOwner } from "@/lib/tenancy";
import { refuseStudentData } from "@/lib/guard";
import { assemble, familyLetter, type Answers } from "@/lib/assembler";
import { boardLock, REQUIRED_SEATS, OPTIONAL_SEATS } from "@/lib/seats";
import { buildTrainingPacket } from "@/lib/training";
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
    const c = await prisma.clause.findFirst({ where: { id: parsed.data.targetId } });
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
  const latest = await prisma.clause.findFirst({ where: { id: c.clauseId }, orderBy: { version: "desc" } });
  if (!latest) return { error: "Clause not found." };
  await prisma.clause.create({
    data: { id: latest.id, version: latest.version + 1, jurisdiction: latest.jurisdiction, section: latest.section, title: `${latest.title} (rev ${latest.version + 1})`, body: c.proposal },
  });
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
  await prisma.reviewSeat.update({ where: { id: s.id }, data: { signedAt: new Date(), signedBy: `${user.email} (${user.role})`, overrideReason: null } });
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
  await prisma.reviewSeat.update({ where: { id: s.id }, data: { signedAt: null, signedBy: null, overrideReason: `${user.email}: ${reason.trim().slice(0, 1000)}` } });
  revalidatePath("/review");
  return {};
}

// ---- Draft + adopt ----
export async function refreshDraft(): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const out = await assemble(prisma, user.districtId);
  await prisma.draft.deleteMany({ where: { districtId: user.districtId } });
  await prisma.draft.create({
    data: { districtId: user.districtId, clauseRefs: out.clauseRefs, toolHash: out.toolHash, answersHash: out.answersHash, html: out.html },
  });
  revalidatePath("/draft");
  return {};
}

export async function adoptSnapshot(): Promise<{ error?: string; id?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const lock = await boardLock(prisma, user.districtId);
  if (lock.locked) return { error: `Board packet is locked. ${lock.reason} Sign all required seats or record an owner override with a reason.` };
  const out = await assemble(prisma, user.districtId);
  if (out.gate.length) return { error: `Cannot adopt: ${out.gate.join("; ")}.` };
  const tools = await prisma.districtTool.findMany({ where: { districtId: user.districtId }, orderBy: { rawName: "asc" } });
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const qRow = await prisma.questionnaireAnswer.findUnique({ where: { districtId: user.districtId } });
  const snap = await prisma.adoptedSnapshot.create({
    data: {
      districtId: user.districtId, adoptedBy: user.email,
      clauseRefs: out.clauseRefs, toolHash: out.toolHash, answersHash: out.answersHash,
      answersJson: (qRow?.answers ?? {}) as object,
      toolTable: JSON.parse(JSON.stringify(tools.map((t) => ({
        rawName: t.rawName, category: t.category, aiStatus: t.aiStatus,
        agreementStatus: t.agreementStatus, decision: t.decision, notes: t.notes,
      })))),
      html: out.html,
    },
  });
  const fam = await familyLetter(prisma, user.districtId);
  const packet = buildTrainingPacket({
    districtName: district.name, adoptedOn: snap.adoptedAt.toISOString().slice(0, 10),
    adoptedBy: user.email, stale: false,
    tools: (snap.toolTable as Array<{ rawName: string; aiStatus: string; agreementStatus: string; decision: string; notes: string }>),
  });
  const stored = await putBlob(
    `exports/${user.districtId}/${snap.id}.html`,
    `<!doctype html><html><head><meta charset="utf-8"><title>Adopted packet</title></head><body>${out.html}<hr>${fam}<hr>${packet.principalScript}${packet.teacherCard}</body></html>`,
    "text/html"
  );
  await prisma.adoptedSnapshot.update({ where: { id: snap.id }, data: { exportKey: stored.key } });
  await prisma.draft.deleteMany({ where: { districtId: user.districtId } });
  await prisma.draft.create({
    data: { districtId: user.districtId, clauseRefs: out.clauseRefs, toolHash: out.toolHash, answersHash: out.answersHash, html: out.html },
  });
  revalidatePath("/draft");
  revalidatePath("/snapshot");
  revalidatePath("/");
  return { id: snap.id };
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
  await prisma.trainingAck.create({ data: { districtId: user.districtId, snapshotId: snap.id, name: nm, schoolId: school } });
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
  const tools = (snap.toolTable ?? []) as Array<{ rawName: string; decision: string; notes: string; category?: string }>;
  const usable = tools.filter((t) => t.decision === "approved" || t.decision === "limited");
  const { writeRestricted } = await import("@/lib/llm");
  let body: string;
  try {
    body = await writeRestricted("training", {
      districtName: district.name,
      rupName: answers.rupName || "the Responsible Use Policy",
      approved: usable.filter((t) => t.decision === "approved").map((t) => t.rawName),
      limited: usable.filter((t) => t.decision === "limited").map((t) => t.rawName),
      toolDetails: usable.map((t) => `${t.rawName} (${t.decision}${t.notes ? `: ${t.notes}` : ""})`).join(" "),
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
