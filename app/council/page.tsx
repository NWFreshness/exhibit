import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isOwner } from "@/lib/tenancy";
import { setDomains, sendInvite, cancelInvite, assignSeat, createSchool, setUserSchool } from "@/app/actions/council";

export default async function CouncilPage() {
  const user = await requireUser();
  if (!isOwner(user)) {
    return <Shell user={user} title="Council"><div className="alert error">Council membership is managed by the owner.</div></Shell>;
  }
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const users = await prisma.user.findMany({ where: { districtId: user.districtId }, orderBy: { email: "asc" } });
  const seats = await prisma.reviewSeat.findMany({ where: { districtId: user.districtId }, orderBy: { seat: "asc" } });
  const invites = await prisma.invite.findMany({ where: { districtId: user.districtId }, orderBy: { createdAt: "desc" } });
  const schools = await prisma.school.findMany({ where: { districtId: user.districtId }, orderBy: { name: "asc" } });
  const schoolNames = Object.fromEntries(schools.map((s) => [s.id, s.name]));
  const googleOn = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const entraOn = Boolean(process.env.MICROSOFT_ENTRA_CLIENT_ID && process.env.MICROSOFT_ENTRA_CLIENT_SECRET);

  async function domains(form: FormData) {
    "use server";
    await setDomains(user.districtId, String(form.get("domains") || ""));
  }
  async function invite(form: FormData) {
    "use server";
    await sendInvite(user.districtId, {
      email: String(form.get("email") || ""),
      role: String(form.get("role") || "viewer"),
      seat: String(form.get("seat") || "") || undefined,
    });
  }
  async function cancel(form: FormData) {
    "use server";
    await cancelInvite(String(form.get("id")));
  }
  async function assign(form: FormData) {
    "use server";
    await assignSeat(String(form.get("seat")), String(form.get("email") || ""));
  }
  async function school(form: FormData) {
    "use server";
    await createSchool(String(form.get("name") || ""));
  }
  async function userschool(form: FormData) {
    "use server";
    await setUserSchool(String(form.get("id")), String(form.get("schoolId") || ""));
  }

  return (
    <Shell user={user} title="Council" kicker="Who signs what">
      <h2>Login domains</h2>
      <p className="hint sans">Google sign-in is {googleOn ? <b>on</b> : "off (set GOOGLE_CLIENT_ID/SECRET)"}; Microsoft is {entraOn ? <b>on</b> : "off (set MICROSOFT_ENTRA_* credentials)"}. District sign-in works once a primary domain is saved below.</p>
      <form action={domains} className="sans no-print">
        <label>Allowed domains, comma separated <input type="text" name="domains" defaultValue={district.allowedDomains.join(", ")} placeholder="cedarridge.example" /></label>
        <button className="btn secondary" type="submit">Save domains</button>
      </form>

      <h2>Invite a member</h2>
      <p className="hint sans">First login with an invited email lands with this role. Association reviewers come in as viewers; cabinet stays viewer. No new roles.</p>
      <form action={invite} className="sans no-print">
        <label>Email <input type="email" name="email" required /></label>
        <label>Role <select name="role"><option value="viewer">viewer</option><option value="curriculum">curriculum</option><option value="sped">sped</option><option value="owner">owner</option></select></label>
        <label>Seat (optional) <select name="seat"><option value="">— none —</option><option value="technology">technology</option><option value="teaching">teaching</option><option value="sped">sped</option><option value="association">association</option><option value="cabinet">cabinet</option></select></label>
        <button className="btn" type="submit">Invite</button>
      </form>
      {invites.filter((i) => !i.acceptedAt).length ? (
        <table className="sans"><tr><th>Email</th><th>Role</th><th>Seat</th><th>By</th><th></th></tr>
          {invites.filter((i) => !i.acceptedAt).map((i) => (
            <tr key={i.id}><td>{i.email}</td><td>{i.role}</td><td>{i.seat ?? "—"}</td><td>{i.createdBy}</td>
              <td><form action={cancel} className="no-print"><input type="hidden" name="id" value={i.id} /><button className="btn secondary" type="submit">Cancel</button></form></td></tr>
          ))}
        </table>
      ) : <p className="hint sans">No pending invites.</p>}

      <h2>Members ({users.length})</h2>
      <table className="sans"><tr><th>Email</th><th>Role</th><th>Building</th><th className="no-print">Scope</th></tr>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.email}</td><td>{u.role}</td>
            <td>{(u.schoolId && schoolNames[u.schoolId]) || "all buildings"}</td>
            <td className="no-print">
              <form action={userschool}>
                <input type="hidden" name="id" value={u.id} />
                <select name="schoolId" defaultValue={u.schoolId ?? ""}>
                  <option value="">all buildings</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button className="btn secondary" type="submit">Set</button>
              </form>
            </td>
          </tr>
        ))}
      </table>

      <h2>Buildings ({schools.length})</h2>
      <form action={school} className="sans no-print">
        <label>New building <input type="text" name="name" required maxLength={120} placeholder="e.g. Ridge Elementary" /></label>
        <button className="btn secondary" type="submit">Add building</button>
      </form>
      {schools.length ? (
        <ul className="sans">{schools.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
      ) : <p className="hint sans">No buildings yet. Acknowledgments work without them.</p>}

      <h2>Seats — assigned and signed</h2>
      <table className="sans"><tr><th>Seat</th><th>Required</th><th>Assigned to</th><th>Signed</th><th className="no-print">Assign</th></tr>
        {seats.map((s) => (
          <tr key={s.seat}>
            <td>{s.seat}</td><td>{s.required ? "Yes" : "Optional"}</td>
            <td>{s.assignedEmail ?? "—"}</td>
            <td>{s.signedAt ? `${s.signedAt.toISOString().slice(0, 10)} by ${s.signedBy}` : s.overrideReason ? `Override: ${s.overrideReason}` : <b>Not signed</b>}</td>
            <td className="no-print">
              <form action={assign}>
                <input type="hidden" name="seat" value={s.seat} />
                <input type="text" name="email" defaultValue={s.assignedEmail ?? ""} placeholder="email or blank" style={{ width: 180, display: "inline" }} />
                <button className="btn secondary" type="submit">Set</button>
              </form>
            </td>
          </tr>
        ))}
      </table>
      <p className="sans"><Link href="/review">Open the review packets →</Link></p>
    </Shell>
  );
}
