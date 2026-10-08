import { describe, expect, it } from "vitest";
import { evaluateRubric, mergedExhibit } from "./rubric";

describe("rubric", () => {
  it("no agreement means hold", () => {
    const r = evaluateRubric({ aiStatus: "calls_model", agreementStatus: "not_requested", usedForTraining: false, agreementAddressesTraining: true });
    expect(r.verdict).toBe("hold");
  });
  it("refused agreement means hold", () => {
    const r = evaluateRubric({ aiStatus: "calls_model", agreementStatus: "refused", usedForTraining: false, agreementAddressesTraining: true });
    expect(r.verdict).toBe("hold");
  });
  it("expired agreement means hold", () => {
    const r = evaluateRubric({ aiStatus: "calls_model", agreementStatus: "expired", usedForTraining: false, agreementAddressesTraining: true });
    expect(r.verdict).toBe("hold");
  });
  it("training use means limited, never approved", () => {
    const r = evaluateRubric({ aiStatus: "calls_model", agreementStatus: "signed", usedForTraining: true, agreementAddressesTraining: true });
    expect(r.verdict).toBe("limited");
    expect(r.label).toMatch(/Banned/);
  });
  it("unknown training status means hold, not approved", () => {
    const r = evaluateRubric({ aiStatus: "calls_model", agreementStatus: "signed", usedForTraining: null, agreementAddressesTraining: true });
    expect(r.verdict).toBe("hold");
  });
  it("agreement silent on training means hold", () => {
    const r = evaluateRubric({ aiStatus: "calls_model", agreementStatus: "signed", usedForTraining: false, agreementAddressesTraining: null });
    expect(r.verdict).toBe("hold");
  });
  it("signed + no training + addressed agreement is clear", () => {
    const r = evaluateRubric({ aiStatus: "calls_model", agreementStatus: "signed", usedForTraining: false, agreementAddressesTraining: true });
    expect(r.verdict).toBe("clear");
  });
  it("does not call a model: out of scope, not approved-for-AI", () => {
    const r = evaluateRubric({ aiStatus: "no_model", agreementStatus: "signed", usedForTraining: false, agreementAddressesTraining: true });
    expect(r.verdict).toBe("out_of_scope");
  });
  it("unknown AI status with no agreement is hold", () => {
    const r = evaluateRubric({ aiStatus: "unknown", agreementStatus: "not_requested" });
    expect(r.verdict).toBe("hold");
  });
  it("district override wins over catalog exhibit per field", () => {
    const m = mergedExhibit({ usedForTraining: null }, { usedForTraining: false, trainingAddressed: true });
    expect(m.usedForTraining).toBe(false);
    expect(m.agreementAddressesTraining).toBe(true);
  });
  it("override covers every exhibit field; empty falls back to catalog, then Unknown", () => {
    const m = mergedExhibit(
      { retention: null, whoseModel: "Vendor X", usedForTraining: true },
      { retention: "Deleted after 30 days", whoseModel: "", usedForTraining: false }
    );
    expect(m.retention).toBe("Deleted after 30 days");
    expect(m.whoseModel).toBe("Vendor X");
    expect(m.usedForTraining).toBe(false);
    expect(m.optOut).toBeNull();
  });
});
