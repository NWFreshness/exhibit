import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canWrite, isOwner } from "@/lib/tenancy";
import { assemble, isOpenRequest, FAMILY_LANGUAGES, type FamilyTranslations } from "@/lib/assembler";
import { diffToolTables, normalizeLiveRow, type DiffEntry } from "@/lib/diff";
import { boardLock } from "@/lib/seats";
import { latestSnapshot, currentPolicy, toolListFor } from "@/lib/policy";
import { refreshDraft, adoptSnapshot, publishToolList, writeProse, saveProse, translateFamily, saveTranslation } from "@/app/actions/policy";

export default async function DraftPage() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId, { prose: false });
  const snap = await latestSnapshot(prisma, user.districtId);
  const policy = await currentPolicy(prisma, user.districtId);
  const toolList = policy ? await toolListFor(prisma, policy) : null;
  const policyStale = snap ? out.answersHash !== snap.answersHash : false;
  const toolsStale = toolList ? out.toolHash !== toolList.toolHash : false;
  const lock = await boardLock(prisma, user.districtId, out.draftHash);
  const draft = await prisma.draft.findFirst({ where: { districtId: user.districtId }, orderBy: { createdAt: "desc" } });
  const translations = (draft?.familyTranslations ?? {}) as FamilyTranslations;
  let moved: DiffEntry[] | null = null;
  if (toolList && toolsStale) {
    const liveTools = await prisma.districtTool.findMany({
      where: { districtId: user.districtId, archivedAt: null },
      include: { agreements: { orderBy: { createdAt: "desc" } } },
    });
    const answers = (policy!.answersJson ?? {}) as { integrityK5?: string | null; integrity68?: string | null; integrity912?: string | null };
    moved = diffToolTables(toolList.toolTable, liveTools.filter((t) => !isOpenRequest(t)).map((t) => normalizeLiveRow(t, answers)));
  }
  const owner = isOwner(user);

  async function refresh() { "use server"; await refreshDraft(); }
  async function adopt() { "use server"; await adoptSnapshot(); }
  async function publish() { "use server"; await publishToolList(); }
  async function write() { "use server"; await writeProse(); }
  async function edit(form: FormData) { "use server"; await saveProse(String(form.get("purpose") || ""), String(form.get("family") || "")); }
  async function translate(form: FormData) { "use server"; await translateFamily(String(form.get("language") || "")); }
  async function saveLang(form: FormData) {
    "use server";
    await saveTranslation(String(form.get("language") || ""), String(form.get("text") || ""), form.get("reviewed") === "on");
  }

  return (
    <Shell user={user} title="Policy draft">
      {snap && !snap.boardAdoptedOn && <div className="alert stale"><b>Council approved, waiting for the board.</b> The policy approved on {snap.adoptedAt.toISOString().slice(0, 10)} is not in force until the board adopts it. <Link href="/snapshot">Record the board date</Link>.</div>}
      {snap && policyStale && <div className="alert stale"><b>The policy text changed</b> since the council approved it on {snap.adoptedAt.toISOString().slice(0, 10)}. Changed policy text needs seat sign-off and a board vote again. <Link href="/snapshot">View approved policy</Link>.</div>}
      {snap && !policyStale && <div className="alert"><b>Policy text matches the approved policy.</b></div>}
      {toolList && toolsStale && (
        <div className="alert stale">
          <b>The tool list changed</b> since it was published on {toolList.publishedAt.toISOString().slice(0, 10)}. This does not need a board vote: publish the new list under the policy in force.
          {owner && <form action={publish} className="no-print"><button className="btn" type="submit">Publish tool list</button></form>}
          {moved && moved.length > 0 && (
            <details><summary>What moved ({moved.length})</summary>
              <ul>{moved.map((m, i) => (
                <li key={i}>{m.kind === "field"
                  ? <>{m.toolName} — {m.field}: {m.before} → {m.after}</>
                  : <>{m.toolName} — {m.kind === "added" ? "added since the list was published" : "removed since the list was published"}</>}</li>
              ))}</ul>
            </details>
          )}
        </div>
      )}
      {toolList && !toolsStale && <div className="alert"><b>Tool list matches the published list.</b></div>}
      {out.missing.length > 0 && <div className="alert error"><b>Missing decisions (named, not generated around):</b> {out.missing.join("; ")}.</div>}
      {lock.locked
        ? <div className="alert error"><b>Board packet locked.</b> {lock.reason} Sign seats or record an owner override on the <Link href="/review">review page</Link>.</div>
        : <div className="alert"><b>Board packet unlocked.</b> All required seats signed this draft or were overridden.</div>}

      <h2>Model-written text</h2>
      <p className="hint sans">The purpose paragraph and the family letter are written by the model once, then stored. The owner can edit them. Viewing a page never rewrites them. Rewriting or editing after seats have signed means those seats sign again.</p>
      {canWrite(user) && (
        <form action={write} className="no-print"><button className="btn secondary" type="submit">{draft?.purposeText ? "Rewrite both with AI (replaces edits and translations)" : "Write both with AI"}</button></form>
      )}
      {draft?.purposeText && draft.familyText ? (
        owner ? (
          <form action={edit} className="sans no-print">
            <label>Purpose paragraph <textarea name="purpose" rows={5} defaultValue={draft.purposeText} maxLength={4000} required /></label>
            <label>Family letter (English) <textarea name="family" rows={7} defaultValue={draft.familyText} maxLength={6000} required /></label>
            <button className="btn secondary" type="submit">Save edits</button>
          </form>
        ) : <div className="card"><p><b>Family letter:</b> {draft.familyText}</p></div>
      ) : <p className="hint sans">Not written yet.</p>}

      {draft?.familyText && (
        <>
          <h3>Family letter in other languages</h3>
          <p className="hint sans">Machine translations are labeled as unreviewed on the export until a person who reads the language marks them reviewed.</p>
          {canWrite(user) && (
            <form action={translate} className="sans no-print">
              <label>Add a language <select name="language">{FAMILY_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
              <button className="btn secondary" type="submit">Translate with AI</button>
            </form>
          )}
          {Object.entries(translations).map(([language, t]) => (
            <div className="card" key={language}>
              <b>{language}</b> <span className="status" data-s={t.reviewed ? "approved" : "unknown"}>{t.reviewed ? "Reviewed by a person" : "Machine translation, not reviewed"}</span>
              {owner ? (
                <form action={saveLang} className="sans no-print">
                  <input type="hidden" name="language" value={language} />
                  <label>Text (clear it to remove this language) <textarea name="text" rows={6} defaultValue={t.text} maxLength={8000} /></label>
                  <label><input type="checkbox" name="reviewed" defaultChecked={t.reviewed} /> A person who reads {language} has reviewed this</label>
                  <button className="btn secondary" type="submit">Save {language}</button>
                </form>
              ) : <p>{t.text}</p>}
            </div>
          ))}
        </>
      )}

      <h2>Eight-section draft (live)</h2>
      <p className="hint sans">Every section shows where it comes from. Sections driven by your answers change in <Link href="/questionnaire">Questions</Link>; the tool table changes in <Link href="/inventory">Inventory</Link>. Clause sections are never free-typed here — that&apos;s what keeps the adopted text trustworthy.</p>
      {!policy && <div className="watermark">DRAFT — NOT ADOPTED</div>}
      {out.sections.map((s) => (
        <section key={s.n}>
          <h2>{s.n}. {s.title}</h2>
          <p className="hint sans no-print">From: {s.source}</p>
          <div dangerouslySetInnerHTML={{ __html: s.html }} />
        </section>
      ))}
      <div className="no-print" style={{ marginTop: 20 }}>
        <form action={refresh} style={{ display: "inline" }}><button className="btn secondary" type="submit">Save as working draft</button></form>
        {owner && <form action={adopt} style={{ display: "inline" }}><button className="btn" type="submit">Record council approval</button></form>}
      </div>
      <p className="hint sans no-print">Council approval freezes the policy text. It takes effect when the board adopts it; you record that date on the approved-policy page.</p>
    </Shell>
  );
}
