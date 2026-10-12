// Clause promotion. A promoted version belongs to the district that promoted
// it: other districts keep reading the shared library row.
import type { PrismaClient } from "@prisma/client";
import { clauseScope } from "./tenancy";

export async function promoteClause(
  db: PrismaClient,
  districtId: string,
  clauseId: string,
  body: string
): Promise<number> {
  const visible = await db.clause.findFirst({
    where: { id: clauseId, ...clauseScope(districtId) },
    orderBy: { version: "desc" },
  });
  if (!visible) throw new Error("Clause not found.");
  // Version numbers are shared across districts: the primary key is (id, version).
  const top = await db.clause.findFirstOrThrow({ where: { id: clauseId }, orderBy: { version: "desc" } });
  const version = top.version + 1;
  await db.clause.create({
    data: {
      id: visible.id, version, districtId, jurisdiction: visible.jurisdiction,
      section: visible.section, title: `${visible.title} (rev ${version})`, body,
    },
  });
  return version;
}
