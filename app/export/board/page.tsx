import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble } from "@/lib/assembler";
import { currentPolicy } from "@/lib/policy";
import { PrintButton } from "@/app/print-button";

async function gated() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId, { prose: false });
  const blocked = out.gate.length > 0 ? out.gate : null;
  const snap = await currentPolicy(prisma, user.districtId);
  return { user, out, blocked, snap };
}

export default async function ExportBoardPage() {
  const { user, out, blocked, snap } = await gated();
  if (blocked) {
    return <Shell user={user} title="Export blocked"><div className="alert error"><b>Clean export is blocked.</b> Missing: {blocked.join("; ")}. <Link href="/questionnaire">Complete the questionnaire</Link>.</div></Shell>;
  }
  return (
    <Shell user={user} title="Board draft">
      {!snap && <div className="watermark">DRAFT — NOT ADOPTED</div>}
      {snap && <p className="sans">Adopted by the board {snap.boardAdoptedOn!.toISOString().slice(0, 10)}{snap.boardResolution ? `, resolution ${snap.boardResolution}` : ""}. Council approval recorded by {snap.adoptedBy}.</p>}
      <PrintButton />
      {out.sections.map((s) => <section key={s.n}><h2>{s.n}. {s.title}</h2><div dangerouslySetInnerHTML={{ __html: s.html }} /></section>)}
    </Shell>
  );
}
