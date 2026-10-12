import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Importer } from "./importer";
import { AuthedRequestForm } from "@/app/request/form";
import { addTool } from "@/app/actions/inventory";
import { canWrite } from "@/lib/tenancy";

export default async function InventoryPage() {
  const user = await requireUser();
  const all = await prisma.districtTool.findMany({ where: { districtId: user.districtId }, orderBy: { rawName: "asc" } });
  const tools = all.filter((t) => !t.archivedAt);
  const archived = all.filter((t) => t.archivedAt);
  const catalog = await prisma.catalogTool.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const writable = canWrite(user);

  async function add(form: FormData) {
    "use server";
    await addTool(String(form.get("tool_name") || ""), String(form.get("category") || "General"));
  }

  return (
    <Shell user={user} title="Inventory">
      <h2>This district&apos;s tools ({tools.length})</h2>
      {tools.length ? (
        <table className="sans">
          <tr><th>Tool</th><th>AI status</th><th>In use</th><th>Agreement</th><th>Decision</th><th>From</th></tr>
          {tools.map((t) => (
            <tr key={t.id}>
              <td><Link href={`/tools/${t.id}`}>{t.rawName}</Link></td>
              <td><span className="status" data-s={t.aiStatus}>{t.aiStatus.replace(/_/g, " ")}</span></td>
              <td>{t.inUse ? "Yes" : "No"}</td>
              <td>{t.agreementStatus.replace(/_/g, " ")}</td>
              <td><span className="status" data-s={t.decision}>{t.decision.toUpperCase()}</span></td>
              <td>{t.source === "request" ? "staff request" : t.source}</td>
            </tr>
          ))}
        </table>
      ) : <div className="alert">Nothing imported yet. The draft will state that no tool is approved until it clears review.</div>}
      {archived.length > 0 && (
        <details className="sans"><summary>Archived tools ({archived.length})</summary>
          <ul>{archived.map((t) => <li key={t.id}><Link href={`/tools/${t.id}`}>{t.rawName}</Link> — archived {t.archivedAt!.toISOString().slice(0, 10)}</li>)}</ul>
        </details>
      )}
      {writable && <Importer catalog={catalog} />}
      <h2>Add one tool</h2>
      {writable ? (
        <form action={add} className="sans no-print">
          <label>Tool name <input type="text" name="tool_name" required /></label>
          <label>Category <input type="text" name="category" defaultValue="General" /></label>
          <button className="btn secondary" type="submit">Add to inventory</button>
        </form>
      ) : <div className="alert">Your role is read-only.</div>}
      <div className="card no-print"><AuthedRequestForm /></div>
    </Shell>
  );
}
