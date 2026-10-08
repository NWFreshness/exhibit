import { describe, expect, it } from "vitest";
import { evaluateRubric, mergedExhibit, citationQueueReasons, inCitationQueue, isCitationUrlValid, withCitation } from "./rubric";

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

describe("citation queue membership (pure)", () => {
  it("unknown training use queues the tool even without a signed agreement", () => {
    const m = mergedExhibit({ usedForTraining: null }, null);
    expect(citationQueueReasons(m, "not_requested")).toEqual(["Training use unknown"]);
    expect(inCitationQueue(m, "not_requested")).toBe(true);
  });
  it("signed-but-silent agreement queues the tool when training use is known", () => {
    const m = mergedExhibit(null, { usedForTraining: false });
    expect(citationQueueReasons(m, "signed")).toEqual(["Agreement silent on training"]);
  });
  it("signed agreement with trainingAddressed false stays queued (rubric hold)", () => {
    const m = mergedExhibit(null, { usedForTraining: false, trainingAddressed: false });
    expect(inCitationQueue(m, "signed")).toBe(true);
  });
  it("unsigned tools never queue for the agreement reason", () => {
    const m = mergedExhibit(null, { usedForTraining: false });
    expect(citationQueueReasons(m, "expired")).toEqual([]);
    expect(citationQueueReasons(m, "refused")).toEqual([]);
  });
  it("a tool with full findings is absent", () => {
    const m = mergedExhibit(null, { usedForTraining: false, trainingAddressed: true });
    expect(citationQueueReasons(m, "signed")).toEqual([]);
    expect(inCitationQueue(m, "signed")).toBe(false);
  });
  it("empty retention, opt-out, or subprocessor text never queues a tool", () => {
    const m = mergedExhibit({ retention: null, optOut: null, subprocessors: null }, { usedForTraining: true, trainingAddressed: true });
    expect(m.retention).toBeNull();
    expect(inCitationQueue(m, "signed")).toBe(false);
  });
  it("seed-shaped Cedar Ridge rows: unknown and silent queue, full is absent", () => {
    // Quizizz AI shape: signed, district-confirmed no training, no trainingAddressed -> queued.
    const quizizz = mergedExhibit(null, { usedForTraining: false });
    expect(inCitationQueue(quizizz, "signed")).toBe(true);
    // Fully cited shape: absent.
    const cited = mergedExhibit(null, { usedForTraining: false, trainingAddressed: true });
    expect(inCitationQueue(cited, "signed")).toBe(false);
    // MagicSchool shape: unknown training, no agreement -> queued for training reason only.
    const magic = mergedExhibit(null, null);
    expect(citationQueueReasons(magic, "not_requested")).toEqual(["Training use unknown"]);
  });
});

describe("citation url + override merge (pure)", () => {
  it("requires an http(s) scheme with a host", () => {
    expect(isCitationUrlValid("https://vendor.example/dpa")).toBe(true);
    expect(isCitationUrlValid("http://vendor.example/dpa")).toBe(true);
    expect(isCitationUrlValid("")).toBe(false);
    expect(isCitationUrlValid("vendor.example/dpa")).toBe(false);
    expect(isCitationUrlValid("javascript:alert(1)")).toBe(false);
    expect(isCitationUrlValid("data:text/plain,hi")).toBe(false);
    expect(isCitationUrlValid("ftp://vendor.example/f")).toBe(false);
  });
  it("withCitation preserves existing override keys and never touches notes", () => {
    const next = withCitation(
      { retention: "Deleted after 30 days", usedForTraining: false },
      { trainingAddressed: true },
      { citationUrl: "https://vendor.example/dpa", citationDate: "2026-10-08", citedBy: "curriculum@x" }
    );
    expect(next).toMatchObject({
      retention: "Deleted after 30 days",
      usedForTraining: false,
      trainingAddressed: true,
      citationUrl: "https://vendor.example/dpa",
      citationDate: "2026-10-08",
      citedBy: "curriculum@x",
    });
    expect("notes" in next).toBe(false);
  });
});
