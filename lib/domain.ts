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

/** Public mailbox providers: never a district login domain. */
export const FREE_MAIL_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "proton.me", "protonmail.com"];

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

  const existing = await db.user.findUnique({ where: { email } });
  // An invite never moves a user out of the district they already belong to:
  // otherwise any owner could pull another district's staff into their own.
  const invite = await db.invite.findFirst({
    where: { email, acceptedAt: null, ...(existing ? { districtId: existing.districtId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (invite && ROLES.includes(invite.role as (typeof ROLES)[number])) {
    return { districtId: invite.districtId, role: invite.role as LoginResolution["role"], inviteId: invite.id, seat: invite.seat };
  }

  if (existing && ROLES.includes(existing.role as (typeof ROLES)[number])) {
    return { districtId: existing.districtId, role: existing.role as LoginResolution["role"] };
  }

  const domain = domainOf(email);
  if (!domain) return null;
  // Personal-mailbox guard: free providers never match, even if listed by mistake.
  if (FREE_MAIL_DOMAINS.includes(domain)) {
    return null;
  }
  const districts = await db.district.findMany({ select: { id: true, allowedDomains: true } });
  const match = districts.find((d) => d.allowedDomains.map((x) => x.toLowerCase().trim()).includes(domain));
  if (!match) return null;
  return { districtId: match.id, role: "viewer" };
}

/** The sign-in gate plus its writes. Returns false when the email may not sign
 *  in. A magic-link *request* only checks the gate: nothing is written until
 *  the link is used, because typing an email proves nothing about who typed it. */
export async function admitLogin(
  db: PrismaClient,
  rawEmail: string,
  verificationRequest: boolean
): Promise<boolean> {
  const email = rawEmail.toLowerCase().trim();
  if (!email) return false;
  const r = await resolveLogin(db, email);
  if (!r) return false;
  if (verificationRequest) return true;
  const now = new Date();
  await db.user.upsert({
    where: { email },
    update: { districtId: r.districtId, role: r.role },
    create: { email, districtId: r.districtId, role: r.role, createdAt: now },
  });
  if (r.inviteId) {
    await db.invite.update({ where: { id: r.inviteId }, data: { acceptedAt: now } });
    if (r.seat) {
      await db.reviewSeat.upsert({
        where: { districtId_seat: { districtId: r.districtId, seat: r.seat } },
        update: { assignedEmail: email },
        create: { districtId: r.districtId, seat: r.seat, required: false, assignedEmail: email },
      });
    }
  }
  return true;
}

/** True when another district already lists one of these login domains. */
export async function domainClaimedElsewhere(
  db: PrismaClient,
  districtId: string,
  domains: string[]
): Promise<boolean> {
  const other = await db.district.findFirst({
    where: { id: { not: districtId }, allowedDomains: { hasSome: domains } },
    select: { id: true },
  });
  return other !== null;
}
