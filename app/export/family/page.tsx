import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble, familyLetter } from "@/lib/assembler";

export default async function ExportFamilyPage() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId);
  if (out.gate.length > 0) {
    return <Shell user={user} title="Export blocked"><div className="alert error"><b>Clean export is blocked.</b> Missing: {out.gate.join("; ")}. <Link href="/questionnaire">Complete the questionnaire</Link>.</div></Shell>;
  }
  const letter = await familyLetter(prisma, user.districtId);
  const snap = await prisma.adoptedSnapshot.findFirst({ where: { districtId: user.districtId }, orderBy: { adoptedAt: "desc" } });
  return (
    <Shell user={user} title="Family letter">
      {!snap && <div className="watermark">DRAFT — NOT ADOPTED</div>}
      <div dangerouslySetInnerHTML={{ __html: letter }} />
      <p className="hint sans">Grade-band rules: see board draft §4.</p>
    </Shell>
  );
}
