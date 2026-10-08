import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { testDb, wipeDistrict } from "./testutil";
import { districtOf, scope, canWrite, TenantDenied } from "./tenancy";

const db = testDb();

describe("tenancy", () => {
  let aId = "", bId = "", toolB = "";
  const userA = { id: "u", email: "a@x", districtId: "", role: "owner" as const };

  beforeAll(async () => {
    const a = await db.district.create({ data: { name: "Tenant A" } });
    const b = await db.district.create({ data: { name: "Tenant B" } });
    aId = a.id; bId = b.id;
    userA.districtId = aId;
    const t = await db.districtTool.create({
      data: { districtId: bId, rawName: "B secret tool", agreementStatus: "signed", decision: "approved" },
    });
    toolB = t.id;
  });
  afterAll(async () => {
    await wipeDistrict(db, aId);
    await wipeDistrict(db, bId);
    await db.$disconnect();
  });

  it("District A cannot read District B rows", async () => {
    const leak = await db.districtTool.findFirst({ where: { id: toolB, ...scope(userA) } });
    expect(leak).toBeNull();
    const own = await db.districtTool.findMany({ where: { ...scope(userA) } });
    expect(own.every((t) => t.districtId === aId)).toBe(true);
  });

  it("unscoped access is a review failure: scope always carries districtId", () => {
    expect(scope(userA)).toEqual({ districtId: aId });
    expect(() => districtOf(null)).toThrow(TenantDenied);
  });

  it("write roles are owner/curriculum/sped; viewer is read-only", () => {
    expect(canWrite({ ...userA, role: "owner" })).toBe(true);
    expect(canWrite({ ...userA, role: "curriculum" })).toBe(true);
    expect(canWrite({ ...userA, role: "sped" })).toBe(true);
    expect(canWrite({ ...userA, role: "viewer" })).toBe(false);
  });

  it("comments and seats are district-scoped too", async () => {
    await db.comment.create({
      data: { districtId: bId, targetType: "tool", targetId: toolB, kind: "accept", author: "b@x" },
    });
    const seen = await db.comment.findMany({ where: { ...scope(userA) } });
    expect(seen.length).toBe(0);
  });
});
