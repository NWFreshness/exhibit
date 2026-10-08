import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { sessionUser } from "@/lib/session";
import { mintRequestToken, submitPublicRequest, submitRequest } from "@/app/actions/requests";
import {
  createToolRequest, getRequestStatus, mintRequestToken as mintToken, newStatusToken,
} from "./requests";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();
const mockSession = vi.mocked(sessionUser);

type Role = "owner" | "curriculum" | "sped" | "viewer";

function as(districtId: string, role: Role, email?: string) {
  const e = email ?? `${role}@token.test`;
  mockSession.mockResolvedValue({ id: `u-${role}`, email: e, districtId, role });
}

const HEX64 = /^[0-9a-f]{64}$/;

describe("requester status tokens", () => {
  let dA = "", dB = "";

  beforeAll(async () => {
    await ensureTestClauses(db);
    dA = (await makeDistrict(db, "token-a")).id;
    dB = (await makeDistrict(db, "token-b")).id;
  });

  afterAll(async () => {
    await wipeDistrict(db, dA).catch(() => {});
    await wipeDistrict(db, dB).catch(() => {});
    await db.$disconnect();
  });

  it("new tokens are 256-bit hex", () => {
    expect(newStatusToken()).toMatch(HEX64);
    expect(newStatusToken()).not.toBe(newStatusToken());
  });

  it("both insert paths issue distinct unguessable tokens", async () => {
    const first = await createToolRequest(db, dA, {
      toolName: "Token Tool One", requesterEmail: "one@district.org", actorEmail: "one@district.org",
    });
    expect(first.existing).toBe(false);
    expect(first.statusToken).toMatch(HEX64);
    const second = await createToolRequest(db, dA, {
      toolName: "token tool one", requesterEmail: "two@district.org", actorEmail: "two@district.org",
    });
    expect(second.existing).toBe(true);
    expect(second.toolId).toBe(first.toolId);
    expect(second.statusToken).toMatch(HEX64);
    expect(second.statusToken).not.toBe(first.statusToken);
    const stored = await db.toolRequest.findMany({ where: { districtToolId: first.toolId } });
    expect(stored).toHaveLength(2);
    expect(stored.every((r) => HEX64.test(r.statusToken ?? ""))).toBe(true);
  });

  it("the status read returns only tool name, decision, and intended use", async () => {
    const r = await createToolRequest(db, dA, {
      toolName: "Status Read Tool", intendedUse: "with_students",
      requesterName: "Secret Name", requesterEmail: "secret@district.org",
      note: "Secret note", actorEmail: "secret@district.org",
    });
    const s = await getRequestStatus(db, r.statusToken);
    expect(s).toEqual({ toolName: "Status Read Tool", decision: "hold", intendedUse: "with_students" });
    expect(JSON.stringify(s)).not.toContain("Secret");
    // The decision shown is live: approving the tool moves the page with it.
    await db.districtTool.update({ where: { id: r.toolId }, data: { decision: "approved" } });
    expect((await getRequestStatus(db, r.statusToken))?.decision).toBe("approved");
  });

  it("unknown, forged, and empty tokens read as null", async () => {
    expect(await getRequestStatus(db, "0".repeat(64))).toBeNull();
    expect(await getRequestStatus(db, "javascript:alert(1)")).toBeNull();
    expect(await getRequestStatus(db, "")).toBeNull();
    expect(await getRequestStatus(db, "   ")).toBeNull();
  });

  it("a row whose tool is gone reads as null, not a partial record", async () => {
    const r = await createToolRequest(db, dA, {
      toolName: "Doomed Tool", requesterEmail: "t@district.org", actorEmail: "t@district.org",
    });
    await db.toolRequest.delete({ where: { id: r.requestId } });
    await db.districtTool.delete({ where: { id: r.toolId } });
    expect(await getRequestStatus(db, r.statusToken)).toBeNull();
  });

  it("the owner mints a fresh token on a pre-token row; the old link dies", async () => {
    const tool = await db.districtTool.create({
      data: {
        districtId: dA, rawName: "Legacy Request Tool", aiStatus: "unknown",
        agreementStatus: "not_requested", decision: "hold", inUse: false, source: "request", notes: "",
      },
    });
    const legacy = await db.toolRequest.create({
      data: { districtId: dA, districtToolId: tool.id, requesterEmail: "old@district.org", intendedUse: "staff_only", note: "" },
    });
    expect(legacy.statusToken).toBeNull();
    const first = await mintToken(db, dA, legacy.id);
    expect(first).toMatch(HEX64);
    expect(await getRequestStatus(db, first)).toMatchObject({ toolName: "Legacy Request Tool" });
    const second = await mintToken(db, dA, legacy.id);
    expect(second).not.toBe(first);
    expect(await getRequestStatus(db, first)).toBeNull();
    expect(await getRequestStatus(db, second)).toMatchObject({ toolName: "Legacy Request Tool" });
  });

  it("minting another district's row or a missing id fails closed", async () => {
    const r = await createToolRequest(db, dB, {
      toolName: "Foreign Row", requesterEmail: "f@district.org", actorEmail: "f@district.org",
    });
    await expect(mintToken(db, dA, r.requestId)).rejects.toThrow(/Not found/);
    await expect(mintToken(db, dA, "nope")).rejects.toThrow(/Not found/);
    await expect(mintToken(db, dA, "")).rejects.toThrow(/Not found/);
    const untouched = await db.toolRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(untouched.statusToken).toBe(r.statusToken);
  });

  it("the mint action is owner-only; anonymous minting is impossible", async () => {
    const tool = await db.districtTool.create({
      data: {
        districtId: dA, rawName: "Mint Gate Tool", aiStatus: "unknown",
        agreementStatus: "not_requested", decision: "hold", inUse: false, source: "request", notes: "",
      },
    });
    const row = await db.toolRequest.create({
      data: { districtId: dA, districtToolId: tool.id, requesterEmail: "g@district.org", intendedUse: "staff_only", note: "" },
    });
    as(dA, "viewer");
    expect((await mintRequestToken(row.id)).error).toMatch(/Owner only/);
    as(dA, "curriculum");
    expect((await mintRequestToken(row.id)).error).toMatch(/Owner only/);
    mockSession.mockResolvedValue(null);
    expect((await mintRequestToken(row.id)).error).toMatch(/Owner only/);
    expect((await db.toolRequest.findUniqueOrThrow({ where: { id: row.id } })).statusToken).toBeNull();
    as(dA, "owner", "owner@token.test");
    expect(await mintRequestToken(row.id)).toEqual({});
    const minted = await db.toolRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(minted.statusToken).toMatch(HEX64);
  });

  it("the submit actions hand the token back for the one-time confirmation", async () => {
    const pub = await submitPublicRequest(dA, {
      toolName: "Public Action Token Tool", category: "General", building: "",
      intendedUse: "staff_only", requesterName: "Pat", requesterEmail: "pat@district.org", note: "",
    });
    expect(pub.error).toBeUndefined();
    expect(pub.statusToken).toMatch(HEX64);
    expect(await getRequestStatus(db, pub.statusToken!)).toMatchObject({ toolName: "Public Action Token Tool" });
    as(dA, "owner", "owner@token.test");
    const authed = await submitRequest({
      toolName: "Authed Action Token Tool", category: "General", building: "",
      intendedUse: "staff_only", requesterName: "", requesterEmail: "", note: "",
    });
    expect(authed.error).toBeUndefined();
    expect(authed.statusToken).toMatch(HEX64);
    expect(await getRequestStatus(db, authed.statusToken!)).toMatchObject({ toolName: "Authed Action Token Tool" });
  });

  it("student records in a request are still refused, token or not", async () => {
    await expect(createToolRequest(db, dA, {
      toolName: "Bad Token Tool", note: "Here are my IEP notes", actorEmail: "t@district.org",
    })).rejects.toThrow(/Refused/);
    expect(await db.toolRequest.count({ where: { districtId: dA, note: "Here are my IEP notes" } })).toBe(0);
  });
});
