import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble } from "@/lib/assembler";

async function gated() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId);
  const blocked = out.gate.length > 0 ? out.gate : null;
  const snap = await prisma.adoptedSnapshot.findFirst({ where: { districtId: user.districtId }, orderBy: { adoptedAt: "desc" } });
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
      {snap && <p className="sans">Adopted {snap.adoptedAt.toISOString().slice(0, 10)} by {snap.adoptedBy}.</p>}
      {out.sections.map((s) => <section key={s.n}><h2>{s.n}. {s.title}</h2><div dangerouslySetInnerHTML={{ __html: s.html }} /></section>)}
    </Shell>
  );
}
