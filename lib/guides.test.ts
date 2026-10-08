import { describe, expect, it } from "vitest";
import { buildToolGuides } from "./guides";

const ANSWERS = {
  integrityK5: "red", integrity68: "yellow", integrity912: "green",
  dataRule: "no_student_pii", noTrainingRule: "require_addendum", disclosure: "required",
} as Parameters<typeof buildToolGuides>[1];

const TOOLS = [
  { rawName: "Quizizz AI", category: "Assessment", aiStatus: "calls_model", agreementStatus: "signed", decision: "approved", notes: "Assessment use only." },
  { rawName: "Khanmigo", category: "Tutoring aid", aiStatus: "calls_model", agreementStatus: "signed", decision: "limited", notes: "Grades 6-12 pilot." },
  { rawName: "Diffit", category: "Differentiation", aiStatus: "calls_model", agreementStatus: "refused", decision: "banned", notes: "" },
  { rawName: "MagicSchool AI", category: "Teacher planning", aiStatus: "calls_model", agreementStatus: "not_requested", decision: "hold", notes: "" },
];

describe("tool guides", () => {
  it("covers approved + limited only, with limits and rules, no vendor claims", () => {
    const guides = buildToolGuides(TOOLS, ANSWERS, "Test District", "Director");
    expect(guides.map((g) => g.toolName).sort()).toEqual(["Khanmigo", "Quizizz AI"]);
    const q = guides.find((g) => g.toolName === "Quizizz AI")!;
    expect(q.html).toContain("Assessment use only.");
    expect(q.html).toContain("no_student_pii");
    expect(q.html).toContain("Director");
    expect(q.html).toContain("ag-signed");
    expect(q.html).not.toContain("Diffit");
  });
  it("says plainly when limits are missing", () => {
    const guides = buildToolGuides(
      [{ ...TOOLS[0], notes: "" }], ANSWERS, "Test District", "Director"
    );
    expect(guides[0].html).toContain("No extra limits recorded");
  });
});
