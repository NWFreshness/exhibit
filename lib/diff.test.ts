import { describe, expect, it } from "vitest";
import { diffToolTables, normalizeLiveRow, type PinnedRow } from "./diff";

const ANSWERS = { integrityK5: "red", integrity68: "yellow", integrity912: "green" };

function live(over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): PinnedRow {
  return normalizeLiveRow(
    {
      rawName: "Diff Tool",
      aiStatus: "calls_model",
      agreementStatus: "signed",
      decision: "hold",
      inUse: true,
      notes: "",
      exhibitOverride: {},
      agreements: [],
      integrityK5Override: null,
      integrity68Override: null,
      integrity912Override: null,
      ...over,
    },
    ANSWERS
  );
}

function pinned(over: Record<string, unknown> = {}): PinnedRow {
  return {
    rawName: "Diff Tool",
    aiStatus: "calls_model",
    agreementStatus: "signed",
    decision: "hold",
    inUse: true,
    notes: "",
    citationUrl: null,
    citationDate: null,
    citedBy: null,
    agreementKind: null,
    registryUrl: null,
    registryId: null,
    originator: null,
    integrityK5: "red",
    integrity68: "yellow",
    integrity912: "green",
    ...over,
  };
}

describe("diffToolTables", () => {
  it("names a lone decision move with before and after", () => {
    const entries = diffToolTables(
      [pinned()],
      [{ ...live(), decision: "approved" }]
    )!;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      kind: "field", toolName: "Diff Tool", field: "Decision", before: "hold", after: "approved",
    });
  });

  it("a citation-only move names citation fields and nothing else", () => {
    const entries = diffToolTables(
      [pinned()],
      [live({ exhibitOverride: { usedForTraining: false, citationUrl: "https://v.example/dpa", citationDate: "2026-10-08", citedBy: "c@x" } })]
    )!;
    expect(entries.map((e) => e.kind === "field" ? e.field : e.kind).sort()).toEqual(
      ["Citation URL", "Citation date", "Cited by"].sort()
    );
    expect(entries[0]).toMatchObject({ toolName: "Diff Tool", before: "—" });
  });

  it("a pointer-only move names the pointer summary and nothing else", () => {
    const entries = diffToolTables(
      [pinned()],
      [live({ agreements: [{ kind: "alliance_pointer", registryUrl: "https://p.example/r", registryId: "R-1", originator: "WA", createdAt: new Date() }] })]
    )!;
    expect(entries.map((e) => e.kind === "field" ? e.field : e.kind).sort()).toEqual(
      ["Agreement kind", "Originator", "Registry ID", "Registry URL"].sort()
    );
  });

  it("a band-only move names the grade band and nothing else", () => {
    const entries = diffToolTables(
      [pinned()],
      [live({ integrityK5Override: "green" })]
    )!;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      kind: "field", toolName: "Diff Tool", field: "Grade band K–5", before: "red", after: "green",
    });
  });

  it("matching tables diff to an empty list", () => {
    expect(diffToolTables([pinned()], [live()])).toEqual([]);
    expect(diffToolTables([], [])).toEqual([]);
  });

  it("legacy pinned rows without newer keys read as not recorded at adoption", () => {
    const legacy = {
      rawName: "Diff Tool", aiStatus: "calls_model", agreementStatus: "signed",
      decision: "hold", inUse: true, notes: "",
    };
    const entries = diffToolTables(
      [legacy],
      [live({
        exhibitOverride: { citationUrl: "https://v.example/dpa", citationDate: "2026-10-08", citedBy: "c@x" },
        agreements: [{ kind: "alliance_pointer", registryUrl: "https://p.example/r", registryId: "R-1", originator: "WA", createdAt: new Date() }],
        integrityK5Override: "green",
      })]
    )!;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.kind === "field" && e.before === "not recorded at adoption")).toBe(true);
    expect(entries.map((e) => e.kind === "field" ? e.field : "")).toContain("Grade band K–5");
  });

  it("legacy rows stay silent when the live side has no new facts", () => {
    const legacy = {
      rawName: "Diff Tool", aiStatus: "calls_model", agreementStatus: "signed",
      decision: "hold", inUse: true, notes: "",
    };
    const bare = normalizeLiveRow(
      {
        rawName: "Diff Tool", aiStatus: "calls_model", agreementStatus: "signed",
        decision: "hold", inUse: true, notes: "", exhibitOverride: {}, agreements: [],
        integrityK5Override: null, integrity68Override: null, integrity912Override: null,
      },
      null
    );
    // No questionnaire bands and no overrides: bands resolve null on both sides.
    const liveBare = { ...bare, integrityK5: null, integrity68: null, integrity912: null };
    expect(diffToolTables([legacy], [liveBare])).toEqual([]);
  });

  it("added and removed tools report by name; idle live-only rows stay silent", () => {
    const gone = pinned({ rawName: "Gone Tool" });
    const entries = diffToolTables(
      [pinned(), gone],
      [
        live(),
        {
          ...live(), rawName: "New Tool", decision: "hold", inUse: true,
        } as PinnedRow,
        { ...live(), rawName: "Idle Tool", inUse: false } as PinnedRow,
      ]
    )!;
    expect(entries).toContainEqual({ kind: "removed", toolName: "Gone Tool" });
    expect(entries).toContainEqual({ kind: "added", toolName: "New Tool" });
    expect(entries.some((e) => e.toolName === "Idle Tool")).toBe(false);
  });

  it("an undecodable pinned table returns null for the STALE-only fallback", () => {
    expect(diffToolTables(null, [live()])).toBeNull();
    expect(diffToolTables("nope", [live()])).toBeNull();
    expect(diffToolTables({ rows: [] }, [live()])).toBeNull();
  });

  it("normalizeLiveRow resolves bands against answers and picks the latest agreement", () => {
    const row = normalizeLiveRow(
      {
        rawName: "T", aiStatus: "calls_model", agreementStatus: "signed", decision: "hold",
        inUse: true, notes: "n", exhibitOverride: { citationUrl: "https://v.example/x" },
        agreements: [
          { kind: "local_upload", createdAt: new Date("2026-01-01") },
          { kind: "alliance_pointer", registryUrl: "https://p.example/2", registryId: "R-2", originator: "OR", createdAt: new Date("2026-10-01") },
        ],
        integrityK5Override: "green", integrity68Override: null, integrity912Override: null,
      },
      ANSWERS
    );
    expect(row).toMatchObject({
      citationUrl: "https://v.example/x", citationDate: null,
      agreementKind: "alliance_pointer", registryId: "R-2", originator: "OR",
      integrityK5: "green", integrity68: "yellow", integrity912: "green",
    });
  });
});
