import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createToolRequest, openRequestCount } from "./requests";
import { assemble } from "./assembler";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();

describe("teacher tool request", () => {
  let dId = "";
  const other = { id: "x", email: "owner@other", districtId: "", role: "owner" as const };

  beforeAll(async () => {
    await ensureTestClauses(db);
    const d = await makeDistrict(db, "req");
    dId = d.id;
    const o = await db.district.create({ data: { name: "Req Other" } });
    other.districtId = o.id;
  });
  afterAll(async () => {
    await wipeDistrict(db, dId);
    await wipeDistrict(db, other.districtId);
    await db.$disconnect();
  });

  it("a request creates one hold row with unknown AI status, visible to the owner only", async () => {
    const r = await createToolRequest(db, dId, {
      toolName: "Brand New Whiteboard",
      category: "Creation",
      building: "Ridge Elementary",
      intendedUse: "with_students",
      requesterName: "Ms. Frizzle",
      requesterEmail: "frizzle@district.org",
      note: "Want to try it for fractions.",
      actorEmail: "frizzle@district.org",
    });
    expect(r.existing).toBe(false);
    const tool = await db.districtTool.findFirstOrThrow({ where: { id: r.toolId, districtId: dId } });
    expect(tool.decision).toBe("hold");
    expect(tool.aiStatus).toBe("unknown");
    expect(tool.agreementStatus).toBe("not_requested");
    expect(tool.source).toBe("request");
    expect(await openRequestCount(db, dId)).toBe(1);
    // Not visible to another district.
    const leak = await db.districtTool.findFirst({ where: { id: r.toolId, districtId: other.districtId } });
    expect(leak).toBeNull();
  });

  it("a duplicate name links to the existing row and appends the asker", async () => {
    const first = await createToolRequest(db, dId, {
      toolName: "Same Tool Twice", requesterEmail: "one@district.org", actorEmail: "one@district.org",
    });
    const second = await createToolRequest(db, dId, {
      toolName: "same tool twice", requesterEmail: "two@district.org", actorEmail: "two@district.org",
    });
    expect(second.existing).toBe(true);
    expect(second.toolId).toBe(first.toolId);
    const asks = await db.toolRequest.count({ where: { districtToolId: first.toolId } });
    expect(asks).toBe(2);
  });

  it("approving the row marks the draft stale and leaves the snapshot byte-identical", async () => {
    const r = await createToolRequest(db, dId, {
      toolName: "Stale Maker", requesterEmail: "t@district.org", actorEmail: "t@district.org",
    });
    const before = await assemble(db, dId);
    const tools = await db.districtTool.findMany({ where: { districtId: dId } });
    const snap = await db.adoptedSnapshot.create({
      data: {
        districtId: dId, adoptedBy: "owner@test", clauseRefs: before.clauseRefs,
        toolHash: before.toolHash, answersHash: before.answersHash,
        toolTable: JSON.parse(JSON.stringify(tools)), html: before.html,
      },
    });
    await db.districtTool.update({ where: { id: r.toolId }, data: { decision: "approved", decidedBy: "owner@test", decidedAt: new Date() } });
    const after = await assemble(db, dId);
    expect(after.toolHash).not.toBe(before.toolHash);
    const frozen = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: snap.id } });
    expect(frozen.html).toBe(before.html);
    expect(frozen.toolHash).toBe(before.toolHash);
  });

  it("student records in a request are refused", async () => {
    await expect(createToolRequest(db, dId, {
      toolName: "Bad Tool", note: "Here are my IEP notes", actorEmail: "t@district.org",
    })).rejects.toThrow(/Refused/);
  });
});
