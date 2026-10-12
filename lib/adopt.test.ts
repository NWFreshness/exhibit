// Adoption ordering (docs/audit-todo.md item 6): a model failure adopts
// nothing; a storage failure still adopts.
import { describe, expect, it, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/store", () => ({ putBlob: vi.fn() }));

import { sessionUser } from "@/lib/session";
import { putBlob } from "@/lib/store";
import { adoptSnapshot } from "@/app/actions/policy";
import { testDb, ensureTestClauses, makeDistrict, wipeDistrict } from "./testutil";

const db = testDb();

describe("adoptSnapshot failure order", () => {
  let dId = "";

  beforeAll(async () => {
    await ensureTestClauses(db);
    dId = (await makeDistrict(db, "adopt")).id;
    await db.districtTool.create({ data: { districtId: dId, rawName: "Adopt Tool", agreementStatus: "signed", decision: "approved" } });
    vi.mocked(sessionUser).mockResolvedValue({ id: "u", email: "owner@adopt.test", districtId: dId, role: "owner" });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  afterAll(async () => {
    await wipeDistrict(db, dId);
    await db.$disconnect();
  });

  it("a failed family letter adopts nothing", async () => {
    vi.stubEnv("LLM_STUB", "");
    vi.stubEnv("LLM_BASE_URL", "http://model.invalid");
    const reply = (ok: boolean) => ({ ok, status: ok ? 200 : 503, json: async () => ({ choices: [{ message: { content: "Purpose." } }] }) });
    // First call is the purpose paragraph, second is the family letter.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(reply(false)));
    expect((await adoptSnapshot()).error).toMatch(/family letter/);
    expect(await db.adoptedSnapshot.count({ where: { districtId: dId } })).toBe(0);
  });

  it("a failed export file still adopts, with no export key", async () => {
    vi.mocked(putBlob).mockRejectedValueOnce(new Error("disk is read-only"));
    const r = await adoptSnapshot();
    expect(r.error).toBeUndefined();
    const snap = await db.adoptedSnapshot.findUniqueOrThrow({ where: { id: r.id! } });
    expect(snap.exportKey).toBeNull();
  });
});
