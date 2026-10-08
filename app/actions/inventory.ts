"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sessionUser } from "@/lib/session";
import { canWrite } from "@/lib/tenancy";
import { candidatesFromCsv } from "@/lib/csv";

export type PreviewRow = { name: string; category: string; suggestion: { id: string; name: string } | null };

export async function previewImport(csv: string): Promise<{ rows?: PreviewRow[]; error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const parsed = candidatesFromCsv(csv);
  if (parsed.error || !parsed.rows) return { error: parsed.error };
  const catalog = await prisma.catalogTool.findMany({ select: { id: true, name: true } });
  const match = (name: string) => {
    const n = name.toLowerCase();
    return catalog.find((c) => c.name.toLowerCase() === n)
      ?? catalog.find((c) => n.includes(c.name.toLowerCase().split(" ")[0]) || c.name.toLowerCase().includes(n.split(" ")[0]))
      ?? null;
  };
  return { rows: parsed.rows.map((c) => ({ ...c, suggestion: match(c.name) })) };
}

/** FormData wrappers for useActionState (same code path as the direct calls). */
export async function previewFormAction(fd: FormData): Promise<{ rows?: PreviewRow[]; error?: string }> {
  return previewImport(String(fd.get("csv") || ""));
}

export async function confirmFormAction(fd: FormData): Promise<{ count?: number; error?: string }> {
  const count = Math.min(Number(fd.get("count") || 0), 100) || 0;
  const rows: Array<{ name: string; category: string; catalogId: string | null }> = [];
  for (let k = 0; k < count; k++) {
    const name = String(fd.get(`n${k}`) || "").trim();
    if (!name) continue;
    const m = String(fd.get(`m${k}`) || "");
    rows.push({ name, category: String(fd.get(`c${k}`) || "General"), catalogId: m || null });
  }
  return confirmImport(rows);
}

const confirmSchema = z.array(z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(120),
  catalogId: z.string().nullable(),
}));

export async function confirmImport(input: Array<{ name: string; category: string; catalogId: string | null }>): Promise<{ count: number; error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { count: 0, error: "Read-only role." };
  const parsed = confirmSchema.safeParse(input.slice(0, 100));
  if (!parsed.success) return { count: 0, error: "Invalid rows." };
  let n = 0;
  for (const r of parsed.data) {
    let catalogId: string | null = null;
    if (r.catalogId) {
      const cat = await prisma.catalogTool.findUnique({ where: { id: r.catalogId } });
      if (cat) catalogId = cat.id;
    }
    const created = await prisma.districtTool.create({
      data: {
        districtId: user.districtId, catalogToolId: catalogId, rawName: r.name,
        category: r.category || "General", agreementStatus: "not_requested", decision: "hold",
        source: "import",
      },
    });
    await prisma.decisionEvent.create({
      data: { districtId: user.districtId, toolId: created.id, actor: user.email, fromStatus: "", toStatus: "hold" },
    });
    n++;
  }
  revalidatePath("/inventory");
  revalidatePath("/");
  return { count: n };
}

export async function addTool(name: string, category: string): Promise<{ error?: string }> {
  const user = await sessionUser();
  if (!user || !canWrite(user)) return { error: "Read-only role." };
  const nm = name.trim().slice(0, 200);
  if (!nm) return { error: "Tool name required." };
  const catalog = await prisma.catalogTool.findMany({ select: { id: true, name: true } });
  const n = nm.toLowerCase();
  const hit = catalog.find((c) => c.name.toLowerCase() === n) ?? null;
  const created = await prisma.districtTool.create({
    data: {
      districtId: user.districtId, catalogToolId: hit?.id ?? null, rawName: nm,
      category: category.trim().slice(0, 120) || "General",
      agreementStatus: "not_requested", decision: "hold", source: "manual",
    },
  });
  await prisma.decisionEvent.create({
    data: { districtId: user.districtId, toolId: created.id, actor: user.email, fromStatus: "", toStatus: "hold" },
  });
  revalidatePath("/inventory");
  return {};
}
