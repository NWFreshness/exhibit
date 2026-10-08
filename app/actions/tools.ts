"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sessionUser } from "@/lib/session";
import { canWrite } from "@/lib/tenancy";
import { refuseStudentData } from "@/lib/guard";
import { putBlob } from "@/lib/store";
import { OVERRIDE_BOOL_KEYS, OVERRIDE_TEXT_KEYS, isCitationUrlValid } from "@/lib/rubric";

const tri = z.enum(["true", "false", "unknown"]);
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const updateSchema = z.object({
  agreementStatus: z.enum(["signed", "expired", "refused", "not_requested"]),
  decision: z.enum(["approved", "limited", "banned", "hold"]),
  aiStatus: z.enum(["calls_model", "no_model", "unknown"]),
  inUse: z.boolean(),
  notes: z.string().max(2000),
  override: z.record(z.string(), z.string().max(500)),
  agreementEndsOn: z.string().max(10).default(""),
  renewalOwnerUserId: z.string().max(40).default(""),
  vendorContact: z.string().max(200).default(""),
});

export async function updateTool(toolId: string, input: {
  agreementStatus: string; decision: string; aiStatus: string; inUse: boolean;
  notes: string; override: Record<string, string>;
  agreementEndsOn?: string; renewalOwnerUserId?: string; vendorContact?: string;
}): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid values." };
  const tool = await prisma.districtTool.findFirst({ where: { id: toolId, districtId: user.districtId } });
  if (!tool) return { error: "Not found." };
  const blocked = refuseStudentData(parsed.data.notes);
  if (blocked) return { error: blocked };
  // District exhibit override: only known keys; "unknown"/empty clears back to catalog.
  const over: Record<string, boolean | string> = {};
  for (const k of OVERRIDE_BOOL_KEYS) {
    const v = tri.safeParse(parsed.data.override[k] ?? "unknown");
    if (v.success && v.data !== "unknown") over[k] = v.data === "true";
  }
  for (const k of OVERRIDE_TEXT_KEYS) {
    const v = (parsed.data.override[k] ?? "").trim().slice(0, 500);
    if (v !== "") {
      const refused = refuseStudentData(v);
      if (refused) return { error: refused };
      over[k] = v;
    }
  }
  const blockedContact = refuseStudentData(parsed.data.vendorContact);
  if (blockedContact) return { error: blockedContact };
  let endsOn: Date | null = null;
  if (parsed.data.agreementEndsOn) {
    if (!dateRe.test(parsed.data.agreementEndsOn)) return { error: "End date must be YYYY-MM-DD." };
    endsOn = new Date(parsed.data.agreementEndsOn + "T00:00:00");
  }
  let renewalOwner: string | null = null;
  if (parsed.data.renewalOwnerUserId) {
    const member = await prisma.user.findFirst({
      where: { id: parsed.data.renewalOwnerUserId, districtId: user.districtId },
    });
    if (!member) return { error: "Renewal owner must be in this district." };
    renewalOwner = member.id;
  }
  // Expiry forces hold for approved/limited rows. Stale draft follows via hash.
  let status = parsed.data.agreementStatus;
  let decision = parsed.data.decision;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (status === "expired" || (endsOn && endsOn < today)) {
    if (status !== "expired") status = "expired";
    if (decision === "approved" || decision === "limited") decision = "hold";
  }
  const now = new Date();
  await prisma.districtTool.update({
    where: { id: tool.id },
    data: {
      agreementStatus: status, decision,
      aiStatus: parsed.data.aiStatus, inUse: parsed.data.inUse, notes: parsed.data.notes,
      exhibitOverride: over, decidedBy: user.email, decidedAt: now,
      agreementEndsOn: endsOn, renewalOwnerUserId: renewalOwner,
      vendorContact: parsed.data.vendorContact.trim().slice(0, 200),
    },
  });
  await prisma.decisionEvent.create({
    data: {
      districtId: user.districtId, toolId: tool.id, actor: user.email,
      fromStatus: `${tool.agreementStatus}/${tool.decision}`,
      toStatus: `${status}/${decision}`,
    },
  });
  revalidatePath(`/tools/${tool.id}`);
  revalidatePath("/inventory");
  revalidatePath("/");
  return {};
}

const FILENAME_BLOCK = /student|roster|grade|iep|504|disciplin|attendance|transcript/i;

export async function uploadAgreement(toolId: string, form: FormData): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const tool = await prisma.districtTool.findFirst({ where: { id: toolId, districtId: user.districtId } });
  if (!tool) return { error: "Not found." };
  const file = form.get("file");
  const status = String(form.get("status") || "signed");
  const expiresOn = String(form.get("expires_on") || "");
  if (!(file instanceof File) || file.size === 0) return { error: "No file received." };
  if (file.size > 15 * 1024 * 1024) return { error: "File too large (15 MB max)." };
  if (FILENAME_BLOCK.test(file.name)) {
    return { error: "Refused: uploads are contracts and district documents only. Never upload student records." };
  }
  if (!["signed", "expired", "refused", "not_requested"].includes(status)) return { error: "Invalid status." };
  const buf = Buffer.from(await file.arrayBuffer());
  const key = `agreements/${user.districtId}/${tool.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await putBlob(key, buf, file.type || "application/octet-stream");
  await prisma.agreement.create({
    data: {
      districtId: user.districtId, toolId: tool.id, blobKey: key, kind: "local_upload", status,
      expiresOn: expiresOn ? new Date(expiresOn) : null, uploadedBy: user.email,
    },
  });
  await prisma.districtTool.update({
    where: { id: tool.id },
    data: { agreementStatus: status, decidedBy: user.email, decidedAt: new Date() },
  });
  await prisma.decisionEvent.create({
    data: { districtId: user.districtId, toolId: tool.id, actor: user.email, fromStatus: tool.agreementStatus, toStatus: status },
  });
  revalidatePath(`/tools/${tool.id}`);
  return {};
}

// Alliance pointer (spec 4.2): a second Agreement writer with no file, no
// putBlob, and no fetch. Records kind alliance_pointer plus the council-typed
// registry URL, registry id, and originator, then mirrors uploadAgreement by
// setting DistrictTool.agreementStatus plus a DecisionEvent. blobKey is empty
// only for pointers — never a fake key.
export async function recordAlliancePointer(input: {
  toolId: string;
  registryUrl: string;
  registryId: string;
  originator: string;
  status?: string;
  expiresOn?: string;
}): Promise<{ error?: string; field?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const toolId = (input.toolId || "").trim().slice(0, 100);
  if (!toolId) return { error: "Not found." };
  const status = (input.status || "signed").trim();
  if (!["signed", "expired", "refused", "not_requested"].includes(status)) {
    return { error: "Invalid status.", field: "status" };
  }
  const registryUrl = (input.registryUrl || "").trim().slice(0, 2000);
  if (!isCitationUrlValid(registryUrl)) {
    return { error: "Invalid registry URL: must start with http:// or https://.", field: "registryUrl" };
  }
  const registryId = (input.registryId || "").trim().slice(0, 200);
  if (!registryId) return { error: "Registry id required (1–200 characters).", field: "registryId" };
  const originator = (input.originator || "").trim().slice(0, 200);
  if (!originator) return { error: "Originator required (1–200 characters).", field: "originator" };
  const expiresRaw = (input.expiresOn || "").trim().slice(0, 10);
  if (expiresRaw && !dateRe.test(expiresRaw)) {
    return { error: "Expiry must be YYYY-MM-DD.", field: "expiresOn" };
  }
  for (const v of [registryUrl, registryId, originator]) {
    const blocked = refuseStudentData(v);
    if (blocked) return { error: blocked };
  }
  const tool = await prisma.districtTool.findFirst({ where: { id: toolId, districtId: user.districtId } });
  if (!tool) return { error: "Not found." };
  await prisma.agreement.create({
    data: {
      districtId: user.districtId, toolId: tool.id, blobKey: "", kind: "alliance_pointer",
      status, expiresOn: expiresRaw ? new Date(expiresRaw) : null, uploadedBy: user.email,
      registryUrl, registryId, originator,
    },
  });
  await prisma.districtTool.update({
    where: { id: tool.id },
    data: { agreementStatus: status, decidedBy: user.email, decidedAt: new Date() },
  });
  await prisma.decisionEvent.create({
    data: { districtId: user.districtId, toolId: tool.id, actor: user.email, fromStatus: tool.agreementStatus, toStatus: status },
  });
  revalidatePath(`/tools/${tool.id}`);
  return {};
}
