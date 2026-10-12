import Link from "next/link";
import { Shell } from "@/app/shell";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assemble, type FamilyTranslations } from "@/lib/assembler";
import { currentPolicy } from "@/lib/policy";
import { PrintButton } from "@/app/print-button";

// The stored letter only: the adopted one when a policy is in force, else the
// working draft's. This page never calls the model.
export default async function ExportFamilyPage() {
  const user = await requireUser();
  const out = await assemble(prisma, user.districtId, { prose: false });
  if (out.gate.length > 0) {
    return <Shell user={user} title="Export blocked"><div className="alert error"><b>Clean export is blocked.</b> Missing: {out.gate.join("; ")}. <Link href="/questionnaire">Complete the questionnaire</Link>.</div></Shell>;
  }
  const policy = await currentPolicy(prisma, user.districtId);
  const draft = await prisma.draft.findFirst({ where: { districtId: user.districtId }, orderBy: { createdAt: "desc" } });
  const adopted = Boolean(policy?.familyText);
  const text = policy?.familyText ?? draft?.familyText ?? "";
  const translations = ((adopted ? policy?.familyTranslations : draft?.familyTranslations) ?? {}) as FamilyTranslations;
  return (
    <Shell user={user} title="Family letter">
      {!adopted && <div className="watermark">DRAFT — NOT ADOPTED</div>}
      <PrintButton />
      {text ? <section><p>{text}</p></section> : <div className="alert">The family letter is not written yet. <Link href="/draft">Write it on the draft page</Link>.</div>}
      {Object.entries(translations).map(([language, t]) => (
        <section key={language} lang={language}>
          <h2>{language}</h2>
          {!t.reviewed && <p className="hint sans"><b>Machine translation, not yet reviewed by a person.</b></p>}
          <p>{t.text}</p>
        </section>
      ))}
      <p className="hint sans">Grade-band rules: see board draft §4.</p>
    </Shell>
  );
}
