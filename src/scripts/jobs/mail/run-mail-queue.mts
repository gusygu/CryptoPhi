// src/jobs/mail/run-mail-queue.mts
import { getPool } from "@/core/db/db";
import { sendBrevoEmail } from "@/core/integrations/brevo";
import { renderMailFromTemplate } from "@/core/features/mail/renderer";

const pool = () => getPool();

async function fetchPending() {
  const res = await pool().query(
    `
    SELECT mail_id, to_email, template_key, payload
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

export async function runMailQueueOnce() {
  const rows = await fetchPending();

  for (const row of rows) {
    const { mail_id, to_email, template_key, payload } = row;

    try {
      // mark as sending
      await pool().query(
        `UPDATE comms.mail_queue
         SET status = 'sending', updated_at = now()
         WHERE mail_id = $1`,
        [mail_id]
      );

      const { subject, htmlContent } = await renderMailFromTemplate({
        templateKey: template_key,
        payload,
      });

      await sendBrevoEmail({
        toEmail: to_email,
        subject,
        htmlContent,
        templateKey: template_key,
      });

      await pool().query(
        `UPDATE comms.mail_queue
         SET status = 'sent',
             sent_at = now(),
             last_error = NULL,
             updated_at = now()
         WHERE mail_id = $1`,
        [mail_id]
      );
    } catch (err) {
      await pool().query(
        `UPDATE comms.mail_queue
         SET status = 'failed',
             last_error = $2::text,
             updated_at = now()
         WHERE mail_id = $1`,
        [mail_id, String(err)]
      );
    }
  }
}
