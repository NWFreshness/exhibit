import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { projectExhibitRows } from "./exhibit";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();

const RICH_ROW = {
  rawName: "Class Tool",
  category: "Tutors",
  aiStatus: "calls_model",
  agreementStatus: "signed",
  decision: "limited",
  notes: "Secret council note",
  requesterEmail: "someone@district.org",
  comments: [{ author: "boss@district.org", note: "Secret comment" }],
  retention: "Secret retention text",
  registryId: "SDPC-SECRET-1",
  dataRule: "no_student_pii",
  citationUrl: "https://v.example/dpa",
  citationDate: "2026-10-08",
  citedBy: "writer@district.org",
  agreementKind: "alliance_pointer",
  registryUrl: "https://p.example/r",
  originator: "WA alliance",
  integrityK5: "red",
  integrity68: "yellow",
  integrity912: "green",
};

describe("projectExhibitRows", () => {
  it("renders only name, decision, and bands — banned fields never survive", () => {
    const list = projectExhibitRows([RICH_ROW], { integrityK5: "green", integrity68: "green", integrity912: "green" });
    expect(list.rows).toHaveLength(1);
    const row = list.rows[0];
    expect(Object.keys(row).sort()).toEqual(["bands", "decision", "legacyBands", "name"]);
    expect(row).toMatchObject({
      name: "Class Tool",
      decision: "limited",
      bands: {
        k5: "not permitted for student use",
        g68: "teacher-guided classroom use only",
        g912: "permitted with citation and teacher review",
      },
      legacyBands: false,
    });
    const blob = JSON.stringify(list);
    for (const secret of [
      "Secret council note", "someone@district.org", "Secret comment",
      "Secret retention text", "SDPC-SECRET-1", "writer@district.org",
      "https://p.example/r", "WA alliance", "no_student_pii",
    ]) {
      expect(blob).not.toContain(secret);
    }
    expect(list.legacyBands).toBe(false);
  });

  it("rows without band keys fall back to the snapshot answers with the legacy flag", () => {
    const list = projectExhibitRows(
      [{ rawName: "Old Tool", decision: "approved" }],
      { integrityK5: "green", integrity68: "yellow", integrity912: "red" }
    );
    expect(list.rows[0]).toMatchObject({
      name: "Old Tool",
      decision: "approved",
      bands: {
        k5: "permitted with citation and teacher review",
        g68: "teacher-guided classroom use only",
        g912: "not permitted for student use",
      },
      legacyBands: true,
    });
    expect(list.legacyBands).toBe(true);
  });

  it("missing answers render undecided bands without crashing", () => {
    const list = projectExhibitRows([{ rawName: "Old Tool", decision: "hold" }], null);
    expect(list.rows[0].bands).toEqual({
      k5: "to be decided", g68: "to be decided", g912: "to be decided",
    });
    expect(list.legacyBands).toBe(true);
  });

  it("skips malformed rows and sorts by name", () => {
    const list = projectExhibitRows(
      [
        { rawName: "Zebra", decision: "approved", integrityK5: "green", integrity68: "green", integrity912: "green" },
        null,
        "nope",
        { rawName: "Apple" },
        { decision: "hold" },
        { rawName: "Mango", decision: "banned", integrityK5: "red", integrity68: "red", integrity912: "red" },
      ],
      {}
    );
    expect(list.rows.map((r) => r.name)).toEqual(["Mango", "Zebra"]);
  });

  it("an undecodable table projects to an empty list", () => {
    expect(projectExhibitRows(null, {})).toEqual({ rows: [], legacyBands: false });
    expect(projectExhibitRows("nope", {})).toEqual({ rows: [], legacyBands: false });
  });
});

describe("public list reads snapshots, not live rows", () => {
  let dA = "", dB = "";

  beforeAll(async () => {
    await ensureTestClauses(db);
    dA = (await makeDistrict(db, "exhibit-a")).id;
    dB = (await makeDistrict(db, "exhibit-b")).id;
  });

  afterAll(async () => {
    await wipeDistrict(db, dA).catch(() => {});
    await wipeDistrict(db, dB).catch(() => {});
    await db.$disconnect();
  });

  it("live edits after adoption leave the projected page identical", async () => {
    const tool = await db.districtTool.create({
      data: {
        districtId: dA, rawName: "Frozen Tool", aiStatus: "calls_model",
        agreementStatus: "signed", decision: "limited", inUse: true, notes: "Live note",
      },
    });
    const snap = await db.adoptedSnapshot.create({
      data: {
        districtId: dA, adoptedBy: "owner@test", clauseRefs: [], toolHash: "h", answersHash: "a",
        answersJson: { integrityK5: "red", integrity68: "yellow", integrity912: "green" },
        toolTable: [{ rawName: "Frozen Tool", decision: "limited", integrityK5: "red", integrity68: "yellow", integrity912: "green", notes: "Adopted note" }],
        html: "<p>frozen</p>",
      },
    });
    const before = projectExhibitRows(
      (await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: snap.id } })).toolTable, snap.answersJson
    );
    await db.districtTool.update({
      where: { id: tool.id },
      data: { decision: "banned", notes: "Changed after adoption", rawName: "Renamed Tool" },
    });
    await db.districtTool.create({
      data: {
        districtId: dA, rawName: "Brand New Tool", aiStatus: "calls_model",
        agreementStatus: "signed", decision: "approved", inUse: true, notes: "",
      },
    });
    const after = projectExhibitRows(
      (await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: snap.id } })).toolTable, snap.answersJson
    );
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain("Renamed");
    expect(JSON.stringify(after)).not.toContain("Brand New Tool");
  });

  it("one district's snapshot never carries another district's tools", async () => {
    await db.districtTool.create({
      data: {
        districtId: dB, rawName: "B Only Tool", aiStatus: "calls_model",
        agreementStatus: "signed", decision: "approved", inUse: true, notes: "",
      },
    });
    const snapB = await db.adoptedSnapshot.create({
      data: {
        districtId: dB, adoptedBy: "owner@test", clauseRefs: [], toolHash: "h", answersHash: "a",
        toolTable: [{ rawName: "B Only Tool", decision: "approved" }],
        html: "<p>b</p>",
      },
    });
    const listB = projectExhibitRows(snapB.toolTable, snapB.answersJson);
    expect(listB.rows.map((r) => r.name)).toEqual(["B Only Tool"]);
    const snapsA = await db.adoptedSnapshot.findMany({ where: { districtId: dA } });
    for (const s of snapsA) {
      expect(JSON.stringify(projectExhibitRows(s.toolTable, s.answersJson))).not.toContain("B Only Tool");
    }
  });
});
