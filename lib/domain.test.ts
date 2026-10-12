import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { resolveLogin, domainClaimedElsewhere, admitLogin, FREE_MAIL_DOMAINS } from "./domain";
import { testDb, wipeDistrict } from "./testutil";

const db = testDb();

describe("district-domain login", () => {
  let aId = "", bId = "";

  beforeAll(async () => {
    const a = await db.district.create({ data: { name: "Dom A", allowedDomains: ["ridge.example"] } });
    const b = await db.district.create({ data: { name: "Dom B", allowedDomains: ["valley.example"] } });
    aId = a.id; bId = b.id;
    await db.user.create({ data: { email: "owner@ridge.example", districtId: aId, role: "owner" } });
    await db.invite.create({ data: { districtId: aId, email: "coach@ridge.example", role: "curriculum", createdBy: "owner@ridge.example" } });
  });
  afterAll(async () => {
    await wipeDistrict(db, aId);
    await wipeDistrict(db, bId);
    await db.$disconnect();
  });

  it("an invited curriculum user lands with the invited role", async () => {
    const r = await resolveLogin(db, "coach@ridge.example");
    expect(r).toMatchObject({ districtId: aId, role: "curriculum" });
  });
  it("an allowed-domain teacher joins as viewer", async () => {
    const r = await resolveLogin(db, "teacher@ridge.example");
    expect(r).toMatchObject({ districtId: aId, role: "viewer" });
  });
  it("a personal Gmail account is rejected", async () => {
    expect(await resolveLogin(db, "someone@gmail.com")).toBeNull();
    expect(FREE_MAIL_DOMAINS).toContain("proton.me");
  });
  it("an outside domain cannot create a session", async () => {
    expect(await resolveLogin(db, "stranger@other.org")).toBeNull();
  });
  it("an existing user keeps district and role on next login", async () => {
    const r = await resolveLogin(db, "owner@ridge.example");
    expect(r).toMatchObject({ districtId: aId, role: "owner" });
  });
  it("District A's domain cannot open District B", async () => {
    const r = await resolveLogin(db, "teacher@ridge.example");
    expect(r?.districtId).not.toBe(bId);
    const rb = await resolveLogin(db, "principal@valley.example");
    expect(rb).toMatchObject({ districtId: bId, role: "viewer" });
  });
  it("another district's invite cannot move an existing user", async () => {
    await db.invite.create({ data: { districtId: bId, email: "owner@ridge.example", role: "viewer", createdBy: "owner@valley.example" } });
    const r = await resolveLogin(db, "owner@ridge.example");
    expect(r).toMatchObject({ districtId: aId, role: "owner" });
    expect(r?.inviteId).toBeUndefined();
  });
  it("asking for a magic link writes nothing; using it does", async () => {
    expect(await admitLogin(db, "coach@ridge.example", true)).toBe(true);
    expect(await db.user.findUnique({ where: { email: "coach@ridge.example" } })).toBeNull();
    expect(await db.invite.count({ where: { email: "coach@ridge.example", acceptedAt: null } })).toBe(1);
    expect(await admitLogin(db, "stranger@other.org", true)).toBe(false);

    expect(await admitLogin(db, "coach@ridge.example", false)).toBe(true);
    expect(await db.user.findUnique({ where: { email: "coach@ridge.example" } })).toMatchObject({ districtId: aId, role: "curriculum" });
    expect(await db.invite.count({ where: { email: "coach@ridge.example", acceptedAt: null } })).toBe(0);
  });
  it("a domain listed by one district cannot be claimed by another", async () => {
    expect(await domainClaimedElsewhere(db, bId, ["new.example", "ridge.example"])).toBe(true);
    expect(await domainClaimedElsewhere(db, aId, ["ridge.example"])).toBe(false);
  });
});
