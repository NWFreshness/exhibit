"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sessionUser } from "@/lib/session";
import { isOwner } from "@/lib/tenancy";

const ROLES = ["owner", "curriculum", "sped", "viewer"] as const;

export async function setDomains(districtId: string, domainsCsv: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user) || user.districtId !== districtId) return { error: "Owner only, own district." };
  const domains = domainsCsv.split(/[,\s]+/).map((d) => d.toLowerCase().trim()).filter((d) => d.includes("."));
  if (!domains.length) return { error: "At least one primary domain is required." };
  const free = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com"];
  if (domains.some((d) => free.includes(d))) return { error: "Public mail providers cannot be a login domain." };
  await prisma.district.update({ where: { id: districtId }, data: { allowedDomains: domains } });
  revalidatePath("/council");
  return {};
}

const inviteSchema = z.object({
  email: z.string().email().max(160),
  role: z.enum(ROLES),
  seat: z.string().max(40).optional(),
});

export async function sendInvite(districtId: string, input: { email: string; role: string; seat?: string }): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user) || user.districtId !== districtId) return { error: "Owner only, own district." };
  const parsed = inviteSchema.safeParse({ ...input, email: input.email.toLowerCase().trim() });
  if (!parsed.success) return { error: "Valid email and role required." };
  if (parsed.data.seat && !["technology", "teaching", "sped", "association", "cabinet"].includes(parsed.data.seat)) {
    return { error: "Unknown seat." };
  }
  await prisma.invite.create({
    data: {
      districtId, email: parsed.data.email, role: parsed.data.role,
      seat: parsed.data.seat || null, createdBy: user.email,
    },
  });
  revalidatePath("/council");
  return {};
}

export async function cancelInvite(id: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const inv = await prisma.invite.findFirst({ where: { id, districtId: user.districtId } });
  if (!inv) return { error: "Not found." };
  await prisma.invite.delete({ where: { id } });
  revalidatePath("/council");
  return {};
}

export async function assignSeat(seat: string, email: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const s = await prisma.reviewSeat.findUnique({ where: { districtId_seat: { districtId: user.districtId, seat } } });
  if (!s) return { error: "Unknown seat." };
  const em = email.toLowerCase().trim();
  if (em) {
    const member = await prisma.user.findFirst({ where: { email: em, districtId: user.districtId } });
    if (!member) return { error: "That email is not in this district yet — invite them first." };
  }
  await prisma.reviewSeat.update({ where: { id: s.id }, data: { assignedEmail: em || null } });
  revalidatePath("/council");
  revalidatePath("/review");
  return {};
}

export async function createSchool(name: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const nm = name.trim().slice(0, 120);
  if (!nm) return { error: "Building name required." };
  await prisma.school.create({ data: { districtId: user.districtId, name: nm } });
  revalidatePath("/council");
  revalidatePath("/training");
  return {};
}

export async function setUserSchool(userId: string, schoolId: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  const member = await prisma.user.findFirst({ where: { id: userId, districtId: user.districtId } });
  if (!member) return { error: "Not found." };
  if (schoolId) {
    const s = await prisma.school.findFirst({ where: { id: schoolId, districtId: user.districtId } });
    if (!s) return { error: "Unknown building." };
  }
  await prisma.user.update({ where: { id: member.id }, data: { schoolId: schoolId || null } });
  revalidatePath("/council");
  return {};
}
