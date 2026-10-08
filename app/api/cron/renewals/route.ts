import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runRenewalPass } from "@/lib/renewals";

// Monthly Vercel cron (see vercel.json). Bearer token required.
// Test hook: call with the same header; the test does not wait a month.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRenewalPass(prisma);
  return NextResponse.json({ ok: true, ...result });
}
