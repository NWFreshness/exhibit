import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { GET } from "./route";
import { testDb, wipeDistrict } from "@/lib/testutil";

const db = testDb();
const DAY = 86_400_000;

describe("cron route", () => {
  let dId = "";

  beforeAll(async () => {
    process.env.CRON_SECRET = "test-route-secret";
    const d = await db.district.create({ data: { name: "Cron Dist" } });
    dId = d.id;
    await db.districtTool.create({
      data: { districtId: dId, rawName: "Cron Tool", agreementStatus: "signed", decision: "approved", aiStatus: "calls_model", agreementEndsOn: new Date(Date.now() + 80 * DAY) },
    });
  });
  afterAll(async () => {
    await wipeDistrict(db, dId);
    await db.$disconnect();
  });

  it("rejects without the bearer token", async () => {
    const res = await GET(new Request("http://x/api/cron/renewals"));
    expect(res.status).toBe(401);
  });

  it("flags an 80-day tool when called with the token", async () => {
    const res = await GET(new Request("http://x/api/cron/renewals", {
      headers: { authorization: "Bearer test-route-secret" },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; flagged: number };
    expect(body.ok).toBe(true);
    expect(body.flagged).toBeGreaterThanOrEqual(1);
    expect(await db.renewalFlag.count({ where: { districtId: dId, clearedAt: null } })).toBeGreaterThanOrEqual(1);
  });

  it("makes no outbound HTTP to any vendor", () => {
    for (const f of ["lib/renewals.ts", "app/api/cron/renewals/route.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/fetch\s*\(/);
      expect(src).not.toMatch(/https?:\/\/(?!localhost|vercel|x)/);
    }
  });
});
