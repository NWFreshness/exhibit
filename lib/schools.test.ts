import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildingRollup } from "./rollup";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();

/** Building rollup rules live in lib/rollup.ts so page and test share them. */
function rollup(
  schools: Array<{ id: string; name: string }>,
  acks: Array<{ schoolId: string | null; name: string }>,
  viewer: { role: string; schoolId?: string | null }
) {
  return buildingRollup(schools, acks, viewer);
}

describe("building acknowledgment", () => {
  let dId = "", sA = "", sB = "", snapId = "";

  beforeAll(async () => {
    await ensureTestClauses(db);
    const d = await makeDistrict(db, "sch");
    dId = d.id;
    const a = await db.school.create({ data: { districtId: dId, name: "North" } });
    const b = await db.school.create({ data: { districtId: dId, name: "South" } });
    sA = a.id; sB = b.id;
    const asm = (await import("./assembler")).assemble;
    const out = await asm(db, dId);
    const snap = await db.adoptedSnapshot.create({
      data: {
        districtId: dId, adoptedBy: "owner@test", clauseRefs: out.clauseRefs,
        toolHash: out.toolHash, answersHash: out.answersHash, toolTable: [], html: out.html,
      },
    });
    snapId = snap.id;
    await db.trainingAck.create({ data: { districtId: dId, snapshotId: snapId, schoolId: sA, name: "Ana North" } });
    await db.trainingAck.create({ data: { districtId: dId, snapshotId: snapId, schoolId: sB, name: "Bob South" } });
  });
  afterAll(async () => {
    await wipeDistrict(db, dId);
    await db.$disconnect();
  });

  it("two buildings roll up separately", async () => {
    const schools = await db.school.findMany({ where: { districtId: dId } });
    const acks = await db.trainingAck.findMany({ where: { snapshotId: snapId } });
    const r = rollup(schools, acks, { role: "owner" });
    expect(r.find((x) => x.schoolId === sA)).toMatchObject({ count: 1, names: ["Ana North"] });
    expect(r.find((x) => x.schoolId === sB)).toMatchObject({ count: 1, names: ["Bob South"] });
  });

  it("a scoped viewer cannot see another building's names", async () => {
    const schools = await db.school.findMany({ where: { districtId: dId } });
    const acks = await db.trainingAck.findMany({ where: { snapshotId: snapId } });
    const r = rollup(schools, acks, { role: "viewer", schoolId: sA });
    expect(r.find((x) => x.schoolId === sA)?.names).toEqual(["Ana North"]);
    const south = r.find((x) => x.schoolId === sB);
    expect(south?.count).toBe(1);
    expect(south?.names).toBeNull();
  });

  it("signing pins the snapshot id; drafts never rewrite it", async () => {
    const ack = await db.trainingAck.findFirstOrThrow({ where: { name: "Ana North" } });
    expect(ack.snapshotId).toBe(snapId);
    await db.draft.create({
      data: { districtId: dId, clauseRefs: [], toolHash: "new", answersHash: "new", html: "<p>new</p>" },
    });
    const again = await db.trainingAck.findFirstOrThrow({ where: { name: "Ana North" } });
    expect(again.snapshotId).toBe(snapId);
  });
});
