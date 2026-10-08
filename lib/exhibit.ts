// Public adopted list projector (spec 4.4). Pure shaping of the latest
// snapshot's tool table into the only three things families see: tool name,
// adopted decision, and grade band. Everything else on the row (notes,
// emails, exhibit free text, registry ids) is dropped here, so the page
// cannot render it. No DB, no session, no fetch.
export type ExhibitBand = { k5: string; g68: string; g912: string };

export type ExhibitRow = {
  name: string;
  decision: string;
  bands: ExhibitBand;
  /** True when the row predates per-tool bands and fell back to answers. */
  legacyBands: boolean;
};

export type ExhibitList = { rows: ExhibitRow[]; legacyBands: boolean };

const BAND_WORDS: Record<string, string> = {
  red: "not permitted for student use",
  yellow: "teacher-guided classroom use only",
  green: "permitted with citation and teacher review",
};

function words(v: unknown): string {
  return typeof v === "string" && BAND_WORDS[v] ? BAND_WORDS[v] : "to be decided";
}

function hasBandKeys(row: Record<string, unknown>): boolean {
  return row.integrityK5 !== undefined || row.integrity68 !== undefined || row.integrity912 !== undefined;
}

/** Shape the snapshot tool table plus its pinned answers into public rows.
 *  Rows without band keys fall back to the snapshot's answersJson enums only —
 *  never today's questionnaire (the caller passes the snapshot's copy).
 *  Non-object rows are skipped defensively. */
export function projectExhibitRows(toolTable: unknown, answersJson: unknown): ExhibitList {
  if (!Array.isArray(toolTable)) return { rows: [], legacyBands: false };
  const answers = (answersJson ?? {}) as Record<string, unknown>;
  const rows: ExhibitRow[] = [];
  let legacyBands = false;
  for (const raw of toolTable) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.rawName !== "string" || typeof row.decision !== "string") continue;
    const legacy = !hasBandKeys(row);
    if (legacy) legacyBands = true;
    rows.push({
      name: row.rawName,
      decision: row.decision,
      bands: {
        k5: words(legacy ? answers.integrityK5 : row.integrityK5),
        g68: words(legacy ? answers.integrity68 : row.integrity68),
        g912: words(legacy ? answers.integrity912 : row.integrity912),
      },
      legacyBands: legacy,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, legacyBands };
}
