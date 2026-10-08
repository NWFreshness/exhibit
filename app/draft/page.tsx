import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isOwner } from "@/lib/tenancy";
import { assemble } from "@/lib/assembler";
import { diffToolTables, normalizeLiveRow, type DiffEntry } from "@/lib/diff";
import { boardLock } from "@/lib/seats";
import { refreshDraft, adoptSnapshot } from "@/app/actions/policy";

export default async function DraftPage() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId);
  const snap = await prisma.adoptedSnapshot.findFirst({ where: { districtId: user.districtId }, orderBy: { adoptedAt: "desc" } });
  const stale = snap ? (out.toolHash !== snap.toolHash || out.answersHash !== snap.answersHash) : false;
  const lock = await boardLock(prisma, user.districtId);
  let moved: DiffEntry[] | null = null;
  if (snap && stale) {
    const liveTools = await prisma.districtTool.findMany({
      where: { districtId: user.districtId },
      include: { agreements: { orderBy: { createdAt: "desc" } } },
    });
    const qRow = await prisma.questionnaireAnswer.findUnique({ where: { districtId: user.districtId } });
    const answers = (qRow?.answers ?? {}) as { integrityK5?: string | null; integrity68?: string | null; integrity912?: string | null };
    moved = diffToolTables(snap.toolTable, liveTools.map((t) => normalizeLiveRow(t, answers)));
  }

  async function refresh() { "use server"; await refreshDraft(); }
  async function adopt() { "use server"; await adoptSnapshot(); }

  return (
    <Shell user={user} title="Policy draft">
      {snap && stale && <div className="alert stale"><b>Working draft is STALE</b> relative to the snapshot of {snap.adoptedAt.toISOString().slice(0, 10)}. <Link href="/snapshot">View snapshot</Link>.</div>}
      {moved && moved.length > 0 && (
        <div className="alert stale"><b>What moved since adoption:</b>
          <ul>{moved.map((m, i) => (
            <li key={i}>{m.kind === "field"
              ? <>{m.toolName} — {m.field}: {m.before} → {m.after}</>
              : <>{m.toolName} — {m.kind === "added" ? "added to the inventory since adoption" : "removed from the inventory since adoption"}</>}</li>
          ))}</ul>
        </div>
      )}
      {snap && !stale && <div className="alert"><b>Draft matches the adopted snapshot.</b></div>}
      {out.missing.length > 0 && <div className="alert error"><b>Missing decisions (named, not generated around):</b> {out.missing.join("; ")}.</div>}
      {lock.locked
        ? <div className="alert error"><b>Board packet locked.</b> {lock.reason} Sign seats or record an owner override on the <Link href="/review">review page</Link>.</div>
        : <div className="alert"><b>Board packet unlocked.</b> All required seats signed or overridden.</div>}
      <h2>Eight-section draft (live)</h2>
      <p className="hint sans">Every section shows where it comes from. Sections driven by your answers change in <Link href="/questionnaire">Questions</Link>; the tool table changes in <Link href="/inventory">Inventory</Link>. Sections are never free-typed here — that&apos;s what keeps the adopted text trustworthy.</p>
      {!snap && <div className="watermark">DRAFT — NOT ADOPTED</div>}
      {out.sections.map((s) => (
        <section key={s.n}>
          <h2>{s.n}. {s.title}</h2>
          <p className="hint sans no-print">From: {s.source}</p>
          <div dangerouslySetInnerHTML={{ __html: s.html }} />
        </section>
      ))}
      <div className="no-print" style={{ marginTop: 20 }}>
        <form action={refresh} style={{ display: "inline" }}><button className="btn secondary" type="submit">Save as working draft</button></form>
        {isOwner(user) && <form action={adopt} style={{ display: "inline" }}><button className="btn" type="submit">Adopt as immutable snapshot</button></form>}
      </div>
    </Shell>
  );
}
