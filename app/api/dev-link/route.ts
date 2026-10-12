import { NextResponse } from "next/server";
import { devOutbox } from "@/auth";

// Dev only: retrieve the magic link shown on screen when no SMTP is configured.
export async function GET(req: Request) {
  // Never in production: an unset SMTP_HOST there must not hand out sign-in links.
  if (process.env.SMTP_HOST || process.env.NODE_ENV === "production") return NextResponse.json({ url: null });
  const email = new URL(req.url).searchParams.get("email")?.toLowerCase() ?? "";
  return NextResponse.json({ url: devOutbox.exhibitLinks?.get(email) ?? null });
}
