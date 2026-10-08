import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble } from "@/lib/assembler";
import { buildTrainingPacket, type SnapshotTool } from "@/lib/training";

export default async function ExportTeacherPage() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId);
  if (out.gate.length > 0) {
    return <Shell user={user} title="Export blocked"><div className="alert error"><b>Clean export is blocked.</b> Missing: {out.gate.join("; ")}. <Link href="/questionnaire">Complete the questionnaire</Link>.</div></Shell>;
  }
  const tools = await prisma.districtTool.findMany({ where: { districtId: user.districtId, inUse: true }, orderBy: { rawName: "asc" } });
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const packet = buildTrainingPacket({
    districtName: district.name, adoptedOn: "working draft", adoptedBy: "—",
    stale: false,
    tools: tools.map((t): SnapshotTool => ({ rawName: t.rawName, aiStatus: t.aiStatus, agreementStatus: t.agreementStatus, decision: t.decision, notes: t.notes })),
  });
  const snap = await prisma.adoptedSnapshot.findFirst({ where: { districtId: user.districtId }, orderBy: { adoptedAt: "desc" } });
  return (
    <Shell user={user} title="Teacher card">
      {!snap && <div className="watermark">DRAFT — NOT ADOPTED</div>}
      <div dangerouslySetInnerHTML={{ __html: packet.teacherCard }} />
    </Shell>
  );
}
