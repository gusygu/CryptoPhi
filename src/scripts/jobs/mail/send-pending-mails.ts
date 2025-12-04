// src/jobs/mail/send-pending-mails.ts
import { getPool } from "@/core/db/db";
import BrevoApiClient from "@/core/integrations/brevo"; // whatever wrapper you have

const pool = () => getPool();

async function renderTemplate(templateKey: string, payload: any) {
  return {
    subject: payload?.subject ?? templateKey,
    bodyHtml: payload?.htmlContent ?? JSON.stringify(payload ?? {}),
  };
}

async function fetchNextBatch() {
  const res = await pool().query(
    `
    SELECT *
    FROM comms.mail_queue
    WHERE status = 'pending'
      AND (scheduled_at IS NULL OR scheduled_at <= now())
    ORDER BY created_at
    LIMIT 50
    FOR UPDATE SKIP LOCKED
    `
  );
  return res.rows;
}

export async function runMailSenderWorker() {
  const client = new BrevoApiClient({
    apiKey: process.env.BREVO_API_KEY!,
  });

  const mails = await fetchNextBatch();
  for (const mail of mails) {
    try {
      // lock / mark sending
      await pool().query(
        `UPDATE comms.mail_queue SET status = 'sending', updated_at = now() WHERE mail_id = $1`,
        [mail.mail_id]
      );

      // build body from template + payload (omitted for brevity)
      const { subject, bodyHtml } = await renderTemplate(
        mail.template_key,
        mail.payload
      );

      // enforce fixed FROM address
      await client.sendEmail({
        sender: {
          email: "no-reply@mail.cryptophi.xyz",
          name: "CryptoPhi",
        },
        to: [{ email: mail.to_email }],
        subject,
        htmlContent: bodyHtml,
      });

      await pool().query(
        `
        UPDATE comms.mail_queue
        SET status = 'sent',
            sent_at = now(),
            last_error = NULL,
            updated_at = now()
        WHERE mail_id = $1
        `,
        [mail.mail_id]
      );
    } catch (err) {
      await pool().query(
        `
        UPDATE comms.mail_queue
        SET status = 'failed',
            last_error = $2::text,
            updated_at = now()
        WHERE mail_id = $1
        `,
        [mail.mail_id, String(err)]
      );
    }
  }
}
