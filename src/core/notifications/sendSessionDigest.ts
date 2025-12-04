// src/core/email/sendSessionDigest.ts
import nodemailer from "nodemailer";

export async function sendSessionDigestEmail(params: {
  to: string;
  recipientName: string;
  sessionIdShort: string;
  openedAt: string;
}) {
  const recipient = params.recipientName || "there";
  const html = `
    <!doctype html>
    <html>
      <body style="font-family: Arial, sans-serif; background-color: #0f172a; color: #e2e8f0; margin: 0; padding: 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 520px; margin: 0 auto; background-color: #0b1120; border-radius: 12px; padding: 24px;">
          <tr>
            <td>
              <h1 style="margin-top: 0; color: #38bdf8;">Session Digest</h1>
              <p style="line-height: 1.5; color: #cbd5f5;">Hi ${recipient},</p>
              <p style="line-height: 1.5; color: #cbd5f5;">
                Session <strong>${params.sessionIdShort}</strong> was opened at <strong>${params.openedAt}</strong>.
                Here's a quick reminder to review the activity and acknowledge any outstanding actions.
              </p>
              <p style="line-height: 1.5; color: #94a3b8;">
                If you were not expecting this message you can safely ignore it.
              </p>
              <p style="line-height: 1.5; color: #94a3b8;">— Cryptopi Ops</p>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const transporter = nodemailer.createTransport({
    // your SMTP for Migadu/etc
  });

  await transporter.sendMail({
    from: '"Cryptophi" <no-reply@yourdomain>',
    to: params.to,
    subject: `Session ${params.sessionIdShort} digest`,
    html,
  });
}
