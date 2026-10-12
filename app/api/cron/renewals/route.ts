import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runRenewalPass, renewalDigests } from "@/lib/renewals";
import { sendMail } from "@/lib/mail";

// Monthly Vercel cron (see vercel.json). Bearer token required.
// Test hook: call with the same header; the test does not wait a month.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRenewalPass(prisma);
  // One digest per renewal owner. With no mail server, flags stay rows only.
  let mailed = 0;
  for (const d of await renewalDigests(prisma)) {
    const text = `Renewals to look at for ${d.districtName}:\n\n${d.lines.map((l) => `- ${l}`).join("\n")}\n\nOpen Exhibit and go to Renewals to act on them.`;
    if (await sendMail(d.to, `Exhibit: ${d.lines.length} renewal${d.lines.length === 1 ? "" : "s"} to look at`, text).catch(() => false)) mailed++;
  }
  return NextResponse.json({ ok: true, ...result, mailed });
}
