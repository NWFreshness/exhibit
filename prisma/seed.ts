// Seed: 15 real K-12 catalog tools (exhibit fields NULL = Unknown, never invented),
// clause library (common + WA), Cedar Ridge sample district + 8 tools + users + answers + seats.
// Usage: DATABASE_URL=... npx tsx prisma/seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CATALOG: Array<[string, string, string, string, string | null]> = [
  // name, vendor, category, typicalAiStatus, sourceUrl
  ["Google Workspace for Education", "Google", "Productivity", "no_model", "https://edu.google.com/workspace-for-education/"],
  ["Microsoft 365 Copilot", "Microsoft", "Productivity", "calls_model", "https://www.microsoft.com/en-us/microsoft-365/copilot"],
  ["Khanmigo (Khan Academy)", "Khan Academy", "Tutoring aid", "calls_model", "https://www.khanacademy.org/khan-labs"],
  ["MagicSchool AI", "MagicSchool", "Teacher planning", "calls_model", "https://www.magicschool.ai/"],
  ["Brisk Teaching", "Brisk", "Teacher workflow", "calls_model", "https://www.briskteaching.com/"],
  ["Diffit", "Diffit", "Differentiation", "calls_model", "https://www.diffit.me/"],
  ["Curipod", "Curipod", "Interactive lessons", "calls_model", "https://curipod.com/"],
  ["Quizizz AI", "Quizizz", "Assessment", "calls_model", "https://www.quizizz.com/"],
  ["Canva Magic Studio", "Canva", "Creation", "calls_model", "https://www.canva.com/magic-studio/"],
  ["Adobe Express (generative AI)", "Adobe", "Creation", "calls_model", "https://www.adobe.com/express/"],
  ["Padlet TA", "Padlet", "Teacher workflow", "calls_model", "https://padlet.com/"],
  ["SchoolAI", "SchoolAI", "Classroom AI", "calls_model", "https://schoolai.com/"],
  ["Snorkl", "Snorkl", "Student explanation", "calls_model", "https://www.snorkl.app/"],
  ["Flint (flintk12)", "Flint", "Classroom AI", "calls_model", "https://www.flintk12.com/"],
  ["NotebookLM", "Google", "Research aid", "calls_model", "https://notebooklm.google/"],
];

const CLAUSES: Array<[string, string, string, string, string]> = [
  // id, jurisdiction, section, title, body
  ["allowlist", "common", "tool_approval", "Allowlist only",
    "Only tools listed as Approved or Limited in the Exhibit may be used with students. Any tool on Hold or not listed is not permitted for student use until it clears review."],
  ["tiered", "common", "tool_approval", "Tiered approval with pilot",
    "Approved tools may be used as documented. Limited tools may be used only within the stated limits. A new tool may be piloted by staff only, without student accounts or student content, pending Exhibit review."],
  ["educational", "common", "discipline", "Educational response first",
    "Suspected misuse of AI on student work is addressed first as an instructional matter: supervised re-do, AI-literacy reteach, and parent notification. Repeated or serious cases follow {{rup_name}}."],
  ["code-aligned", "common", "discipline", "Code-aligned progressive discipline",
    "AI misuse is treated under the existing academic-dishonesty provisions of {{rup_name}}, with the same levels of response and appeal. No automated system alone determines discipline or placement."],
  ["minimization", "common", "privacy", "Data minimization, no-training vendors",
    "Staff do not enter student or staff personal information into AI tools except through Exhibit-approved tools with a signed agreement. The district prioritizes vendors that commit in writing not to train models on district content."],
  ["consent-gated", "common", "privacy", "Consent-gated use",
    "Student use of AI tools that transmit student content requires prior parent notice and, where required, consent, consistent with FERPA and state law. Opt-out students receive an equivalent non-AI alternative."],
  ["guardrails", "common", "staff_use", "Professional-use guardrails",
    "Staff may use approved AI tools for planning, drafting, and feedback. Staff review all AI output for accuracy, disclose material AI assistance on request, and never enter personal information of students or colleagues."],
  ["transparency", "common", "staff_use", "Transparency and disclosure",
    "Staff disclose AI assistance on public-facing and evaluative documents as directed by {{owner_name}}, verify sources independently of the model, and retain final professional judgment."],
  ["annual", "common", "roles", "Annual review",
    "{{owner_name}} reviews the Exhibit at least annually and after any vendor agreement change, and reports changes to the board."],
  ["semiannual", "common", "roles", "Semiannual review with incident log",
    "{{owner_name}} reviews the Exhibit semiannually, keeps a log of AI-related incidents, and briefs the board on any tool moved to Limited, Banned, or Hold."],
  ["amend_rup", "common", "amendment", "Amend the existing responsible-use policy",
    "Amend {{rup_name}} by adding: AI-tool use with district systems or student work is governed by the adopted AI Exhibit. Tools not listed as Approved or Limited are prohibited for student use."],
  ["amend_rup_wa", "WA", "amendment", "Amend the existing policy (Washington)",
    "Amend {{rup_name}} as above. Washington note: a separate AI acceptable-use policy is optional; this amendment satisfies the requirement."],
  ["separate_aup", "common", "amendment", "Separate AI acceptable-use policy",
    "The district adopts this AI acceptable-use policy as a companion to {{rup_name}}. Where they conflict on AI tools, this policy governs listed tools."],
  ["dpa_request", "common", "dpa", "No-training addendum request",
    "Dear {{vendor_contact}}, {{district_name}} uses {{tool_name}} with staff and students. Before this tool can stay approved, please sign our no-training addendum — confirming district content is never used to train models — or confirm in writing that our content is used for inference only, with retention of {{retention}} and deletion on request. Without a signed agreement the tool stays on hold. Thank you, {{owner_name}}, {{date}}."],
];

async function main() {
  if ((await prisma.catalogTool.count()) === 0) {
    for (const [name, vendor, category, typicalAiStatus, sourceUrl] of CATALOG) {
      await prisma.catalogTool.create({
        data: { name, vendor, category, typicalAiStatus, sourceUrl },
      });
    }
  }
  for (const [id, jurisdiction, section, title, body] of CLAUSES) {
    await prisma.clause.upsert({
      where: { id_version: { id, version: 1 } },
      update: {},
      create: { id, version: 1, jurisdiction, section, title, body },
    });
  }
  if (!(await prisma.district.findUnique({ where: { id: "d-cedar" } }))) {
    await prisma.district.create({
      data: { id: "d-cedar", name: "Cedar Ridge School District", studentMax: 4200, state: "WA", allowedDomains: ["cedarridge.example"] },
    });
    const users: Array<[string, string, string]> = [
      ["director@cedarridge.example", "owner", "u-cedar-owner"],
      ["curriculum@cedarridge.example", "curriculum", "u-cedar-curr"],
      ["sped@cedarridge.example", "sped", "u-cedar-sped"],
      ["board@cedarridge.example", "viewer", "u-cedar-view"],
    ];
    for (const [email, role, id] of users) {
      await prisma.user.create({ data: { id, email, districtId: "d-cedar", role } });
    }
    const cat = await prisma.catalogTool.findMany();
    const byName = Object.fromEntries(cat.map((c) => [c.name, c.id]));
    const tools: Array<[string, string, string, string, string, string, object | null]> = [
      // rawName, agreement, decision, aiStatus, notes, decidedBy, exhibitOverride
      ["Google Workspace for Education", "signed", "hold", "no_model", "Core suite without AI add-ons. Out of AI scope; governed by existing RUP. [sample data]", "director@cedarridge.example", null],
      ["Khanmigo (Khan Academy)", "signed", "limited", "calls_model", "Grades 6-12 pilot classrooms only. [sample data]", "director@cedarridge.example", null],
      ["MagicSchool AI", "not_requested", "hold", "calls_model", "Staff interest; no agreement yet. [sample data]", "director@cedarridge.example", null],
      ["Brisk Teaching", "expired", "hold", "calls_model", "Renewal pending. [sample data]", "director@cedarridge.example", null],
      ["Diffit", "refused", "banned", "calls_model", "Vendor would not sign no-training addendum. [sample data]", "director@cedarridge.example", null],
      ["Quizizz AI", "signed", "approved", "calls_model", "Assessment use. District-confirmed no training use. [sample data]", "director@cedarridge.example", { usedForTraining: false }],
      ["Canva Magic Studio", "not_requested", "hold", "unknown", "Awaiting verification. [sample data]", "director@cedarridge.example", null],
      ["SchoolAI", "expired", "hold", "calls_model", "Pilot ended; agreement lapsed. [sample data]", "director@cedarridge.example", null],
    ];
    const t = new Date();
    for (const [nm, agr, dec, ai, note, by, over] of tools) {
      await prisma.districtTool.create({
        data: {
          districtId: "d-cedar", catalogToolId: byName[nm] ?? null, rawName: nm,
          agreementStatus: agr, decision: dec, aiStatus: ai, notes: note,
          decidedBy: by, decidedAt: t, exhibitOverride: over ?? undefined,
        },
      });
    }
    await prisma.questionnaireAnswer.create({
      data: {
        districtId: "d-cedar",
        answers: {
          stance: "guided_use", whoMayUse: "staff_and_students",
          integrityK5: "red", integrity68: "yellow", integrity912: "green",
          dataRule: "no_student_pii", noTrainingRule: "require_addendum",
          noSoleDecision: true, disclosure: "required", ownerName: "Technology Director",
          reviewCadence: "annual", rupName: "Responsible Use Policy (Policy 4520)",
          amendmentChoice: "amend_existing", nothingApproved: false,
          toolApprovalClause: "allowlist", disciplineClause: "educational",
          privacyClause: "minimization", staffUseClause: "guardrails", rolesClause: "annual",
        },
      },
    });
    for (const [seat, required] of [["technology", true], ["teaching", true], ["sped", true], ["association", false], ["cabinet", false]] as Array<[string, boolean]>) {
      await prisma.reviewSeat.create({ data: { districtId: "d-cedar", seat, required } });
    }
    for (const name of ["Ridge Elementary", "Cedar Middle", "Ridgeview High"]) {
      await prisma.school.create({ data: { districtId: "d-cedar", name } });
    }
  }
  console.log("seed ok");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
