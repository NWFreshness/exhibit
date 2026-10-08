import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function yn(v: boolean | null) {
  if (v === null || v === undefined) return <span className="unknown">Unknown</span>;
  return v ? "Yes" : "No";
}

export default async function CatalogPage() {
  const user = await requireUser();
  const tools = await prisma.catalogTool.findMany({ orderBy: { name: "asc" } });
  return (
    <Shell user={user} title="Catalog">
      <p className="sans">Shared catalog. Districts cannot edit these rows. Exhibit facts are <b>Unknown</b> unless verified — vendor facts are never invented.</p>
      <table className="sans">
        <tr><th>Tool</th><th>Vendor</th><th>Category</th><th>Typical AI status</th><th>Training use</th><th>Source</th></tr>
        {tools.map((t) => (
          <tr key={t.id}>
            <td>{t.name}</td><td>{t.vendor}</td><td>{t.category}</td>
            <td><span className="status">{t.typicalAiStatus.replace(/_/g, " ")}</span></td>
            <td>{yn(t.usedForTraining)}</td>
            <td>{t.sourceUrl ? <a href={t.sourceUrl}>source</a> : <span className="unknown">Unknown</span>}</td>
          </tr>
        ))}
      </table>
    </Shell>
  );
}
