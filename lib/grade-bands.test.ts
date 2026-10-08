import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { promises as fs } from "fs";
import path from "path";
import { sessionUser } from "@/lib/session";
import { updateTool } from "@/app/actions/tools";
import { adoptSnapshot } from "@/app/actions/policy";
import { assemble, toolTableHash, resolveBand, resolvedToolBands } from "./assembler";
import { buildToolGuides } from "./guides";
import { buildTrainingPacket } from "./training";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();
const mockSession = vi.mocked(sessionUser);

type Role = "owner" | "curriculum" | "sped" | "viewer";

function as(districtId: string, role: Role, email?: string) {
  const e = email ?? `${role}@bands.test`;
  mockSession.mockResolvedValue({ id: `u-${role}`, email: e, districtId, role });
}

const BASE = {
  agreementStatus: "signed",
  decision: "limited",
  aiStatus: "calls_model",
  inUse: true,
  notes: "",
  override: {},
  integrityK5: "",
  integrity68: "",
  integrity912: "",
};

describe("grade-band overrides", () => {
  let dA = "", dB = "";
  let tBand = "", tViewer = "", tBad = "", tClear = "", tB = "", tPin = "", tHash = "";
  const blobKeys: string[] = [];

  beforeAll(async () => {
    await ensureTestClauses(db);
    dA = (await makeDistrict(db, "bands-a")).id;
    dB = (await makeDistrict(db, "bands-b")).id;
    const mk = (districtId: string, rawName: string, data: Record<string, unknown> = {}) =>
      db.districtTool.create({
        data: {
          districtId, rawName, aiStatus: "calls_model", agreementStatus: "signed",
          decision: "limited", inUse: true, notes: "", ...data,
        },
      });
    tBand = (await mk(dA, "Band Tool")).id;
    tViewer = (await mk(dA, "Viewer Band Tool")).id;
    tBad = (await mk(dA, "Bad Band Tool")).id;
    tClear = (await mk(dA, "Clear Band Tool", { integrityK5Override: "red" })).id;
    tB = (await mk(dB, "Other District Band Tool")).id;
    tPin = (await mk(dA, "Pin Band Tool")).id;
    tHash = (await mk(dA, "Hash Band Tool")).id;
    for (const seat of ["technology", "teaching", "sped"]) {
      await db.reviewSeat.create({
        data: { districtId: dA, seat, required: true, signedAt: new Date(), signedBy: "owner@bands.test" },
      });
    }
  });

  afterAll(async () => {
    for (const key of blobKeys) {
      await fs.unlink(path.join(process.cwd(), "blob-local", key)).catch(() => {});
    }
    await wipeDistrict(db, dA).catch(() => {});
    await wipeDistrict(db, dB).catch(() => {});
    await db.$disconnect();
  });

  it("resolveBand: override wins, else questionnaire, else null", () => {
    expect(resolveBand("red", "green")).toBe("red");
    expect(resolveBand(null, "yellow")).toBe("yellow");
    expect(resolveBand("", "green")).toBe("green");
    expect(resolveBand(null, null)).toBeNull();
    expect(resolveBand("purple", "green")).toBe("green");
    expect(resolveBand("purple", null)).toBeNull();
    expect(resolvedToolBands(
      { integrityK5Override: "red", integrity68Override: null, integrity912Override: null },
      { integrityK5: "green", integrity68: "yellow", integrity912: "green" }
    )).toEqual({ integrityK5: "red", integrity68: "yellow", integrity912: "green" });
  });

  it("a council writer sets per-tool bands; blank inherits", async () => {
    as(dA, "curriculum");
    const res = await updateTool(tBand, { ...BASE, integrityK5: "red", integrity912: "green" });
    expect(res).toEqual({});
    const row = await db.districtTool.findUniqueOrThrow({ where: { id: tBand } });
    expect(row.integrityK5Override).toBe("red");
    expect(row.integrity68Override).toBeNull();
    expect(row.integrity912Override).toBe("green");
  });

  it("a viewer POST is refused and writes nothing", async () => {
    as(dA, "viewer");
    const res = await updateTool(tViewer, { ...BASE, integrityK5: "red" });
    expect(res.error).toMatch(/Read-only/);
    const row = await db.districtTool.findUniqueOrThrow({ where: { id: tViewer } });
    expect(row.integrityK5Override).toBeNull();
  });

  it("an invalid band value is rejected and writes nothing", async () => {
    as(dA, "curriculum");
    const res = await updateTool(tBad, { ...BASE, integrityK5: "purple" });
    expect(res.error).toMatch(/Invalid values/);
    const row = await db.districtTool.findUniqueOrThrow({ where: { id: tBad } });
    expect(row.integrityK5Override).toBeNull();
  });

  it("blank clears an override back to inherit", async () => {
    as(dA, "curriculum");
    const res = await updateTool(tClear, { ...BASE, integrityK5: "" });
    expect(res).toEqual({});
    const row = await db.districtTool.findUniqueOrThrow({ where: { id: tClear } });
    expect(row.integrityK5Override).toBeNull();
  });

  it("another district's tool id fails closed with no write", async () => {
    as(dA, "curriculum");
    const res = await updateTool(tB, { ...BASE, integrityK5: "red" });
    expect(res.error).toBe("Not found.");
    const row = await db.districtTool.findUniqueOrThrow({ where: { id: tB } });
    expect(row.integrityK5Override).toBeNull();
  });

  it("a band change marks the draft stale: toolTableHash covers the overrides", async () => {
    const row = {
      rawName: "Hash Band", aiStatus: "calls_model", agreementStatus: "signed",
      decision: "limited", catalogToolId: null, inUse: true, exhibitOverride: null,
    };
    const before = toolTableHash([row]);
    const after = toolTableHash([{ ...row, integrityK5Override: "red" }]);
    expect(after).not.toBe(before);
    expect(toolTableHash([row])).toBe(before);
    as(dA, "curriculum");
    const liveBefore = (await assemble(db, dA)).toolHash;
    await updateTool(tHash, { ...BASE, integrity68: "red" });
    expect((await assemble(db, dA)).toolHash).not.toBe(liveBefore);
  });

  it("adopt pins the resolved triple; later live edits leave the snapshot byte-identical", async () => {
    as(dA, "curriculum");
    // Questionnaire bands from makeDistrict: K5 red, 6-8 yellow, 9-12 green.
    const set = await updateTool(tPin, { ...BASE, integrityK5: "green", integrity912: "red" });
    expect(set).toEqual({});
    as(dA, "owner", "owner@bands.test");
    const adopted = await adoptSnapshot();
    expect(adopted.error).toBeUndefined();
    const snap = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: adopted.id! } });
    if (snap.exportKey) blobKeys.push(snap.exportKey);
    const rows = snap.toolTable as Array<Record<string, unknown>>;
    const pinned = rows.find((r) => r.rawName === "Pin Band Tool");
    expect(pinned).toMatchObject({ integrityK5: "green", integrity68: "yellow", integrity912: "red" });
    const frozenTable = JSON.stringify(snap.toolTable);

    as(dA, "curriculum");
    await updateTool(tPin, { ...BASE, integrityK5: "", integrity912: "" });
    const again = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: snap.id } });
    expect(JSON.stringify(again.toolTable)).toBe(frozenTable);
  });

  it("guides render per-tool bands; legacy rows fall back to district bands with a line", () => {
    const answers = {
      integrityK5: "green", integrity68: "yellow", integrity912: "green",
      dataRule: "no_student_pii", noTrainingRule: "require_addendum", disclosure: "required",
    } as Parameters<typeof buildToolGuides>[1];
    const tools = [
      { rawName: "Split Tool", category: "Tutors", aiStatus: "calls_model", agreementStatus: "signed", decision: "limited", notes: "", integrityK5: "red", integrity68: "yellow", integrity912: "green" },
      { rawName: "Plain Tool", category: "Tutors", aiStatus: "calls_model", agreementStatus: "signed", decision: "limited", notes: "" },
    ];
    const guides = buildToolGuides(tools, answers, "Test District", "Director");
    const split = guides.find((g) => g.toolName === "Split Tool")!;
    expect(split.html).toContain("K–5: not permitted for student use");
    const plain = guides.find((g) => g.toolName === "Plain Tool")!;
    expect(plain.html).toContain("K–5: permitted with citation and teacher review");
    expect(plain.html).toContain("not recorded at adoption");

    // Pinned bands equal to the district bands render exactly the district line.
    const same = buildToolGuides(
      [{ ...tools[1], integrityK5: "green", integrity68: "yellow", integrity912: "green" }],
      answers, "Test District", "Director"
    )[0].html;
    expect(same).toContain("K–5: permitted with citation and teacher review; 6–8: teacher-guided classroom use only; 9–12: permitted with citation and teacher review.");
    expect(same).not.toContain("not recorded at adoption");
  });

  it("the training packet lists pinned bands and stays silent for legacy rows", () => {
    const withBands = buildTrainingPacket({
      districtName: "D", adoptedOn: "2026-10-08", adoptedBy: "o@x", stale: false,
      tools: [{ rawName: "T", aiStatus: "calls_model", agreementStatus: "signed", decision: "limited", notes: "", integrityK5: "red", integrity68: "yellow", integrity912: "green" }],
    });
    expect(withBands.teacherCard).toContain("bands K–5");
    const legacy = buildTrainingPacket({
      districtName: "D", adoptedOn: "2026-10-08", adoptedBy: "o@x", stale: false,
      tools: [{ rawName: "T", aiStatus: "calls_model", agreementStatus: "signed", decision: "limited", notes: "" }],
    });
    expect(legacy.teacherCard).not.toContain("bands K–5");
  });
});
