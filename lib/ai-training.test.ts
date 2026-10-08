import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeRestricted, llmCalls } from "./llm";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();

describe("ai training script", () => {
  let dId = "", snapId = "", snapHtml = "";

  beforeAll(async () => {
    await ensureTestClauses(db);
    const d = await makeDistrict(db, "aitr");
    dId = d.id;
    const snap = await db.adoptedSnapshot.create({
      data: {
        districtId: dId, adoptedBy: "owner@test", clauseRefs: [],
        toolHash: "h", answersHash: "a", toolTable: [], html: "<p>frozen</p>",
      },
    });
    snapId = snap.id;
    snapHtml = snap.html;
  });
  afterAll(async () => {
    await wipeDistrict(db, dId);
    await db.$disconnect();
  });

  it("writes a training script from district data via the one wrapper", async () => {
    llmCalls.length = 0;
    const body = await writeRestricted("training", {
      districtName: "Test District", rupName: "RUP",
      approved: ["Quizizz AI"], limited: ["Khanmigo"],
      toolDetails: "Quizizz AI (approved: assessment use)",
      dataRule: "no_student_pii", ownerName: "Director",
    });
    expect(body).toContain("Quizizz AI");
    expect(llmCalls.map((c) => c.kind)).toEqual(["training"]);
  });

  it("storing a script never rewrites the snapshot", async () => {
    await db.trainingScript.create({
      data: { districtId: dId, snapshotId: snapId, body: "script v1", model: "stub", createdBy: "o@t" },
    });
    await db.trainingScript.create({
      data: { districtId: dId, snapshotId: snapId, body: "script v2", model: "stub", createdBy: "o@t" },
    });
    const frozen = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: snapId } });
    expect(frozen.html).toBe(snapHtml);
    const latest = await db.trainingScript.findFirst({
      where: { snapshotId: snapId }, orderBy: { createdAt: "desc" },
    });
    expect(latest?.body).toBe("script v2");
  });

  it("refuses kinds outside purpose, family, training", async () => {
    await expect(writeRestricted("discipline" as never, {
      districtName: "x", rupName: "y", approved: [], limited: [],
    })).rejects.toThrow(/refused/i);
  });
});
