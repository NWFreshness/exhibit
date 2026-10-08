import { notFound } from "next/navigation";
import { Shell } from "@/app/shell";
import { prisma } from "@/lib/prisma";
import { projectExhibitRows } from "@/lib/exhibit";

// Public adopted list (spec 4.4): no session. Reads only the latest adopted
// snapshot for the district in the URL — never the live inventory. Shows tool
// name, adopted decision, and grade band. Never notes, emails, comments,
// exhibit free text, registry ids, or free-text answers.
export default async function PublicExhibitPage({ params }: { params: Promise<{ districtId: string }> }) {
  const { districtId } = await params;
  const district = await prisma.district.findUnique({ where: { id: districtId } });
  if (!district) notFound();
  const snap = await prisma.adoptedSnapshot.findFirst({
    where: { districtId: district.id }, orderBy: { adoptedAt: "desc" },
  });
  if (!snap) {
    return (
      <Shell user={null} title={`${district.name} — adopted tools`}>
        <div className="alert">Nothing adopted yet. The council has not adopted a policy snapshot, so there is no public list.</div>
      </Shell>
    );
  }
  const list = projectExhibitRows(snap.toolTable, snap.answersJson);
  return (
    <Shell user={null} title={`${district.name} — adopted tools`}>
      <p className="sans">Adopted {snap.adoptedAt.toISOString().slice(0, 10)}. Tools the council has approved or limited, with grade-band rules. Anything not listed here is not permitted for student use.</p>
      {list.legacyBands && (
        <p className="hint sans">Grade bands below come from this snapshot&apos;s pinned district answers — per-tool bands were not recorded at adoption.</p>
      )}
      {list.rows.length ? (
        <table className="sans"><tr><th>Tool</th><th>Decision</th><th>K–5</th><th>6–8</th><th>9–12</th></tr>
          {list.rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.decision.toUpperCase()}</td>
              <td>{r.bands.k5}</td>
              <td>{r.bands.g68}</td>
              <td>{r.bands.g912}</td>
            </tr>
          ))}
        </table>
      ) : <p className="hint sans">No tools in this snapshot.</p>}
    </Shell>
  );
}
