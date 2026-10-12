import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { promoteClause } from "./clauses";
import { assemble } from "./assembler";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();

describe("clause promotion stays in its district", () => {
  let aId = "", bId = "";

  beforeAll(async () => {
    await ensureTestClauses(db);
    aId = (await makeDistrict(db, "clause-a")).id;
    bId = (await makeDistrict(db, "clause-b")).id;
  });
  afterAll(async () => {
    await wipeDistrict(db, aId);
    await wipeDistrict(db, bId);
    await db.$disconnect();
  });

  it("district A's promoted text never reaches district B", async () => {
    const before = await assemble(db, bId, { prose: false });
    await promoteClause(db, aId, "minimization", "District A private wording.");
    const a = await assemble(db, aId, { prose: false });
    const b = await assemble(db, bId, { prose: false });
    expect(a.html).toContain("District A private wording.");
    expect(b.html).not.toContain("District A private wording.");
    expect(b.answersHash).toBe(before.answersHash);
    expect(b.clauseRefs).toEqual(before.clauseRefs);
  });

  it("a second district can still promote the same clause", async () => {
    await promoteClause(db, bId, "minimization", "District B wording.");
    expect((await assemble(db, bId, { prose: false })).html).toContain("District B wording.");
    expect((await assemble(db, aId, { prose: false })).html).toContain("District A private wording.");
  });
});
