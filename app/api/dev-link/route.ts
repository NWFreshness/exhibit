import { NextResponse } from "next/server";
import { devOutbox } from "@/auth";

// Dev only: retrieve the magic link shown on screen when no SMTP is configured.
export async function GET(req: Request) {
  if (process.env.SMTP_HOST) return NextResponse.json({ url: null });
  const email = new URL(req.url).searchParams.get("email")?.toLowerCase() ?? "";
  return NextResponse.json({ url: devOutbox.exhibitLinks?.get(email) ?? null });
}
