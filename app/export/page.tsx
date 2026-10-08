import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble } from "@/lib/assembler";

export default async function ExportIndex() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId);
  const snap = await prisma.adoptedSnapshot.findFirst({ where: { districtId: user.districtId }, orderBy: { adoptedAt: "desc" } });
  return (
    <Shell user={user} title="Export">
      {out.gate.length > 0
        ? <div className="alert error"><b>Clean export is blocked.</b> Missing: {out.gate.join("; ")}.</div>
        : <div className="alert"><b>Ready for clean export.</b> All required decisions are set.</div>}
      {!snap && <div className="watermark">DRAFT — NOT ADOPTED</div>}
      <ul className="sans">
        <li><Link href="/export/board">Board draft</Link> (eight-section draft + tool table)</li>
        <li><Link href="/export/family">One-page family letter</Link></li>
        <li><Link href="/export/teacher">One-page teacher card</Link></li>
      </ul>
      <p className="hint sans">Print: use your browser&apos;s print-to-PDF. HTML export is the supported format; adopted packets are also stored to Blob.</p>
    </Shell>
  );
}
