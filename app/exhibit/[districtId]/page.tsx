import { notFound } from "next/navigation";
import { Shell } from "@/app/shell";
import { prisma } from "@/lib/prisma";
import { projectExhibitRows } from "@/lib/exhibit";
import { currentPolicy, toolListFor } from "@/lib/policy";
import { Lookup } from "./lookup";

// Public adopted list (spec 4.4): no session. Reads only the tool list
// published under the board-adopted policy for the district in the URL —
// never the live inventory, never a policy the board has not adopted. Shows
// tool name, decision, grade band, and teacher guidance. Never internal
// notes, emails, comments, exhibit free text, registry ids, or free-text answers.
export default async function PublicExhibitPage({ params }: { params: Promise<{ districtId: string }> }) {
  const { districtId } = await params;
  const district = await prisma.district.findUnique({ where: { id: districtId } });
  if (!district) notFound();
  const policy = await currentPolicy(prisma, district.id);
  if (!policy) {
    return (
      <Shell user={null} title={`${district.name} — adopted tools`}>
        <div className="alert">Nothing adopted yet. The board has not adopted a policy, so there is no public list.</div>
      </Shell>
    );
  }
  const toolList = await toolListFor(prisma, policy);
  const list = projectExhibitRows(toolList.toolTable, policy.answersJson);
  return (
    <Shell user={null} title={`${district.name} — adopted tools`}>
      <p className="sans">Policy adopted by the board {policy.boardAdoptedOn!.toISOString().slice(0, 10)}. Tool list published {toolList.publishedAt.toISOString().slice(0, 10)}. Only tools marked APPROVED or LIMITED may be used. Anything else, or anything not listed here, is not permitted for student use.</p>
      {list.legacyBands && (
        <p className="hint sans">Grade bands below come from this snapshot&apos;s pinned district answers — per-tool bands were not recorded at adoption.</p>
      )}
      {list.rows.length ? <Lookup rows={list.rows} districtId={district.id} /> : <p className="hint sans">No tools in this list.</p>}
    </Shell>
  );
}
