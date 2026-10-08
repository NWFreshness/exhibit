import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { assemble, familyLetter } from "./assembler";
import { llmCalls } from "./llm";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();

describe("assembler", () => {
  let fullId = "", emptyId = "", bareId = "";

  beforeAll(async () => {
    await ensureTestClauses(db);
    const full = await makeDistrict(db, "asm-full");
    fullId = full.id;
    await db.districtTool.create({
      data: { districtId: fullId, rawName: "Quizizz AI", agreementStatus: "signed", decision: "approved", aiStatus: "calls_model", exhibitOverride: { usedForTraining: false, trainingAddressed: true } },
    });
    const empty = await db.district.create({ data: { name: "Asm Empty" } });
    emptyId = empty.id;
    await db.questionnaireAnswer.create({
      data: {
        districtId: emptyId,
        answers: {
          dataRule: "no_student_pii", integrityK5: "red", integrity68: "yellow",
          integrity912: "green", amendmentChoice: "amend_existing",
          toolApprovalClause: "allowlist", disciplineClause: "educational",
          privacyClause: "minimization", staffUseClause: "guardrails", rolesClause: "annual",
        },
      },
    });
    const bare = await db.district.create({ data: { name: "Asm Bare" } });
    bareId = bare.id;
  });
  afterAll(async () => {
    await wipeDistrict(db, fullId);
    await wipeDistrict(db, emptyId);
    await wipeDistrict(db, bareId);
    await db.$disconnect();
  });

  it("assembles eight sections with clause refs, no missing, gate open", async () => {
    llmCalls.length = 0;
    const out = await assemble(db, fullId);
    expect(out.sections).toHaveLength(8);
    expect(out.missing).toEqual([]);
    expect(out.gate).toEqual([]);
    expect(out.clauseRefs.length).toBeGreaterThanOrEqual(6);
    expect(out.clauseRefs.every((r) => r.version === 1)).toBe(true);
    expect(out.html).toContain("Quizizz AI");
    expect(out.sections.every((s) => s.source && s.source.length > 0)).toBe(true);
    expect(out.sections[0].html).toContain("Scope:");
    // Model wrote only the purpose paragraph in this step.
    expect(llmCalls.map((c) => c.kind)).toEqual(["purpose"]);
  });

  it("empty inventory produces an honest draft and a closed gate", async () => {
    const out = await assemble(db, emptyId);
    expect(out.html).toContain("No tool is approved until it clears review");
    expect(out.gate.join(" ")).toMatch(/imported tool list|nothing approved yet/);
  });

  it("missing answers are named, not generated around", async () => {
    const out = await assemble(db, bareId);
    expect(out.missing).toContain("data rule");
    expect(out.missing).toContain("academic integrity K–5");
    expect(out.html).toContain("Missing decision");
    expect(out.gate.length).toBeGreaterThan(0);
  });

  it("model writes only purpose + family, nothing else", async () => {
    llmCalls.length = 0;
    await assemble(db, fullId);
    await familyLetter(db, fullId);
    const kinds = new Set(llmCalls.map((c) => c.kind));
    expect([...kinds].sort()).toEqual(["family", "purpose"]);
  });
});
