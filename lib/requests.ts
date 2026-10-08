// Teacher tool request core. A request creates a DistrictTool row (hold,
// AI status unknown, agreement not requested, source request) — never an email.
// Free text is a note, never exhibit fact. Shared by the authed + public actions
// and by the tests.
import type { PrismaClient } from "@prisma/client";
import { refuseStudentData } from "./guard";

export type RequestInput = {
  toolName: string;
  category?: string;
  building?: string;
  intendedUse?: string; // staff_only | with_students
  requesterName?: string;
  requesterEmail?: string;
  note?: string;
  actorEmail: string;
};

export type RequestResult = { toolId: string; requestId: string; existing: boolean };

function norm(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function closeCatalogMatch(name: string, catalog: Array<{ id: string; name: string }>): string | null {
  const n = norm(name).toLowerCase();
  const exact = catalog.find((c) => c.name.toLowerCase() === n);
  if (exact) return exact.id;
  const words = n.split(" ").filter((w) => w.length > 3);
  const near = catalog.find((c) => {
    const cn = c.name.toLowerCase();
    return words.length > 0 && words.some((w) => cn.includes(w)) &&
      (cn.includes(n.split(" ")[0]) || n.includes(cn.split(" ")[0]));
  });
  return near ? near.id : null;
}

export async function createToolRequest(
  db: PrismaClient,
  districtId: string,
  input: RequestInput
): Promise<RequestResult> {
  const name = norm(input.toolName).slice(0, 200);
  if (!name) throw new Error("Tool name is required.");
  const email = (input.requesterEmail || "").trim().slice(0, 160);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Requester email is invalid.");
  for (const v of [name, input.building || "", input.note || "", input.requesterName || ""]) {
    const blocked = refuseStudentData(v);
    if (blocked) throw new Error(blocked);
  }
  const intended = input.intendedUse === "with_students" ? "with_students" : "staff_only";

  // Duplicate name in the same district links to the existing row.
  const existing = await db.districtTool.findFirst({
    where: { districtId, rawName: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    const req = await db.toolRequest.create({
      data: {
        districtId, districtToolId: existing.id,
        requesterName: (input.requesterName || "").slice(0, 120),
        requesterEmail: email,
        building: (input.building || "").slice(0, 120),
        intendedUse: intended,
        note: (input.note || "").slice(0, 2000),
      },
    });
    return { toolId: existing.id, requestId: req.id, existing: true };
  }

  const catalog = await db.catalogTool.findMany({ select: { id: true, name: true } });
  const tool = await db.districtTool.create({
    data: {
      districtId,
      catalogToolId: closeCatalogMatch(name, catalog),
      rawName: name,
      category: (input.category || "General").slice(0, 120) || "General",
      inUse: false,
      source: "request",
      aiStatus: "unknown",
      agreementStatus: "not_requested",
      decision: "hold",
      notes: input.note ? `Requested: ${input.note.slice(0, 500)}` : "Requested by staff.",
    },
  });
  await db.decisionEvent.create({
    data: {
      districtId, toolId: tool.id, actor: input.actorEmail,
      fromStatus: "", toStatus: "not_requested/hold",
    },
  });
  const req = await db.toolRequest.create({
    data: {
      districtId, districtToolId: tool.id,
      requesterName: (input.requesterName || "").slice(0, 120),
      requesterEmail: email,
      building: (input.building || "").slice(0, 120),
      intendedUse: intended,
      note: (input.note || "").slice(0, 2000),
    },
  });
  return { toolId: tool.id, requestId: req.id, existing: false };
}

/** Open requests: request-sourced rows still on hold. */
export async function openRequestCount(db: PrismaClient, districtId: string): Promise<number> {
  return db.districtTool.count({ where: { districtId, source: "request", decision: "hold" } });
}
