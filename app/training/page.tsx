import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble } from "@/lib/assembler";
import { buildTrainingPacket, type SnapshotTool } from "@/lib/training";
import { buildingRollup } from "@/lib/rollup";
import { buildToolGuides } from "@/lib/guides";
import { ackTraining, generateTrainingScript } from "@/app/actions/policy";
import { canWrite } from "@/lib/tenancy";
import type { Answers } from "@/lib/assembler";

export default async function TrainingPage() {
  const user = await requireUser();
  const snap = await prisma.adoptedSnapshot.findFirst({ where: { districtId: user.districtId }, orderBy: { adoptedAt: "desc" } });
  if (!snap) {
    return <Shell user={user} title="Training packet"><div className="alert">No adopted snapshot yet. The training packet is generated only from an adopted snapshot. <Link href="/draft">Open the draft</Link>.</div></Shell>;
  }
  const live = await assemble(prisma, user.districtId);
  const stale = live.toolHash !== snap.toolHash || live.answersHash !== snap.answersHash;
  const district = await prisma.district.findUniqueOrThrow({ where: { id: user.districtId } });
  const packet = buildTrainingPacket({
    districtName: district.name,
    adoptedOn: snap.adoptedAt.toISOString().slice(0, 10),
    adoptedBy: snap.adoptedBy,
    stale,
    tools: snap.toolTable as SnapshotTool[],
  });
  const schools = await prisma.school.findMany({ where: { districtId: user.districtId }, orderBy: { name: "asc" } });
  const schoolNames = Object.fromEntries(schools.map((s) => [s.id, s.name]));
  const allAcks = await prisma.trainingAck.findMany({
    where: { districtId: user.districtId, snapshotId: snap.id }, orderBy: { createdAt: "desc" },
  });

  // Principal view: a viewer scoped to a building sees names only for that
  // building; other buildings show counts. The owner sees every name.
  const scopedSchool = user.role === "viewer" && user.schoolId ? user.schoolId : null;
  const bySchool = buildingRollup(schools, allAcks, { role: user.role, schoolId: user.schoolId });
  const unassigned = allAcks.filter((a) => !a.schoolId).length;
  // Guides render from the snapshot's pinned answers when present; older
  // snapshots fall back to today's answers and say so.
  const pinnedAnswers = (snap.answersJson ?? null) as Answers | null;
  const guideAnswers: Answers = pinnedAnswers ?? (((await prisma.questionnaireAnswer.findUnique({ where: { districtId: user.districtId } }))?.answers ?? {}) as Answers);
  const guides = buildToolGuides(
    (snap.toolTable ?? []) as SnapshotTool[],
    guideAnswers, district.name, guideAnswers.ownerName || "Technology Director"
  );

  const snapId = snap.id;
  async function ack(form: FormData) {
    "use server";
    await ackTraining(snapId, String(form.get("name") || ""), String(form.get("schoolId") || "") || undefined);
  }
  async function generate() {
    "use server";
    await generateTrainingScript(snapId);
  }
  const aiScript = await prisma.trainingScript.findFirst({
    where: { districtId: user.districtId, snapshotId: snap.id }, orderBy: { createdAt: "desc" },
  });

  return (
    <Shell user={user} title="Training packet">
      <p className="sans">Generated only from the adopted snapshot of {snap.adoptedAt.toISOString().slice(0, 10)} — never from the live inventory. Signing names the snapshot version you trained on.</p>
      {scopedSchool && <div className="alert"><b>Principal view:</b> showing {schoolNames[scopedSchool] ?? "your building"} in full; other buildings show counts only.</div>}
      <section><div dangerouslySetInnerHTML={{ __html: packet.principalScript }} /></section>
      <section><div dangerouslySetInnerHTML={{ __html: packet.teacherCard }} /></section>
      <h2>Per-tool guides ({guides.length})</h2>
      {!pinnedAnswers && <p className="hint sans">This snapshot predates pinned answers, so the guides below use today&apos;s answers.</p>}
      {guides.length ? guides.map((g) => (
        <div key={g.toolName} dangerouslySetInnerHTML={{ __html: g.html }} />
      )) : <p className="hint sans">No approved or limited tools in this snapshot — nothing to train on yet.</p>}
      <h2>AI-written script</h2>
      <p className="hint sans">An AI draft of the full 15-minute training, written from this snapshot&apos;s adopted tools and rules. It never touches the snapshot — generating again saves a new version. {process.env.LLM_BASE_URL ? "Uses your configured model." : "No model key set yet, so you get labeled sample text until you add one."}</p>
      {aiScript ? (
        <div className="card">
          <p className="hint sans">Latest · {aiScript.createdAt.toISOString().slice(0, 16).replace("T", " ")} · by {aiScript.createdBy} · model: {aiScript.model}</p>
          <div style={{ whiteSpace: "pre-wrap" }}>{aiScript.body}</div>
        </div>
      ) : <p className="hint sans">No AI script yet for this snapshot.</p>}
      {canWrite(user) && (
        <form action={generate} className="no-print"><button className="btn" type="submit">Generate training with AI</button></form>
      )}
      <h2>Staff acknowledgment — name plus date</h2>
      <form action={ack} className="sans no-print">
        <label>Full name <input type="text" name="name" required maxLength={120} /></label>
        {schools.length ? (
          <label>Building <select name="schoolId" defaultValue={scopedSchool ?? ""} required>
            <option value="">— pick your building —</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        ) : null}
        <button className="btn" type="submit">Acknowledge</button>
      </form>
      <h2>Who has trained on this snapshot</h2>
      {bySchool.map(({ schoolId, name, count, names }) => {
        const rows = names === null ? null : allAcks.filter((a) => a.schoolId === schoolId);
        return (
          <div key={schoolId}>
            <h3>{name} — {count} signed</h3>
            {rows ? (
              rows.length ? (
                <table className="sans"><tr><th>Name</th><th>Date</th></tr>
                  {rows.map((a) => <tr key={a.id}><td>{a.name}</td><td>{a.createdAt.toISOString().slice(0, 10)}</td></tr>)}
                </table>
              ) : <p className="hint sans">Nobody signed yet — this building has not run the script.</p>
            ) : <p className="hint sans">{count} signed (names hidden outside your building).</p>}
          </div>
        );
      })}
      {unassigned > 0 && <p className="hint sans">{unassigned} signed without picking a building.</p>}
      {!schools.length && (allAcks.length ? (
        <table className="sans"><tr><th>Name</th><th>Date</th></tr>
          {allAcks.map((a) => <tr key={a.id}><td>{a.name}</td><td>{a.createdAt.toISOString().slice(0, 10)}</td></tr>)}
        </table>
      ) : <p className="hint sans">No acknowledgments yet.</p>)}
    </Shell>
  );
}
