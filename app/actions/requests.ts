"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sessionUser } from "@/lib/session";
import { isOwner } from "@/lib/tenancy";
import { createToolRequest, mintRequestToken as mintToken } from "@/lib/requests";

const schema = z.object({
  toolName: z.string().min(1).max(200),
  category: z.string().max(120).default("General"),
  building: z.string().max(120).default(""),
  intendedUse: z.enum(["staff_only", "with_students"]).default("staff_only"),
  requesterName: z.string().max(120).default(""),
  requesterEmail: z.string().max(160).default(""),
  note: z.string().max(2000).default(""),
});

/** Pass through our own validation messages; never leak raw DB errors to the form. */
function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : "Request failed.";
  if (/^(Refused|Fill in|Tool name|Requester email|Unknown district|Your school email|Sign in)/.test(m)) return m;
  console.error("[request]", m.slice(0, 300));
  return "Request could not be saved. Check the fields and try again.";
}

export type RequestForm = {
  toolName: string; category: string; building: string; intendedUse: string;
  requesterName: string; requesterEmail: string; note: string;
};

/** Any signed-in role (owner, curriculum, sped, viewer) may request. */
export async function submitRequest(input: RequestForm): Promise<{ error?: string; toolId?: string; existing?: boolean; statusToken?: string }> {
  const user = await sessionUser();
  if (!user) return { error: "Sign in required." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Fill in at least the tool name." };
  try {
    const r = await createToolRequest(prisma, user.districtId, {
      ...parsed.data,
      requesterName: parsed.data.requesterName || user.email,
      requesterEmail: parsed.data.requesterEmail || user.email,
      actorEmail: user.email,
    });
    revalidatePath("/inventory");
    revalidatePath("/review");
    revalidatePath("/");
    return { toolId: r.toolId, existing: r.existing, statusToken: r.statusToken };
  } catch (e) {
    return { error: friendly(e) };
  }
}

/** Request-link form: no session. Scoped to the district in the URL only. */
export async function submitPublicRequest(districtId: string, input: RequestForm): Promise<{ error?: string; existing?: boolean; statusToken?: string }> {
  const district = await prisma.district.findUnique({ where: { id: districtId } });
  if (!district) return { error: "Unknown district link." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Fill in at least the tool name." };
  if (!parsed.data.requesterEmail) return { error: "Your school email is required so the council can follow up." };
  try {
    const r = await createToolRequest(prisma, districtId, { ...parsed.data, actorEmail: parsed.data.requesterEmail });
    return { existing: r.existing, statusToken: r.statusToken };
  } catch (e) {
    return { error: friendly(e) };
  }
}

/** Owner-only: mint a fresh status token for one pre-token row. One row per
 *  call; the old link, if any, stops resolving. Anonymous minting is impossible. */
export async function mintRequestToken(requestId: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !isOwner(user)) return { error: "Owner only." };
  try {
    await mintToken(prisma, user.districtId, requestId);
    revalidatePath("/review");
    return {};
  } catch (e) {
    if (e instanceof Error && e.message === "Not found.") return { error: "Not found." };
    return { error: friendly(e) };
  }
}
