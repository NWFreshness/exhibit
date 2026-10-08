import { describe, expect, it } from "vitest";
import { candidatesFromCsv } from "./csv";

describe("csv import guard", () => {
  it("accepts tool name + category", () => {
    const r = candidatesFromCsv("tool name,category\nMagicSchool AI,Teacher planning");
    expect(r.rows).toHaveLength(1);
    expect(r.rows![0]).toEqual({ name: "MagicSchool AI", category: "Teacher planning" });
  });
  it("refuses student-record columns", () => {
    for (const h of ["student roster", "grades", "IEP status", "504 plan", "discipline notes"]) {
      const r = candidatesFromCsv(`tool name,${h}\nx,y`);
      expect(r.error).toMatch(/refused/i);
      expect(r.rows).toBeUndefined();
    }
  });
  it("refuses pasted student work in cells", () => {
    const r = candidatesFromCsv("tool name,category\nMy IEP notes,General");
    expect(r.error).toMatch(/Refused/);
  });
  it("requires a tool name column", () => {
    expect(candidatesFromCsv("vendor,price\nx,1").error).toMatch(/tool name/);
  });
});
