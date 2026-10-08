// District-domain login resolution. Decides who a first-time email belongs to.
// Personal accounts are rejected: no invite and no allowed domain means no session.
// Existing users keep their district and role (never downgraded by a login).
import type { PrismaClient } from "@prisma/client";

export type LoginResolution = {
  districtId: string;
  role: "owner" | "curriculum" | "sped" | "viewer";
  inviteId?: string;
  seat?: string | null;
};

const ROLES = ["owner", "curriculum", "sped", "viewer"] as const;

export function domainOf(email: string): string | null {
  const at = email.toLowerCase().trim().lastIndexOf("@");
  if (at < 0) return null;
  const d = email.toLowerCase().trim().slice(at + 1);
  return d.includes(".") ? d : null;
}

export async function resolveLogin(
  db: PrismaClient,
  rawEmail: string
): Promise<LoginResolution | null> {
  const email = rawEmail.toLowerCase().trim();
  if (!email.includes("@")) return null;

  const invite = await db.invite.findFirst({
    where: { email, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (invite && ROLES.includes(invite.role as (typeof ROLES)[number])) {
    return { districtId: invite.districtId, role: invite.role as LoginResolution["role"], inviteId: invite.id, seat: invite.seat };
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing && ROLES.includes(existing.role as (typeof ROLES)[number])) {
    return { districtId: existing.districtId, role: existing.role as LoginResolution["role"] };
  }

  const domain = domainOf(email);
  if (!domain) return null;
  // Personal-mailbox guard: free providers never match, even if listed by mistake.
  if (["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "proton.me", "protonmail.com"].includes(domain)) {
    return null;
  }
  const districts = await db.district.findMany({ select: { id: true, allowedDomains: true } });
  const match = districts.find((d) => d.allowedDomains.map((x) => x.toLowerCase().trim()).includes(domain));
  if (!match) return null;
  return { districtId: match.id, role: "viewer" };
}
