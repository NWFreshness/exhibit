// Test-only helpers. Never imported by app code.
import { PrismaClient } from "@prisma/client";

export function testDb(): PrismaClient {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL_TEST ??
    "postgresql://exhibit:exhibit@localhost:5433/exhibit_test";
  return new PrismaClient();
}

const NEEDED: Array<[string, string, string, string]> = [
  ["allowlist", "tool_approval", "Allowlist only", "Only approved tools."],
  ["educational", "discipline", "Educational response first", "Instruction first under {{rup_name}}."],
  ["minimization", "privacy", "Data minimization", "No personal info in AI tools."],
  ["guardrails", "staff_use", "Professional-use guardrails", "Staff review output."],
  ["annual", "roles", "Annual review", "{{owner_name}} reviews annually."],
  ["amend_rup", "amendment", "Amend RUP", "Amend {{rup_name}} for AI tools."],
];

export async function ensureTestClauses(db: PrismaClient) {
  for (const [id, section, title, body] of NEEDED) {
    await db.clause.upsert({
      where: { id_version: { id, version: 1 } },
      update: {},
      create: { id, version: 1, jurisdiction: "common", section, title, body },
    });
  }
}

export async function makeDistrict(db: PrismaClient, tag: string) {
  const d = await db.district.create({ data: { name: `Test ${tag} ${Date.now()}` } });
  await db.questionnaireAnswer.create({
    data: {
      districtId: d.id,
      answers: {
        dataRule: "no_student_pii", integrityK5: "red", integrity68: "yellow",
        integrity912: "green", toolApprovalClause: "allowlist",
        disciplineClause: "educational", privacyClause: "minimization",
        staffUseClause: "guardrails", rolesClause: "annual",
        amendmentChoice: "amend_existing", rupName: "RUP", ownerName: "Director",
        reviewCadence: "annual", nothingApproved: false,
      },
    },
  });
  return d;
}

export async function wipeDistrict(db: PrismaClient, id: string) {
  await db.district.deleteMany({ where: { id } });
}
