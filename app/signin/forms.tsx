"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";

export function ProviderButtons({ google, entra }: { google: boolean; entra: boolean }) {
  if (!google && !entra) return null;
  return (
    <div className="card sans">
      <b>Sign in with your district account</b>
      <p className="hint">Only your district&apos;s email domain works here — personal accounts are turned away.</p>
      {google && <p><button className="btn" type="button" onClick={() => signIn("google", { callbackUrl: "/review" })}>Continue with Google</button></p>}
      {entra && <p><button className="btn" type="button" onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/review" })}>Continue with Microsoft</button></p>}
    </div>
  );
}

export function SignInForm() {
  const [email, setEmail] = useState("");
  return (
    <form
      className="sans"
      onSubmit={(e) => {
        e.preventDefault();
        signIn("nodemailer", { email, callbackUrl: "/" });
      }}
    >
      <label>Email <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="director@cedarridge.example" /></label>
      <button className="btn" type="submit">Email me a link</button>
    </form>
  );
}

export function DevPickup() {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="card sans">
      <b>Dev pickup (no mail server configured)</b>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await fetch(`/api/dev-link?email=${encodeURIComponent(email)}`);
        const j = await r.json();
        setLink(j.url ?? null);
      }}>
        <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <button className="btn secondary" type="submit">Show my link</button>
      </form>
      {link && <p><a className="btn" href={link}>Sign in</a></p>}
    </div>
  );
}
