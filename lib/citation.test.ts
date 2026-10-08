import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { promises as fs } from "fs";
import path from "path";
import { sessionUser } from "@/lib/session";
import { citeFinding, adoptSnapshot } from "@/app/actions/policy";
import { evaluateRubric, inCitationQueue, mergedExhibit } from "./rubric";
import { assemble, toolTableHash } from "./assembler";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();
const mockSession = vi.mocked(sessionUser);

type Role = "owner" | "curriculum" | "sped" | "viewer";

function as(districtId: string, role: Role, email?: string) {
  const e = email ?? `${role}@cite.test`;
  mockSession.mockResolvedValue({ id: `u-${role}`, email: e, districtId, role });
}

const URL = "https://vendor.example/dpa/no-training";
const DATE = "2026-10-08";

describe("citeFinding server action", () => {
  let dA = "", dB = "";
  let tCite = "", tViewer = "", tBadUrl = "", tStudent = "", tNoDate = "";
  let tFull = "", tUnused = "", tB = "", tPin = "";
  const blobKeys: string[] = [];

  beforeAll(async () => {
    await ensureTestClauses(db);
    dA = (await makeDistrict(db, "cite-a")).id;
    dB = (await makeDistrict(db, "cite-b")).id;
    const mk = (districtId: string, rawName: string, data: Record<string, unknown>) =>
      db.districtTool.create({
        data: { districtId, rawName, aiStatus: "calls_model", agreementStatus: "signed", decision: "hold", inUse: true, notes: "", ...data },
      });
    tCite = (await mk(dA, "Cite Me", {})).id;
    tViewer = (await mk(dA, "Viewer Tool", {})).id;
    tBadUrl = (await mk(dA, "Bad Url Tool", {})).id;
    tStudent = (await mk(dA, "Student Data Tool", {})).id;
    tNoDate = (await mk(dA, "No Date Tool", {})).id;
    tFull = (await mk(dA, "Full Tool", { exhibitOverride: { usedForTraining: false, trainingAddressed: true } })).id;
    tUnused = (await mk(dA, "Retired Tool", { inUse: false })).id;
    tB = (await mk(dB, "Other District Tool", {})).id;
    tPin = (await mk(dA, "Pin Tool", {})).id;
    // Adopt needs an unlocked board: sign every required seat.
    for (const seat of ["technology", "teaching", "sped"]) {
      await db.reviewSeat.create({ data: { districtId: dA, seat, required: true, signedAt: new Date(), signedBy: "owner@cite.test" } });
    }
  });

  afterAll(async () => {
    for (const key of blobKeys) {
      await fs.unlink(path.join(process.cwd(), "blob-local", key)).catch(() => {});
    }
    await wipeDistrict(db, dA);
    await wipeDistrict(db, dB);
    await db.$disconnect();
  });

  const overOf = async (id: string) =>
    ((await db.districtTool.findUniqueOrThrow({ where: { id } })).exhibitOverride ?? {}) as Record<string, unknown>;

  it("curriculum cites a queued tool: finding + triple written, actor is the session email, row leaves the queue", async () => {
    as(dA, "curriculum");
    const res = await citeFinding({ toolId: tCite, usedForTraining: "false", trainingAddressed: "true", citationUrl: URL, citationDate: DATE });
    expect(res).toEqual({});
    const over = await overOf(tCite);
    expect(over).toMatchObject({ usedForTraining: false, trainingAddressed: true, citationUrl: URL, citationDate: DATE, citedBy: "curriculum@cite.test" });
    const tool = await db.districtTool.findUniqueOrThrow({ where: { id: tCite } });
    expect(tool.notes).toBe("");
    const merged = mergedExhibit(null, over);
    expect(inCitationQueue(merged, tool.agreementStatus)).toBe(false);
    expect(evaluateRubric({ aiStatus: "calls_model", agreementStatus: "signed", usedForTraining: false, agreementAddressesTraining: true }).verdict).toBe("clear");
  });

  it("viewer POST is refused with the read-only error and writes nothing", async () => {
    as(dA, "viewer", "board@cite.test");
    const res = await citeFinding({ toolId: tViewer, usedForTraining: "false", trainingAddressed: "true", citationUrl: URL, citationDate: DATE });
    expect(res.error).toMatch(/Read-only/);
    expect(await overOf(tViewer)).toEqual({});
  });

  it("cross-district write fails closed with a generic not-found and writes nothing", async () => {
    as(dA, "curriculum");
    const res = await citeFinding({ toolId: tB, usedForTraining: "false", trainingAddressed: "true", citationUrl: URL, citationDate: DATE });
    expect(res).toEqual({ error: "Not found." });
    expect(await overOf(tB)).toEqual({});
  });

  it("district A's queue never lists district B tools", async () => {
    const tools = await db.districtTool.findMany({ where: { districtId: dA, inUse: true }, include: { catalogTool: true } });
    const queuedIds = tools
      .filter((t) => inCitationQueue(mergedExhibit(t.catalogTool ?? null, (t.exhibitOverride ?? {}) as Record<string, unknown>), t.agreementStatus))
      .map((t) => t.id);
    expect(queuedIds).not.toContain(tB);
    expect(queuedIds).toContain(tViewer);
  });

  it("non-http(s) and empty URLs are rejected with a field error and write nothing", async () => {
    as(dA, "curriculum");
    for (const bad of ["javascript:alert(1)", "vendor.example/dpa", ""]) {
      const res = await citeFinding({ toolId: tBadUrl, usedForTraining: "false", citationUrl: bad, citationDate: DATE });
      expect(res.field).toBe("citationUrl");
      expect(res.error).toMatch(/http/);
    }
    expect(await overOf(tBadUrl)).toEqual({});
    const t = await db.districtTool.findUniqueOrThrow({ where: { id: tBadUrl } });
    expect(inCitationQueue(mergedExhibit(null, (t.exhibitOverride ?? {}) as Record<string, unknown>), t.agreementStatus)).toBe(true);
  });

  it("citation input with student records is refused and writes nothing", async () => {
    as(dA, "curriculum");
    const res = await citeFinding({ toolId: tStudent, usedForTraining: "false", citationUrl: "https://vendor.example/IEP", citationDate: DATE });
    expect(res.error).toMatch(/Refused/);
    expect(await overOf(tStudent)).toEqual({});
  });

  it("missing date defaults to today (server date, YYYY-MM-DD)", async () => {
    as(dA, "curriculum");
    const today = new Date().toISOString().slice(0, 10);
    const res = await citeFinding({ toolId: tNoDate, usedForTraining: "false", trainingAddressed: "true", citationUrl: URL, citationDate: "" });
    expect(res).toEqual({});
    expect((await overOf(tNoDate)).citationDate).toBe(today);
  });

  it("already-cited and not-in-use tools are refused with no write", async () => {
    as(dA, "curriculum");
    expect((await citeFinding({ toolId: tFull, usedForTraining: "false", citationUrl: URL, citationDate: DATE })).error)
      .toMatch(/not in the citation queue/);
    expect((await citeFinding({ toolId: tUnused, usedForTraining: "false", citationUrl: URL, citationDate: DATE })).error)
      .toMatch(/not in the citation queue/);
    expect(await overOf(tFull)).toEqual({ usedForTraining: false, trainingAddressed: true });
  });

  it("a citation change marks the draft stale: toolTableHash covers the override", async () => {
    const row = { rawName: "Hash Tool", aiStatus: "calls_model", agreementStatus: "signed", decision: "hold", catalogToolId: null, inUse: true, exhibitOverride: null };
    const before = toolTableHash([row]);
    const after = toolTableHash([{ ...row, exhibitOverride: { usedForTraining: false, citationUrl: URL, citationDate: DATE, citedBy: "c@x" } }]);
    expect(after).not.toBe(before);
    expect(toolTableHash([row])).toBe(before);
  });

  it("adopt pins the citation triple; later live edits leave the snapshot byte-identical and mark the draft stale", async () => {
    as(dA, "curriculum");
    const cited = await citeFinding({ toolId: tPin, usedForTraining: "false", trainingAddressed: "true", citationUrl: URL, citationDate: DATE });
    expect(cited).toEqual({});
    as(dA, "owner", "owner@cite.test");
    const adopted = await adoptSnapshot();
    expect(adopted.error).toBeUndefined();
    const snap = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: adopted.id! } });
    if (snap.exportKey) blobKeys.push(snap.exportKey);
    const rows = snap.toolTable as Array<Record<string, unknown>>;
    const pinned = rows.find((r) => r.rawName === "Pin Tool");
    expect(pinned).toMatchObject({ citationUrl: URL, citationDate: DATE, citedBy: "curriculum@cite.test" });
    const frozenTable = JSON.stringify(snap.toolTable);
    const frozenHtml = snap.html;

    // Later live edit to the override.
    const live = await overOf(tPin);
    await db.districtTool.update({ where: { id: tPin }, data: { exhibitOverride: JSON.parse(JSON.stringify({ ...live, citationUrl: "https://vendor.example/updated" })) } });

    const again = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: snap.id } });
    expect(JSON.stringify(again.toolTable)).toBe(frozenTable);
    expect(again.html).toBe(frozenHtml);
    const now = await assemble(db, dA);
    expect(now.toolHash).not.toBe(snap.toolHash);
  });
});
