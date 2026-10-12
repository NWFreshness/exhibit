import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { sessionUser } from "@/lib/session";
import { readBlob } from "@/lib/store";

// Signed-in download of one uploaded agreement, scoped to the user's district.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return new Response("Sign in required.", { status: 403 });
  const { id } = await params;
  const a = await prisma.agreement.findFirst({ where: { id, districtId: user.districtId, kind: "local_upload" } });
  if (!a || !a.blobKey) notFound();
  const file = await readBlob(a.blobKey);
  if (!file) notFound();
  if ("url" in file) return Response.redirect(file.url, 302);
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${a.blobKey.split("/").pop()!.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
    },
  });
}
