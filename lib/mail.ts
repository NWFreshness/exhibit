// The one place mail leaves the app. With no SMTP_HOST nothing is sent and
// the caller is told so.
export const mailConfigured = () => Boolean(process.env.SMTP_HOST);

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailConfigured()) return false;
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({ to, from: process.env.EMAIL_FROM, subject, text });
  return true;
}
