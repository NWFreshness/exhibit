import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/tenancy";

const ROLES = ["owner", "curriculum", "sped", "viewer"] as const;

export async function sessionUser(): Promise<SessionUser | null> {
  const s = await auth();
  const id = (s?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, include: { district: { select: { name: true } } } });
  if (!u || !ROLES.includes(u.role as (typeof ROLES)[number])) return null;
  return { id: u.id, email: u.email, districtId: u.districtId, role: u.role as SessionUser["role"], districtName: u.district.name, schoolId: u.schoolId };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await sessionUser();
  if (!u) redirect("/signin");
  return u;
}
