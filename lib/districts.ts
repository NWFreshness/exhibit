// Operator-only district setup (scripts/create-district.ts). Not reachable
// from any page: creating a tenant is not a self-serve action.
import type { PrismaClient } from "@prisma/client";
import { domainClaimedElsewhere, domainOf, FREE_MAIL_DOMAINS } from "./domain";
import { REQUIRED_SEATS, OPTIONAL_SEATS } from "./seats";

export async function createDistrict(
  db: PrismaClient,
  input: { name: string; ownerEmail: string; state?: string }
): Promise<{ districtId: string; domain: string }> {
  const name = input.name.trim().slice(0, 160);
  const ownerEmail = input.ownerEmail.toLowerCase().trim();
  const domain = domainOf(ownerEmail);
  if (!name) throw new Error("District name is required.");
  if (!domain || !/^[^@\s]+@[^@\s]+$/.test(ownerEmail)) throw new Error("Owner email is invalid.");
  if (FREE_MAIL_DOMAINS.includes(domain)) throw new Error("The owner must use a district email, not a public mail provider.");
  if (await db.user.findUnique({ where: { email: ownerEmail } })) throw new Error("That email already belongs to a district.");
  if (await domainClaimedElsewhere(db, "", [domain])) throw new Error(`The domain ${domain} already belongs to another district.`);
  return db.$transaction(async (tx) => {
    const d = await tx.district.create({ data: { name, state: input.state === "WA" ? "WA" : "common", allowedDomains: [domain] } });
    // The owner signs in through the normal gate: this invite is what makes them owner.
    await tx.invite.create({ data: { districtId: d.id, email: ownerEmail, role: "owner", createdBy: "operator" } });
    await tx.reviewSeat.createMany({
      data: [
        ...REQUIRED_SEATS.map((seat) => ({ districtId: d.id, seat, required: true })),
        ...OPTIONAL_SEATS.map((seat) => ({ districtId: d.id, seat, required: false })),
      ],
    });
    return { districtId: d.id, domain };
  });
}
