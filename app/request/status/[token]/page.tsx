import { notFound } from "next/navigation";
import { Shell } from "@/app/shell";
import { prisma } from "@/lib/prisma";
import { getRequestStatus } from "@/lib/requests";

// Requester status page (spec 4.6): no session. The token is the scope —
// no district id in the URL. Shows only the tool name, the linked tool's
// current decision, and the intended use. Unknown tokens render not-found.
export default async function RequestStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await getRequestStatus(prisma, token);
  if (!s) notFound();
  return (
    <Shell user={null} title="Request status">
      <table className="sans"><tr><th>Tool</th><th>Decision</th><th>Intended use</th></tr>
        <tr>
          <td>{s.toolName}</td>
          <td>{s.decision.toUpperCase()}</td>
          <td>{s.intendedUse === "with_students" ? "Students would use it" : "Staff only"}</td>
        </tr>
      </table>
      <p className="hint sans">Decisions change as the council reviews. This page shows the current decision only — never notes, emails, or other requests.</p>
    </Shell>
  );
}
