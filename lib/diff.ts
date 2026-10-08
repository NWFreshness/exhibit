// Adopted-field diff (spec 4.3). Pure comparison of the pinned snapshot tool
// table against live rows normalized to the pinned shape. No DB, no session,
// no fetch — a test names the changed field the way lib/rubric.ts is tested.
// A hash mismatch alone is never the report; the field list is.
import { latestPointerSummary, resolvedToolBands } from "./assembler";

export type PinnedRow = Record<string, unknown>;

export type LiveRowInput = {
  rawName: unknown;
  aiStatus?: unknown;
  agreementStatus?: unknown;
  decision?: unknown;
  inUse?: unknown;
  notes?: unknown;
  exhibitOverride?: unknown;
  agreements?: Array<{
    kind?: string | null;
    registryUrl?: string | null;
    registryId?: string | null;
    originator?: string | null;
    createdAt?: Date | string;
  }> | null;
  integrityK5Override?: string | null;
  integrity68Override?: string | null;
  integrity912Override?: string | null;
};

export type BandAnswers = {
  integrityK5?: string | null;
  integrity68?: string | null;
  integrity912?: string | null;
} | null | undefined;

export type DiffEntry =
  | { kind: "field"; toolName: string; field: string; before: string; after: string }
  | { kind: "added"; toolName: string }
  | { kind: "removed"; toolName: string };

const NOT_RECORDED = "not recorded at adoption";

/** Field set the diff reports, in render order. */
export const DIFF_FIELDS: Array<[key: string, label: string]> = [
  ["decision", "Decision"],
  ["aiStatus", "AI status"],
  ["agreementStatus", "Agreement"],
  ["inUse", "In use"],
  ["notes", "Note"],
  ["citationUrl", "Citation URL"],
  ["citationDate", "Citation date"],
  ["citedBy", "Cited by"],
  ["agreementKind", "Agreement kind"],
  ["registryUrl", "Registry URL"],
  ["registryId", "Registry ID"],
  ["originator", "Originator"],
  ["integrityK5", "Grade band K–5"],
  ["integrity68", "Grade band 6–8"],
  ["integrity912", "Grade band 9–12"],
];

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

/** Normalize one live DistrictTool row to the pinned snapshot shape so both
 *  sides compare key-for-key. Citation comes from the live override triple,
 *  the pointer from the latest agreement, bands resolved against answers. */
export function normalizeLiveRow(tool: LiveRowInput, answers: BandAnswers): PinnedRow {
  const over = (tool.exhibitOverride ?? {}) as Record<string, unknown>;
  const triple = (k: string): string | null =>
    typeof over[k] === "string" && over[k] !== "" ? (over[k] as string) : null;
  const pointer = latestPointerSummary(tool.agreements ?? null);
  const bands = resolvedToolBands(
    {
      integrityK5Override: tool.integrityK5Override ?? null,
      integrity68Override: tool.integrity68Override ?? null,
      integrity912Override: tool.integrity912Override ?? null,
    },
    answers
  );
  return {
    rawName: tool.rawName,
    aiStatus: tool.aiStatus ?? null,
    agreementStatus: tool.agreementStatus ?? null,
    decision: tool.decision ?? null,
    inUse: tool.inUse ?? null,
    notes: tool.notes ?? null,
    citationUrl: triple("citationUrl"),
    citationDate: triple("citationDate"),
    citedBy: triple("citedBy"),
    agreementKind: pointer?.kind ?? null,
    registryUrl: pointer?.registryUrl ?? null,
    registryId: pointer?.registryId ?? null,
    originator: pointer?.originator ?? null,
    integrityK5: bands.integrityK5,
    integrity68: bands.integrity68,
    integrity912: bands.integrity912,
  };
}

function hasKey(row: PinnedRow, key: string): boolean {
  return Object.hasOwn(row, key) && row[key] !== undefined;
}

/** Compare pinned snapshot rows against normalized live rows. Returns null
 *  when the pinned table is undecodable (caller falls back to STALE-only).
 *  Rows match by rawName in canonical order; ties pair up and extras report
 *  as added/removed. Pinned rows missing a newer key diff that field as
 *  "not recorded at adoption", never as a silent equal. */
export function diffToolTables(pinned: unknown, liveRows: PinnedRow[]): DiffEntry[] | null {
  if (!Array.isArray(pinned)) return null;
  const byName = (rows: PinnedRow[]): Map<string, PinnedRow[]> => {
    const m = new Map<string, PinnedRow[]>();
    for (const r of rows) {
      const name = typeof r.rawName === "string" ? r.rawName : String(r.rawName ?? "");
      const list = m.get(name) ?? [];
      list.push(r);
      m.set(name, list);
    }
    return m;
  };
  const names = [...new Set([...byName(pinned as PinnedRow[]).keys(), ...byName(liveRows).keys()])].sort((a, b) =>
    a.localeCompare(b)
  );
  const pinMap = byName(pinned as PinnedRow[]);
  const liveMap = byName(liveRows);
  const out: DiffEntry[] = [];
  for (const name of names) {
    const pins = pinMap.get(name) ?? [];
    const lives = liveMap.get(name) ?? [];
    const pairs = Math.min(pins.length, lives.length);
    for (let i = 0; i < pairs; i++) {
      const p = pins[i];
      const l = lives[i];
      for (const [key, label] of DIFF_FIELDS) {
        const pHas = hasKey(p, key);
        const live = l[key] ?? null;
        if (!pHas) {
          if (live !== null && live !== "") {
            out.push({ kind: "field", toolName: name, field: label, before: NOT_RECORDED, after: fmt(live) });
          }
          continue;
        }
        const before = p[key] ?? null;
        if (fmt(before) !== fmt(live)) {
          out.push({ kind: "field", toolName: name, field: label, before: fmt(before), after: fmt(live) });
        }
      }
    }
    for (let i = pairs; i < pins.length; i++) {
      void pins[i];
      out.push({ kind: "removed", toolName: name });
    }
    for (let i = pairs; i < lives.length; i++) {
      const extra = lives[i];
      if (extra.inUse === true) out.push({ kind: "added", toolName: name });
    }
  }
  return out;
}
