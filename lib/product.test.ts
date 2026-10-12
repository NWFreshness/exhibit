// Product changes from docs/product-todo.md. One block per item.
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/store", () => ({ putBlob: vi.fn(async (key: string) => ({ key, url: "" })) }));

import { sessionUser } from "@/lib/session";
import {
  adoptSnapshot, recordBoardAdoption, publishToolList, signSeat, writeProse, saveProse,
  translateFamily, saveTranslation, citeFinding, acceptSharedFinding,
} from "@/app/actions/policy";
import { updateTool, archiveTool, renameTool, mergeTool } from "@/app/actions/tools";
import { setSchoolStaff } from "@/app/actions/council";
import { assemble } from "./assembler";
import { llmCalls } from "./llm";
import { currentPolicy, toolListFor } from "./policy";
import { projectExhibitRows } from "./exhibit";
import { buildTrainingPacket, type SnapshotTool } from "./training";
import { buildToolGuides } from "./guides";
import { runRenewalPass, renewalDigests } from "./renewals";
import { createDistrict } from "./districts";
import { sharedFindingsFor } from "./shared";
import { createToolRequest } from "./requests";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();
const as = (districtId: string, role: "owner" | "curriculum", email = `${role}@product.test`) =>
  vi.mocked(sessionUser).mockResolvedValue({ id: `u-${role}`, email, districtId, role });

const SEATS = ["technology", "teaching", "sped"];
const form = { agreementStatus: "signed", decision: "approved", aiStatus: "calls_model", inUse: true, notes: "", override: {} as Record<string, string> };

describe("product changes", () => {
  let dA = "", dB = "", tool = "", made = "";
  const signAll = async () => { for (const s of SEATS) expect(await signSeat(s)).toEqual({}); };

  beforeAll(async () => {
    await ensureTestClauses(db);
    dA = (await makeDistrict(db, "product-a")).id;
    dB = (await makeDistrict(db, "product-b")).id;
    tool = (await db.districtTool.create({ data: { districtId: dA, rawName: "Lumen Reader", agreementStatus: "signed", decision: "approved", aiStatus: "calls_model" } })).id;
    for (const seat of SEATS) await db.reviewSeat.create({ data: { districtId: dA, seat, required: true } });
    as(dA, "owner");
  });
  afterAll(async () => {
    for (const id of [dA, dB, made]) if (id) await wipeDistrict(db, id);
    await db.$disconnect();
  });

  it("5: model text is written once, stored, and viewing never calls the model", async () => {
    expect((await assemble(db, dA, { prose: false })).html).toContain("not written yet");
    expect(await writeProse()).toEqual({});
    llmCalls.length = 0;
    const first = await assemble(db, dA, { prose: false });
    const second = await assemble(db, dA, { prose: false });
    expect(llmCalls.length).toBe(0);
    expect(second.html).toBe(first.html);
    expect(first.purpose).not.toBe("");
    expect(await saveProse("Our own purpose paragraph.", "Dear families, our own letter.")).toEqual({});
    expect((await assemble(db, dA, { prose: false })).html).toContain("Our own purpose paragraph.");
    expect(llmCalls.length).toBe(0);
  });

  it("8: a translation starts unreviewed and a person marks it reviewed", async () => {
    expect((await translateFamily("Klingon")).error).toMatch(/Unknown language/);
    expect(await translateFamily("Spanish")).toEqual({});
    const draft = await db.draft.findFirstOrThrow({ where: { districtId: dA } });
    expect(draft.familyTranslations).toMatchObject({ Spanish: { reviewed: false } });
    expect(await saveTranslation("Spanish", "Estimadas familias.", true)).toEqual({});
    expect((await db.draft.findFirstOrThrow({ where: { districtId: dA } })).familyTranslations)
      .toEqual({ Spanish: { text: "Estimadas familias.", reviewed: true } });
  });

  it("2: a signature counts only for the draft it signed", async () => {
    await signAll();
    const answers = (await db.questionnaireAnswer.findUniqueOrThrow({ where: { districtId: dA } })).answers as object;
    await db.questionnaireAnswer.update({ where: { districtId: dA }, data: { answers: { ...answers, reviewCadence: "twice a year" } } });
    const refused = await adoptSnapshot();
    expect(refused.error).toMatch(/draft changed after technology, teaching, sped signed/);
    expect(await db.adoptedSnapshot.count({ where: { districtId: dA } })).toBe(0);
    await signAll();
    // An owner edit to the model text lapses them too.
    expect(await saveProse("Edited purpose paragraph.", "Dear families, edited letter.")).toEqual({});
    expect((await adoptSnapshot()).error).toMatch(/Board packet is locked/);
    await signAll();
  });

  it("3: council approval is not in force until the board adopts it", async () => {
    const approved = await adoptSnapshot();
    expect(approved.error).toBeUndefined();
    expect(await currentPolicy(db, dA)).toBeNull();
    expect((await publishToolList()).error).toMatch(/No policy is in force/);
    expect((await recordBoardAdoption(approved.id!, "soon", "")).error).toMatch(/YYYY-MM-DD/);
    expect(await recordBoardAdoption(approved.id!, "2026-10-20", "R-14")).toEqual({});
    const policy = await currentPolicy(db, dA);
    expect(policy).toMatchObject({ id: approved.id, boardResolution: "R-14", familyText: "Dear families, edited letter." });
    expect(policy!.familyTranslations).toEqual({ Spanish: { text: "Estimadas familias.", reviewed: true } });
    expect(policy!.html).toContain("Edited purpose paragraph.");
  });

  it("1: publishing a tool list leaves the adopted policy untouched", async () => {
    const policy = (await currentPolicy(db, dA))!;
    const frozen = JSON.stringify(policy);
    await db.districtTool.create({ data: { districtId: dA, rawName: "Newer Tool", agreementStatus: "signed", decision: "approved", aiStatus: "calls_model" } });
    const live = await assemble(db, dA, { prose: false });
    expect(live.answersHash).toBe(policy.answersHash);
    expect(live.toolHash).not.toBe((await toolListFor(db, policy)).toolHash);
    const published = await publishToolList();
    expect(published.error).toBeUndefined();
    const list = await toolListFor(db, policy);
    expect(list.versionId).toBe(published.id);
    expect(list.toolHash).toBe(live.toolHash);
    expect(projectExhibitRows(list.toolTable, policy.answersJson).rows.map((r) => r.name)).toEqual(["Lumen Reader", "Newer Tool"]);
    expect(JSON.stringify(await currentPolicy(db, dA))).toBe(frozen);
    // Seats and the board are not asked again for a tool-list change.
    expect((await db.reviewSeat.findMany({ where: { districtId: dA, signedAt: null } })).length).toBe(0);
  });

  it("4 and 7: internal notes print nowhere; guidance and the limit do", async () => {
    as(dA, "curriculum");
    expect((await updateTool(tool, { ...form, decision: "limited" })).error).toMatch(/needs its limit/);
    expect(await updateTool(tool, {
      ...form, decision: "limited", notes: "SECRET vendor call notes",
      limitText: "Grades 6-12 only.", teacherGuidance: "Check every answer before sharing.",
    })).toEqual({});
    as(dA, "owner");
    expect((await assemble(db, dA, { prose: false })).html).not.toContain("SECRET");
    await publishToolList();
    const policy = (await currentPolicy(db, dA))!;
    const rows = (await toolListFor(db, policy)).toolTable as SnapshotTool[];
    const packet = buildTrainingPacket({ districtName: "D", adoptedOn: "x", adoptedBy: "y", stale: false, tools: rows });
    const guides = buildToolGuides(rows, {}, "D", "Owner").map((g) => g.html).join("");
    const pub = projectExhibitRows(rows, policy.answersJson);
    for (const out of [packet.teacherCard, packet.principalScript, guides, JSON.stringify(pub)]) {
      expect(out).not.toContain("SECRET");
    }
    expect(packet.teacherCard).toContain("Grades 6-12 only. Check every answer before sharing.");
    expect(guides).toContain("Grades 6-12 only.");
    expect(pub.rows.find((r) => r.name === "Lumen Reader")?.guidance).toBe("Grades 6-12 only. Check every answer before sharing.");
    // A row pinned before the split still prints the note it was adopted with, but never publicly.
    const legacy = [{ rawName: "Old", aiStatus: "x", agreementStatus: "signed", decision: "approved", notes: "Adopted note" }];
    expect(buildTrainingPacket({ districtName: "D", adoptedOn: "x", adoptedBy: "y", stale: false, tools: legacy }).teacherCard).toContain("Adopted note");
    expect(projectExhibitRows(legacy, {}).rows[0].guidance).toBeUndefined();
  });

  it("6: one renewal digest per renewal owner, owners as the fallback", async () => {
    const keeper = await db.user.create({ data: { email: "keeper@product.test", districtId: dA, role: "curriculum" } });
    await db.user.create({ data: { email: "owner@product.test", districtId: dA, role: "owner" } });
    const soon = new Date(Date.now() + 30 * 86_400_000);
    await db.districtTool.update({ where: { id: tool }, data: { agreementEndsOn: soon, renewalOwnerUserId: keeper.id } });
    await db.districtTool.create({ data: { districtId: dA, rawName: "Ownerless Tool", decision: "hold" } });
    await runRenewalPass(db, dA);
    const digests = await renewalDigests(db, dA);
    expect(digests.map((d) => d.to).sort()).toEqual(["keeper@product.test", "owner@product.test"]);
    const mine = digests.find((d) => d.to === "keeper@product.test")!;
    expect(mine.lines).toHaveLength(1);
    expect(mine.lines[0]).toMatch(/^Lumen Reader: agreement ends within 90 days \(ends \d{4}-\d{2}-\d{2}\)$/);
    expect(digests.find((d) => d.to === "owner@product.test")!.lines.join(" ")).toContain("Ownerless Tool: still on hold");
    expect(await renewalDigests(db, dB)).toEqual([]);
  });

  it("9: archive hides a tool but keeps its history; rename and merge work", async () => {
    const dupReq = await createToolRequest(db, dA, { toolName: "Lumen Reeder", requesterEmail: "t@product.test", actorEmail: "t@product.test" });
    expect((await renameTool(dupReq.toolId, "Lumen Reader")).error).toMatch(/Merge them instead/);
    expect(await mergeTool(tool, dupReq.toolId)).toEqual({});
    expect(await db.districtTool.findUnique({ where: { id: dupReq.toolId } })).toBeNull();
    expect(await db.toolRequest.count({ where: { districtToolId: tool } })).toBe(1);
    expect(await renameTool(tool, "Lumen Reader Pro")).toEqual({});
    expect(await archiveTool(tool, true)).toEqual({});
    expect((await assemble(db, dA, { prose: false })).html).not.toContain("Lumen Reader Pro");
    const events = await db.decisionEvent.findMany({ where: { toolId: tool } });
    expect(events.map((e) => e.toStatus)).toEqual(expect.arrayContaining(["archived", "name: Lumen Reader Pro"]));
    expect(events.some((e) => e.fromStatus === "merged in: Lumen Reeder")).toBe(true);
    as(dA, "curriculum");
    expect((await archiveTool(tool, false)).error).toMatch(/Owner only/);
    as(dA, "owner");
    expect(await archiveTool(tool, false)).toEqual({});
  });

  it("10: a building takes a staff headcount, not anything else", async () => {
    const school = await db.school.create({ data: { districtId: dA, name: "Ridge" } });
    expect((await setSchoolStaff(school.id, "forty")).error).toMatch(/whole number/);
    expect(await setSchoolStaff(school.id, "40")).toEqual({});
    expect((await db.school.findUniqueOrThrow({ where: { id: school.id } })).staffCount).toBe(40);
    expect(await setSchoolStaff(school.id, "")).toEqual({});
    expect((await db.school.findUniqueOrThrow({ where: { id: school.id } })).staffCount).toBeNull();
  });

  it("12: an operator creates a district and its first owner invite", async () => {
    const tag = Date.now();
    await expect(createDistrict(db, { name: "X", ownerEmail: "boss@gmail.com" })).rejects.toThrow(/district email/);
    const r = await createDistrict(db, { name: "Made District", ownerEmail: `Boss@made-${tag}.example` });
    made = r.districtId;
    expect(r.domain).toBe(`made-${tag}.example`);
    expect(await db.invite.findFirst({ where: { districtId: made } })).toMatchObject({ email: `boss@made-${tag}.example`, role: "owner" });
    expect(await db.reviewSeat.count({ where: { districtId: made, required: true } })).toBe(3);
    await expect(createDistrict(db, { name: "Copy", ownerEmail: `other@made-${tag}.example` })).rejects.toThrow(/already belongs to another district/);
  });

  it("13 and 21: a shared finding is seen elsewhere, merges only on accept, and survives a save", async () => {
    const cat = await db.catalogTool.create({ data: { name: `Shared Cat ${Date.now()}` } });
    const mk = (districtId: string) => db.districtTool.create({
      data: { districtId, catalogToolId: cat.id, rawName: "Shared Tool", agreementStatus: "signed", decision: "hold", aiStatus: "calls_model" },
    });
    const [tA, tB] = [await mk(dA), await mk(dB)];
    try {
      as(dA, "curriculum");
      expect(await citeFinding({ toolId: tA.id, usedForTraining: "false", citationUrl: "https://vendor.example/privacy", citationDate: "2026-10-01", share: true })).toEqual({});
      expect(await sharedFindingsFor(db, dA, cat.id)).toEqual([]);
      const seen = await sharedFindingsFor(db, dB, cat.id);
      expect(seen).toHaveLength(1);
      expect(Object.keys(seen[0]).sort()).toEqual(["citationDate", "citationUrl", "id", "key", "value"]);
      expect((await db.districtTool.findUniqueOrThrow({ where: { id: tB.id } })).exhibitOverride).toBeNull();
      as(dB, "curriculum", "curriculum@b.test");
      expect(await acceptSharedFinding(tB.id, seen[0].id)).toEqual({});
      const want = { usedForTraining: false, citationUrl: "https://vendor.example/privacy", citationDate: "2026-10-01", citedBy: "curriculum@b.test" };
      expect((await db.districtTool.findUniqueOrThrow({ where: { id: tB.id } })).exhibitOverride).toEqual(want);
      // Item 21: saving the tool form keeps the citation.
      expect(await updateTool(tB.id, { ...form, decision: "hold", override: { usedForTraining: "false" } })).toEqual({});
      expect((await db.districtTool.findUniqueOrThrow({ where: { id: tB.id } })).exhibitOverride).toEqual(want);
    } finally {
      await db.catalogTool.delete({ where: { id: cat.id } });
      as(dA, "owner");
    }
  });
});
