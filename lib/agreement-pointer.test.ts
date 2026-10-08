import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { promises as fs } from "fs";
import path from "path";
import { sessionUser } from "@/lib/session";
import { recordAlliancePointer, uploadAgreement } from "@/app/actions/tools";
import { adoptSnapshot } from "@/app/actions/policy";
import { assemble, toolTableHash, latestPointerSummary } from "./assembler";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();
const mockSession = vi.mocked(sessionUser);

type Role = "owner" | "curriculum" | "sped" | "viewer";

function as(districtId: string, role: Role, email?: string) {
  const e = email ?? `${role}@pointer.test`;
  mockSession.mockResolvedValue({ id: `u-${role}`, email: e, districtId, role });
}

const URL = "https://privacy.a4l.org/sdpc-resource-registry/wa-ndpa-1";
const REG_ID = "SDPC-WA-12345";
const ORIG = "WA SDPC alliance";
const DATE = "2026-10-09";

describe("recordAlliancePointer server action", () => {
  let dA = "", dB = "";
  let tPtr = "", tViewer = "", tBad = "", tMissing = "", tStudent = "", tUpload = "";
  let tB = "", tPin = "";
  const blobKeys: string[] = [];

  beforeAll(async () => {
    await ensureTestClauses(db);
    dA = (await makeDistrict(db, "ptr-a")).id;
    dB = (await makeDistrict(db, "ptr-b")).id;
    const mk = (districtId: string, rawName: string, data: Record<string, unknown> = {}) =>
      db.districtTool.create({
        data: {
          districtId, rawName, aiStatus: "calls_model", agreementStatus: "not_requested",
          decision: "hold", inUse: true, notes: "", ...data,
        },
      });
    tPtr = (await mk(dA, "Pointer Me")).id;
    tViewer = (await mk(dA, "Viewer Tool")).id;
    tBad = (await mk(dA, "Bad Url Tool")).id;
    tMissing = (await mk(dA, "Missing Fields Tool")).id;
    tStudent = (await mk(dA, "Student Data Tool")).id;
    tUpload = (await mk(dA, "Upload Tool")).id;
    tB = (await mk(dB, "Other District Tool")).id;
    tPin = (await mk(dA, "Pin Pointer Tool")).id;
    for (const seat of ["technology", "teaching", "sped"]) {
      await db.reviewSeat.create({
        data: { districtId: dA, seat, required: true, signedAt: new Date(), signedBy: "owner@pointer.test" },
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

  it("a council writer records a pointer with no file; status and event follow", async () => {
    as(dA, "curriculum");
    const res = await recordAlliancePointer({
      toolId: tPtr, registryUrl: URL, registryId: REG_ID, originator: ORIG, status: "signed",
    });
    expect(res).toEqual({});
    const row = await db.agreement.findFirstOrThrow({ where: { toolId: tPtr } });
    expect(row.kind).toBe("alliance_pointer");
    expect(row.blobKey).toBe("");
    expect(row.registryUrl).toBe(URL);
    expect(row.registryId).toBe(REG_ID);
    expect(row.originator).toBe(ORIG);
    expect(row.uploadedBy).toBe("curriculum@pointer.test");
    const tool = await db.districtTool.findUniqueOrThrow({ where: { id: tPtr } });
    expect(tool.agreementStatus).toBe("signed");
    const ev = await db.decisionEvent.findFirst({ where: { toolId: tPtr } });
    expect(ev?.toStatus).toBe("signed");
  });

  it("upload with no file still fails; pointer needs no file", async () => {
    as(dA, "curriculum");
    const before = await db.agreement.count({ where: { toolId: tUpload } });
    const res = await uploadAgreement(tUpload, new FormData());
    expect(res.error).toMatch(/No file received/);
    expect(await db.agreement.count({ where: { toolId: tUpload } })).toBe(before);
  });

  it("a viewer POST is refused and writes nothing", async () => {
    as(dA, "viewer");
    const before = await db.agreement.count({ where: { toolId: tViewer } });
    const res = await recordAlliancePointer({
      toolId: tViewer, registryUrl: URL, registryId: REG_ID, originator: ORIG,
    });
    expect(res.error).toMatch(/Read-only/);
    expect(await db.agreement.count({ where: { toolId: tViewer } })).toBe(before);
  });

  it("invalid URLs, missing fields, and bad dates are field errors with no write", async () => {
    as(dA, "curriculum");
    for (const bad of [
      { registryUrl: "javascript:alert(1)", registryId: REG_ID, originator: ORIG },
      { registryUrl: "privacy.a4l.org/no-scheme", registryId: REG_ID, originator: ORIG },
      { registryUrl: "", registryId: REG_ID, originator: ORIG },
    ]) {
      const res = await recordAlliancePointer({ toolId: tBad, ...bad });
      expect(res.field).toBe("registryUrl");
      expect(res.error).toMatch(/registry URL/i);
    }
    expect(
      (await recordAlliancePointer({ toolId: tMissing, registryUrl: URL, registryId: "", originator: ORIG })).field
    ).toBe("registryId");
    expect(
      (await recordAlliancePointer({ toolId: tMissing, registryUrl: URL, registryId: REG_ID, originator: "" })).field
    ).toBe("originator");
    expect(
      (await recordAlliancePointer({ toolId: tMissing, registryUrl: URL, registryId: REG_ID, originator: ORIG, expiresOn: "10/09/2026" })).field
    ).toBe("expiresOn");
    expect(await db.agreement.count({ where: { toolId: { in: [tBad, tMissing] } } })).toBe(0);
  });

  it("student-record text in the pointer is refused with no write", async () => {
    as(dA, "curriculum");
    const res = await recordAlliancePointer({
      toolId: tStudent, registryUrl: URL, registryId: REG_ID, originator: "Student IEP plan",
    });
    expect(res.error).toMatch(/student records/i);
    expect(await db.agreement.count({ where: { toolId: tStudent } })).toBe(0);
  });

  it("another district's tool id fails closed with no write", async () => {
    as(dA, "curriculum");
    const res = await recordAlliancePointer({
      toolId: tB, registryUrl: URL, registryId: REG_ID, originator: ORIG,
    });
    expect(res.error).toBe("Not found.");
    expect(await db.agreement.count({ where: { toolId: tB } })).toBe(0);
  });

  it("latestPointerSummary: null when none, upload default, latest wins", () => {
    expect(latestPointerSummary(null)).toBeNull();
    expect(latestPointerSummary([])).toBeNull();
    expect(
      latestPointerSummary([{ kind: null, registryUrl: null, registryId: null, originator: null, createdAt: new Date() }])
    ).toMatchObject({ kind: "local_upload" });
    const old = { kind: "local_upload", registryUrl: null, registryId: null, originator: null, createdAt: new Date("2026-01-01") };
    const fresh = { kind: "alliance_pointer", registryUrl: URL, registryId: REG_ID, originator: ORIG, createdAt: new Date("2026-10-09") };
    expect(latestPointerSummary([old, fresh])).toMatchObject({ kind: "alliance_pointer", registryUrl: URL });
    expect(latestPointerSummary([fresh, old])).toMatchObject({ kind: "alliance_pointer", registryUrl: URL });
  });

  it("a pointer change marks the draft stale: toolTableHash covers the pointer", () => {
    const row = {
      rawName: "Hash Pointer Tool", aiStatus: "calls_model", agreementStatus: "signed",
      decision: "hold", catalogToolId: null, inUse: true, exhibitOverride: null,
    };
    const before = toolTableHash([row]);
    const withUpload = toolTableHash([{ ...row, agreements: [{ kind: "local_upload", createdAt: new Date() }] }]);
    const withPointer = toolTableHash([{
      ...row,
      agreements: [{ kind: "alliance_pointer", registryUrl: URL, registryId: REG_ID, originator: ORIG, createdAt: new Date() }],
    }]);
    expect(withUpload).not.toBe(before);
    expect(withPointer).not.toBe(before);
    expect(withPointer).not.toBe(withUpload);
    expect(toolTableHash([row])).toBe(before);
  });

  it("adopt pins the pointer summary; later live pointers leave the snapshot byte-identical and mark the draft stale", async () => {
    as(dA, "curriculum");
    const recorded = await recordAlliancePointer({
      toolId: tPin, registryUrl: URL, registryId: REG_ID, originator: ORIG, status: "signed", expiresOn: DATE,
    });
    expect(recorded).toEqual({});
    as(dA, "owner", "owner@pointer.test");
    const adopted = await adoptSnapshot();
    expect(adopted.error).toBeUndefined();
    const snap = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: adopted.id! } });
    if (snap.exportKey) blobKeys.push(snap.exportKey);
    const rows = snap.toolTable as Array<Record<string, unknown>>;
    const pinned = rows.find((r) => r.rawName === "Pin Pointer Tool");
    expect(pinned).toMatchObject({
      agreementKind: "alliance_pointer", registryUrl: URL, registryId: REG_ID, originator: ORIG,
    });
    const frozenTable = JSON.stringify(snap.toolTable);
    const frozenHtml = snap.html;
    const frozenHash = snap.toolHash;

    as(dA, "curriculum");
    const edited = await recordAlliancePointer({
      toolId: tPin, registryUrl: "https://privacy.a4l.org/sdpc-resource-registry/wa-ndpa-2",
      registryId: "SDPC-WA-99999", originator: ORIG, status: "signed",
    });
    expect(edited).toEqual({});

    const again = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: snap.id } });
    expect(JSON.stringify(again.toolTable)).toBe(frozenTable);
    expect(again.html).toBe(frozenHtml);
    const now = await assemble(db, dA);
    expect(now.toolHash).not.toBe(frozenHash);
  });
});
