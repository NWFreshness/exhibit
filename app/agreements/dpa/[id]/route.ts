import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { sessionUser } from "@/lib/session";
import { canWrite } from "@/lib/tenancy";
import { esc } from "@/lib/escape";

// Owner download: DPA/no-training request letter rendered from the clause
// library. Exhibit sends no mail in this phase.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user || !canWrite(user)) {
    return new Response("Sign in with a staff role.", { status: 403 });
  }
  const { id } = await params;
  const tool = await prisma.districtTool.findFirst({
    where: { id, districtId: user.districtId },
    include: { catalogTool: true },
  });
  if (!tool) notFound();
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const row = await prisma.questionnaireAnswer.findUnique({ where: { districtId: user.districtId } });
  const answers = (row?.answers ?? {}) as Record<string, string>;
  const clause = await prisma.clause.findFirst({ where: { id: "dpa_request" }, orderBy: { version: "desc" } });
  const today = new Date().toISOString().slice(0, 10);
  const vars: Record<string, string> = {
    vendor_contact: tool.vendorContact || "[vendor contact]",
    tool_name: tool.rawName,
    district_name: district.name,
    owner_name: answers.ownerName || "Technology Director",
    retention: (tool.exhibitOverride as Record<string, string> | null)?.retention || "the agreed period",
    date: today,
  };
  let body = clause?.body ?? "Please sign our no-training addendum for {{tool_name}}.";
  for (const [k, v] of Object.entries(vars)) body = body.replaceAll(`{{${k}}}`, v);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>DPA request — ${esc(tool.rawName)}</title></head><body style="font-family: Georgia, serif; max-width: 640px; margin: 40px auto;">` +
    `<p>${esc(district.name)}</p><p>${esc(today)}</p><p>${esc(body)}</p></body></html>`;
  const filename = `dpa-request-${tool.rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.html`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
