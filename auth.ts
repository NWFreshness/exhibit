import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import Google from "next-auth/providers/google";
import MicrosoftEntra from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { admitLogin } from "@/lib/domain";
import { sendMail } from "@/lib/mail";

// Dev outbox: with no SMTP configured, magic links are shown on screen
// (signin page "dev pickup") instead of emailed. Production sets SMTP_*.
export const devOutbox = globalThis as unknown as { exhibitLinks?: Map<string, string> };
if (!devOutbox.exhibitLinks) devOutbox.exhibitLinks = new Map();

const smtpConfigured = Boolean(process.env.SMTP_HOST);
const googleOn = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const entraOn = Boolean(
  process.env.MICROSOFT_ENTRA_CLIENT_ID && process.env.MICROSOFT_ENTRA_CLIENT_SECRET
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Nodemailer({
      server: smtpConfigured
        ? {
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          }
        : { host: "localhost", port: 1025, ignoreTLS: true },
      from: process.env.EMAIL_FROM || "Exhibit <noreply@example.org>",
      sendVerificationRequest: async ({ identifier, url }) => {
        if (!smtpConfigured) {
          devOutbox.exhibitLinks!.set(identifier.toLowerCase(), url);
          console.log(`[exhibit dev] magic link for ${identifier}: ${url}`);
          return;
        }
        await sendMail(identifier, "Sign in to Exhibit", `Sign in to Exhibit:\n\n${url}\n\nExpires in 24 hours.`);
      },
    }),
    ...(googleOn ? [Google] : []),
    ...(entraOn
      ? [
          MicrosoftEntra({
            clientId: process.env.MICROSOFT_ENTRA_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_ENTRA_CLIENT_SECRET,
            ...(process.env.MICROSOFT_ENTRA_TENANT_ID
              ? { tenantId: process.env.MICROSOFT_ENTRA_TENANT_ID }
              : {}),
          }),
        ]
      : []),
  ],
  callbacks: {
    // District gate: invite > existing user > allowed domain. Anything else is
    // rejected before a session exists. Applies to magic link AND OAuth.
    async signIn({ user, email }) {
      if (!user.email) return false;
      const ok = await admitLogin(prisma, user.email, Boolean(email?.verificationRequest));
      return ok || "/signin?error=domain";
    },
  },
});
