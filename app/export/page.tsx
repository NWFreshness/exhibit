import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble } from "@/lib/assembler";
import { currentPolicy } from "@/lib/policy";

export default async function ExportIndex() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId, { prose: false });
  const snap = await currentPolicy(prisma, user.districtId);
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
      <p className="hint sans">Each export has a “Save as PDF or print” button. It opens your browser&apos;s print dialog; choose “Save as PDF” there. Adopted packets are also stored as a file.</p>
    </Shell>
  );
}
