import { describe, expect, it } from "vitest";
import { buildTrainingPacket, agreementPill } from "./training";

const TOOLS = [
  { rawName: "Quizizz AI", aiStatus: "calls_model", agreementStatus: "signed", decision: "approved", notes: "" },
  { rawName: "Diffit", aiStatus: "calls_model", agreementStatus: "refused", decision: "banned", notes: "" },
];

describe("training packet", () => {
  it("is built from the adopted snapshot, with a stale banner when behind", () => {
    const p = buildTrainingPacket({
      districtName: "Test", adoptedOn: "2026-01-01", adoptedBy: "o@t",
      stale: true, tools: TOOLS,
    });
    expect(p.principalScript).toContain("behind the inventory");
    expect(p.principalScript).toContain("Quizizz AI");
    expect(p.teacherCard).toContain("Diffit");
    expect(p.teacherCard).toContain("ag-signed");
    expect(p.teacherCard).toContain("ag-refused");
  });
  it("colors agreement words by severity", () => {
    expect(agreementPill("signed")).toContain("ag-signed");
    expect(agreementPill("refused")).toContain("ag-refused");
    expect(agreementPill("expired")).toContain("ag-expired");
    expect(agreementPill("not_requested")).toContain("ag-not_requested");
    expect(agreementPill("signed")).toContain("Signed");
  });
  it("live edits never leak in: packet ignores tools not in the snapshot", () => {
    const p = buildTrainingPacket({
      districtName: "Test", adoptedOn: "2026-01-01", adoptedBy: "o@t",
      stale: false, tools: TOOLS,
    });
    expect(p.teacherCard).not.toContain("Brand New Tool");
    expect(p.principalScript).not.toContain("behind the inventory");
  });
});
