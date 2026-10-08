// Ban enforcement: no field may hold student records, rosters, grades, IEPs,
// 504s, discipline notes, or pasted student work. Server-side refusal.
const PATTERNS = [
  /\bIEP\b/i,
  /\b504\b/,
  /\bgradebook\b/i,
  /\broster\b/i,
  /date of birth/i,
  /\bDOB\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /discipline referral/i,
  /report card/i,
];

export function refuseStudentData(text: string): string | null {
  if (!text) return null;
  if (PATTERNS.some((p) => p.test(text))) {
    return "Refused: never enter student records, rosters, grades, IEPs, 504s, discipline notes, or pasted student work. Contracts and district documents only.";
  }
  return null;
}
