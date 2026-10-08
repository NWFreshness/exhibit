"use client";
import { useActionState } from "react";
import { previewFormAction, confirmFormAction, type PreviewRow } from "@/app/actions/inventory";

type PreviewState = { rows?: PreviewRow[]; error?: string } | null;
type ConfirmState = { count?: number; error?: string } | null;

export function Importer({ catalog }: { catalog: Array<{ id: string; name: string }> }) {
  const [preview, previewAction] = useActionState<PreviewState, FormData>(
    async (_s, fd) => previewFormAction(fd),
    null
  );
  const [confirmed, confirmAction] = useActionState<ConfirmState, FormData>(
    async (_s, fd) => confirmFormAction(fd),
    null
  );
  const rows = preview?.rows ?? null;

  return (
    <div>
      <h2>Import (CSV)</h2>
      <p className="hint sans">CSV columns: <code>tool name, category</code> only. Contracts and district documents only — never student records, rosters, grades, IEPs, 504s, discipline notes, or pasted student work.</p>
      <form action={previewAction} className="sans no-print">
        <label>Paste CSV (header + rows)<textarea name="csv" rows={5} placeholder="tool name,category" /></label>
        <button className="btn" type="submit">Preview match</button>
      </form>
      {preview?.error && <div className="alert error">{preview.error}</div>}
      {confirmed?.error && <div className="alert error">{confirmed.error}</div>}
      {confirmed?.count !== undefined && !confirmed.error && <div className="alert">{confirmed.count} tool(s) added to inventory.</div>}
      {rows && (
        <form action={confirmAction} className="sans">
          <h3>Confirm match — nothing saved yet</h3>
          {rows.map((row, k) => (
            <div className="card" key={k}>
              <b>{row.name}</b> <span className="hint">({row.category})</span>
              <label>Match to catalog
                <select name={`m${k}`} defaultValue={row.suggestion?.id ?? ""}>
                  <option value="">No match — district-only tool</option>
                  {catalog.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <input type="hidden" name={`n${k}`} value={row.name} />
              <input type="hidden" name={`c${k}`} value={row.category} />
            </div>
          ))}
          <input type="hidden" name="count" value={rows.length} />
          <button className="btn" type="submit">Save to inventory</button>
        </form>
      )}
    </div>
  );
}
