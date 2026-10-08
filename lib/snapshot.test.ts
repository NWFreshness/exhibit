import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { assemble } from "./assembler";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();

describe("snapshot immutability + staleness", () => {
  let dId = "", toolId = "", snapId = "";

  beforeAll(async () => {
    await ensureTestClauses(db);
    const d = await makeDistrict(db, "snap");
    dId = d.id;
    const t = await db.districtTool.create({
      data: { districtId: dId, rawName: "Diffit", agreementStatus: "signed", decision: "limited", aiStatus: "calls_model" },
    });
    toolId = t.id;
  });
  afterAll(async () => {
    await wipeDistrict(db, dId);
    await db.$disconnect();
  });

  it("adopt stores clause ids/versions, tool hash, html; later edits leave it unchanged and mark draft stale", async () => {
    const first = await assemble(db, dId);
    const tools = await db.districtTool.findMany({ where: { districtId: dId } });
    const snap = await db.adoptedSnapshot.create({
      data: {
        districtId: dId, adoptedBy: "owner@test",
        clauseRefs: first.clauseRefs, toolHash: first.toolHash,
        answersHash: first.answersHash, toolTable: JSON.parse(JSON.stringify(tools)),
        html: first.html,
      },
    });
    snapId = snap.id;

    // Later inventory edit.
    await db.districtTool.update({
      where: { id: toolId },
      data: { decision: "banned", decidedBy: "owner@test", decidedAt: new Date() },
    });

    // Snapshot row is byte-identical.
    const again = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: snapId } });
    expect(again.html).toBe(first.html);
    expect(again.toolHash).toBe(first.toolHash);

    // Working draft is stale: hash moved.
    const second = await assemble(db, dId);
    expect(second.toolHash).not.toBe(again.toolHash);
    expect(second.html).toContain("BANNED");
    expect(again.html).not.toContain("BANNED");
  });
});
