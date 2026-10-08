import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import Google from "next-auth/providers/google";
import MicrosoftEntra from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { resolveLogin } from "@/lib/domain";

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
        const nodemailer = (await import("nodemailer")).default;
        const transport = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        await transport.sendMail({
          to: identifier,
          from: process.env.EMAIL_FROM,
          subject: "Sign in to Exhibit",
          text: `Sign in to Exhibit:\n\n${url}\n\nExpires in 24 hours.`,
        });
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
    async signIn({ user }) {
      const email = (user.email || "").toLowerCase().trim();
      if (!email) return false;
      const r = await resolveLogin(prisma, email);
      if (!r) return "/signin?error=domain";
      const now = new Date();
      await prisma.user.upsert({
        where: { email },
        update: { districtId: r.districtId, role: r.role },
        create: { email, districtId: r.districtId, role: r.role, createdAt: now },
      });
      if (r.inviteId) {
        await prisma.invite.update({ where: { id: r.inviteId }, data: { acceptedAt: now } });
        if (r.seat) {
          await prisma.reviewSeat.upsert({
            where: { districtId_seat: { districtId: r.districtId, seat: r.seat } },
            update: { assignedEmail: email },
            create: { districtId: r.districtId, seat: r.seat, required: false, assignedEmail: email },
          });
        }
      }
      return true;
    },
  },
});
