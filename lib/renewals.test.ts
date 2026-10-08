import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { runRenewalPass, openRenewalCount } from "./renewals";
import { assemble } from "./assembler";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();
const DAY = 86_400_000;

describe("renewal pass", () => {
  let dId = "", otherId = "";

  beforeAll(async () => {
    await ensureTestClauses(db);
    const d = await makeDistrict(db, "ren");
    dId = d.id;
    const o = await db.district.create({ data: { name: "Ren Other" } });
    otherId = o.id;
    const in80 = new Date(Date.now() + 80 * DAY);
    const past = new Date(Date.now() - 5 * DAY);
    await db.districtTool.create({
      data: { districtId: dId, rawName: "Ends Soon Tool", agreementStatus: "signed", decision: "approved", aiStatus: "calls_model", agreementEndsOn: in80 },
    });
    await db.districtTool.create({
      data: { districtId: dId, rawName: "Lapsed Tool", agreementStatus: "signed", decision: "approved", aiStatus: "calls_model", agreementEndsOn: past },
    });
    await db.districtTool.create({
      data: { districtId: dId, rawName: "Hold Tool", agreementStatus: "not_requested", decision: "hold", aiStatus: "unknown" },
    });
    await db.districtTool.create({
      data: { districtId: otherId, rawName: "Other Tool", agreementStatus: "signed", decision: "approved", aiStatus: "calls_model", agreementEndsOn: past },
    });
  });
  afterAll(async () => {
    await wipeDistrict(db, dId);
    await wipeDistrict(db, otherId);
    await db.$disconnect();
  });

  it("flags ends-soon, expired, and still-hold without touching other districts", async () => {
    const r = await runRenewalPass(db, dId);
    expect(r.flagged).toBe(3);
    const reasons = (await db.renewalFlag.findMany({ where: { districtId: dId, clearedAt: null }, include: { districtTool: true } }))
      .map((f) => `${f.districtTool.rawName}=${f.reason}`).sort();
    expect(reasons).toEqual(["Ends Soon Tool=ends_soon", "Hold Tool=still_hold", "Lapsed Tool=expired"]);
    expect(await openRenewalCount(db, dId)).toBe(3);
    // The cron scoped to A never flags B's rows.
    expect(await db.renewalFlag.count({ where: { districtId: otherId } })).toBe(0);
  });

  it("a lapsed approval is forced to hold and the draft goes stale", async () => {
    const lapsed = await db.districtTool.findFirstOrThrow({ where: { districtId: dId, rawName: "Lapsed Tool" } });
    // Put it back to approved with a lapsed end date, then snapshot that state.
    await db.districtTool.update({ where: { id: lapsed.id }, data: { decision: "approved", agreementStatus: "signed" } });
    await db.renewalFlag.deleteMany({ where: { districtToolId: lapsed.id } });
    const before = await assemble(db, dId);
    const snap = await db.adoptedSnapshot.create({
      data: {
        districtId: dId, adoptedBy: "owner@test", clauseRefs: before.clauseRefs,
        toolHash: before.toolHash, answersHash: before.answersHash,
        toolTable: [], html: before.html,
      },
    });
    const r = await runRenewalPass(db, dId);
    expect(r.forcedHold).toBe(1);
    const after = await db.districtTool.findFirstOrThrow({ where: { id: lapsed.id } });
    expect(after.decision).toBe("hold");
    expect(after.agreementStatus).toBe("expired");
    const live = await assemble(db, dId);
    expect(live.toolHash).not.toBe(snap.toolHash);
    const frozen = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: snap.id } });
    expect(frozen.html).toBe(before.html);
    expect(frozen.toolHash).toBe(before.toolHash);
  });

  it("resolving a condition clears its flag on the next pass", async () => {
    const soon = await db.districtTool.findFirstOrThrow({ where: { districtId: dId, rawName: "Ends Soon Tool" } });
    await db.districtTool.update({ where: { id: soon.id }, data: { agreementEndsOn: new Date(Date.now() + 400 * DAY) } });
    const r = await runRenewalPass(db, dId);
    expect(r.cleared).toBeGreaterThanOrEqual(1);
    expect(await db.renewalFlag.count({ where: { districtToolId: soon.id, clearedAt: null } })).toBe(0);
  });
});
