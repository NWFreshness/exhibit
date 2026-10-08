// Teacher tool request core. A request creates a DistrictTool row (hold,
// AI status unknown, agreement not requested, source request) — never an email.
// Free text is a note, never exhibit fact. Shared by the authed + public actions
// and by the tests.
import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
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

export type RequestResult = { toolId: string; requestId: string; existing: boolean; statusToken: string };

/** Unguessable request status token: 256 bits of entropy, hex-encoded. */
export function newStatusToken(): string {
  return randomBytes(32).toString("hex");
}

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
        statusToken: newStatusToken(),
      },
    });
    return { toolId: existing.id, requestId: req.id, existing: true, statusToken: req.statusToken! };
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
      statusToken: newStatusToken(),
    },
  });
  return { toolId: tool.id, requestId: req.id, existing: false, statusToken: req.statusToken! };
}

/** Public status read (spec 4.6, Q4): the token is the scope. Returns only the
 *  tool name, the linked tool's current decision, and the intended use — never
 *  the note, the email, or any other request. Null when the token is unknown
 *  or the linked row is gone. No outbound reads, no session needed. */
export type RequestStatus = { toolName: string; decision: string; intendedUse: string };

export async function getRequestStatus(
  db: PrismaClient,
  token: string
): Promise<RequestStatus | null> {
  const t = (token || "").trim();
  if (!t) return null;
  const req = await db.toolRequest.findFirst({
    where: { statusToken: t },
    include: { districtTool: { select: { rawName: true, decision: true } } },
  });
  if (!req || !req.districtTool) return null;
  return { toolName: req.districtTool.rawName, decision: req.districtTool.decision, intendedUse: req.intendedUse };
}

/** Owner mint (spec 4.6, Q3): set a fresh token on one pre-token row. Scoped by
 *  district; another district's id throws the same generic error as missing. */
export async function mintRequestToken(
  db: PrismaClient,
  districtId: string,
  requestId: string
): Promise<string> {
  const id = (requestId || "").trim();
  if (!id) throw new Error("Not found.");
  const row = await db.toolRequest.findFirst({ where: { id, districtId } });
  if (!row) throw new Error("Not found.");
  const token = newStatusToken();
  await db.toolRequest.update({ where: { id: row.id }, data: { statusToken: token } });
  return token;
}

/** Open requests: request-sourced rows still on hold. */
export async function openRequestCount(db: PrismaClient, districtId: string): Promise<number> {
  return db.districtTool.count({ where: { districtId, source: "request", decision: "hold" } });
}
