// CSV import parsing + student-record refusal. Contracts and district
// documents only: tool name + category. Anything resembling student records
// is refused before it touches the database.
import { refuseStudentData } from "./guard";

const FORBIDDEN_COLUMNS = [
  "student", "roster", "grade", "iep", "504", "discipline",
  "attendance", "gpa", "dob", "ssid", "transcript",
];

export type ParsedCsv = { headers: string[]; rows: string[][] };

export function parseCsv(text: string): ParsedCsv {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  return { headers: split(lines[0]).map((h) => h.toLowerCase()), rows: lines.slice(1).map(split) };
}

export type ImportCandidate = { name: string; category: string };

/** Returns candidates or a refusal error. Never throws on hostile input. */
export function candidatesFromCsv(text: string): { rows?: ImportCandidate[]; error?: string } {
  const { headers, rows } = parseCsv(text);
  if (!headers.length) return { error: "Empty CSV. Include a header row: tool name, category." };
  const bad = headers.filter((h) => FORBIDDEN_COLUMNS.some((f) => h.includes(f)));
  if (bad.length) {
    return { error: `Import refused: column(s) ${bad.join(", ")} suggest student records. Uploads are contracts and district documents only.` };
  }
  const ni = headers.includes("tool name") ? headers.indexOf("tool name") : headers.indexOf("tool");
  if (ni < 0) return { error: `CSV must have a "tool name" column. Found: ${headers.join(", ")}.` };
  const ci = headers.includes("category") ? headers.indexOf("category") : -1;
  const cands = rows.slice(0, 100)
    .map((r) => ({ name: (r[ni] || "").trim(), category: ci >= 0 ? (r[ci] || "").trim() || "General" : "General" }))
    .filter((r) => r.name);
  if (!cands.length) return { error: "No tool rows found." };
  for (const c of cands) {
    const blocked = refuseStudentData(c.name) || refuseStudentData(c.category);
    if (blocked) return { error: blocked };
  }
  return { rows: cands };
}
