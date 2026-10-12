// Server-action guards added by the audit (docs/audit-todo.md items 7-10, 14).
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { promises as fs } from "fs";
import path from "path";
import { sessionUser } from "@/lib/session";
import { updateTool, uploadAgreement } from "@/app/actions/tools";
import { signSeat } from "@/app/actions/policy";
import { addTool, confirmImport } from "@/app/actions/inventory";
import { readBlob } from "./store";
import { testDb, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();
const mockSession = vi.mocked(sessionUser);
const as = (districtId: string, email: string) =>
  mockSession.mockResolvedValue({ id: "u", email, districtId, role: "curriculum" });

const base = {
  agreementStatus: "not_requested", decision: "approved", aiStatus: "calls_model",
  inUse: true, notes: "", override: {} as Record<string, string>,
};

describe("audit action guards", () => {
  let dId = "", toolId = "";
  const blobKeys: string[] = [];

  beforeAll(async () => {
    dId = (await makeDistrict(db, "audit")).id;
    toolId = (await db.districtTool.create({ data: { districtId: dId, rawName: "Guarded Tool" } })).id;
    await db.reviewSeat.create({ data: { districtId: dId, seat: "sped", assignedEmail: "sped@audit.test" } });
    await db.reviewSeat.create({ data: { districtId: dId, seat: "teaching" } });
    as(dId, "curriculum@audit.test");
  });
  afterAll(async () => {
    for (const key of blobKeys) await fs.unlink(path.join(process.cwd(), "blob-local", key)).catch(() => {});
    await wipeDistrict(db, dId);
    await db.$disconnect();
  });

  it("approved needs a signed agreement and no training use", async () => {
    expect((await updateTool(toolId, base)).error).toMatch(/signed agreement/);
    expect((await updateTool(toolId, { ...base, agreementStatus: "signed", override: { usedForTraining: "true" } })).error).toMatch(/used for training/);
    expect((await db.districtTool.findUniqueOrThrow({ where: { id: toolId } })).decision).toBe("hold");
    expect(await updateTool(toolId, { ...base, agreementStatus: "signed" })).toEqual({});
    expect((await db.districtTool.findUniqueOrThrow({ where: { id: toolId } })).decision).toBe("approved");
  });

  it("an assigned seat is signed only by its assignee", async () => {
    expect((await signSeat("sped")).error).toMatch(/assigned to sped@audit.test/);
    expect(await signSeat("teaching")).toEqual({});
    as(dId, "sped@audit.test");
    expect(await signSeat("sped")).toEqual({});
    as(dId, "curriculum@audit.test");
  });

  it("an upload's expiry reaches the tool, and a bad date stores nothing", async () => {
    const form = (expires: string) => {
      const fd = new FormData();
      fd.set("file", new File(["contract"], "dpa.pdf", { type: "text/html" }));
      fd.set("expires_on", expires);
      return fd;
    };
    expect((await uploadAgreement(toolId, form("next year"))).error).toMatch(/YYYY-MM-DD/);
    expect(await db.agreement.count({ where: { toolId } })).toBe(0);

    expect(await uploadAgreement(toolId, form("2031-06-30"))).toEqual({});
    const row = await db.agreement.findFirstOrThrow({ where: { toolId } });
    blobKeys.push(row.blobKey);
    const tool = await db.districtTool.findUniqueOrThrow({ where: { id: toolId } });
    expect(tool.agreementEndsOn?.getTime()).toBe(new Date("2031-06-30T00:00:00").getTime());
    expect(await readBlob(row.blobKey)).toEqual({ bytes: Buffer.from("contract") });
    expect(await readBlob("../.env")).toBeNull();
  });

  it("importing or adding the same name twice adds nothing", async () => {
    const rows = [{ name: "Twice Tool", category: "General", catalogId: null }, { name: "twice tool", category: "General", catalogId: null }];
    expect((await confirmImport(rows)).count).toBe(1);
    expect((await confirmImport(rows)).count).toBe(0);
    expect((await addTool("TWICE TOOL", "General")).error).toMatch(/already in the inventory/);
    expect(await db.districtTool.count({ where: { districtId: dId, rawName: { equals: "twice tool", mode: "insensitive" } } })).toBe(1);
  });
});
