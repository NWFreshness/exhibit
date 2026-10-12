import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble } from "@/lib/assembler";
import { currentPolicy } from "@/lib/policy";
import { PrintButton } from "@/app/print-button";
import { buildTrainingPacket, type SnapshotTool } from "@/lib/training";

export default async function ExportTeacherPage() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId, { prose: false });
  if (out.gate.length > 0) {
    return <Shell user={user} title="Export blocked"><div className="alert error"><b>Clean export is blocked.</b> Missing: {out.gate.join("; ")}. <Link href="/questionnaire">Complete the questionnaire</Link>.</div></Shell>;
  }
  const tools = await prisma.districtTool.findMany({ where: { districtId: user.districtId, inUse: true, archivedAt: null }, orderBy: { rawName: "asc" } });
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const packet = buildTrainingPacket({
    districtName: district.name, adoptedOn: "working draft", adoptedBy: "—",
    stale: false,
    tools: tools.map((t): SnapshotTool => ({ rawName: t.rawName, aiStatus: t.aiStatus, agreementStatus: t.agreementStatus, decision: t.decision, notes: "", teacherGuidance: t.teacherGuidance, limitText: t.limitText })),
  });
  const snap = await currentPolicy(prisma, user.districtId);
  return (
    <Shell user={user} title="Teacher card">
      {!snap && <div className="watermark">DRAFT — NOT ADOPTED</div>}
      <PrintButton />
      <div dangerouslySetInnerHTML={{ __html: packet.teacherCard }} />
    </Shell>
  );
}
