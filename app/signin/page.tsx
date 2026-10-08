import { Shell } from "@/app/shell";
import { SignInForm, DevPickup, ProviderButtons } from "./forms";
import { sessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const u = await sessionUser();
  if (u) redirect("/");
  const dev = !process.env.SMTP_HOST;
  const google = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const entra = Boolean(process.env.MICROSOFT_ENTRA_CLIENT_ID && process.env.MICROSOFT_ENTRA_CLIENT_SECRET);
  const err = (await searchParams).error;
  return (
    <Shell user={null} title="Sign in">
      {err === "domain" && (
        <div className="alert error"><b>That account can&apos;t sign in.</b> Use your district email address, or ask the council owner for an invite. Personal accounts are turned away.</div>
      )}
      <p className="sans">Council members sign in with a district Google or Microsoft account. The owner can also use a magic link. Roles: owner, curriculum, sped, viewer.</p>
      <ProviderButtons google={google} entra={entra} />
      <SignInForm />
      {dev && <DevPickup />}
      <div className="card sans">
        <b>Try the sample district</b><br />
        Owner: <code>director@cedarridge.example</code><br />
        Curriculum: <code>curriculum@cedarridge.example</code><br />
        SPED: <code>sped@cedarridge.example</code><br />
        Viewer: <code>board@cedarridge.example</code>
      </div>
    </Shell>
  );
}
