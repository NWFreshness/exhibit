"use client";
import { useState } from "react";
import Link from "next/link";
import type { ExhibitRow } from "@/lib/exhibit";

const BANDS = [["", "Any grade"], ["k5", "K–5"], ["g68", "6–8"], ["g912", "9–12"]] as const;

// Teacher lookup: "can I use X with my grade?" Filters the adopted list in the
// browser; nothing is fetched and nothing beyond the projected rows is here.
export function Lookup({ rows, districtId }: { rows: ExhibitRow[]; districtId: string }) {
  const [q, setQ] = useState("");
  const [band, setBand] = useState<"" | "k5" | "g68" | "g912">("");
  const shown = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const usable = (r: ExhibitRow) => r.decision === "approved" || r.decision === "limited";
  return (
    <>
      <form className="sans no-print" role="search" onSubmit={(e) => e.preventDefault()}>
        <label>Find a tool <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a tool name" /></label>
        <label>Grade band <select value={band} onChange={(e) => setBand(e.target.value as typeof band)}>
          {BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      </form>
      <p className="hint sans" aria-live="polite">{shown.length} of {rows.length} tools shown.</p>
      {shown.length ? (
        <table className="sans">
          <thead><tr><th>Tool</th><th>Decision</th>{band ? <th>{BANDS.find(([v]) => v === band)![1]}</th> : <><th>K–5</th><th>6–8</th><th>9–12</th></>}<th>Guidance</th></tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.name}-${i}`}>
                <td>{r.name}</td>
                <td><span className="status" data-s={r.decision}>{r.decision.toUpperCase()}</span></td>
                {band
                  ? <td>{usable(r) ? r.bands[band] : "not permitted for student use"}</td>
                  : usable(r)
                    ? <><td>{r.bands.k5}</td><td>{r.bands.g68}</td><td>{r.bands.g912}</td></>
                    : <td colSpan={3}>not permitted for student use</td>}
                <td>{r.guidance ?? (usable(r) ? "—" : "Do not use with students.")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="alert stale">
          <b>Not on the adopted list.</b> A tool that is not listed is not permitted for student use. <Link href={`/request/${districtId}`}>Ask the council to review it</Link>.
        </div>
      )}
    </>
  );
}
