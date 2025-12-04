// src/core/features/mail/renderer.ts
import { getPool } from "@/core/db/db";

const pool = () => getPool();

export interface MailTemplateRow {
  template_id: string;
  template_key: string;
  subject: string;
  body_md: string;
}

export async function renderMailFromTemplate(args: {
  templateKey: string;
  payload: any;
}): Promise<{ subject: string; htmlContent: string }> {
  const { templateKey, payload } = args;

  const q = await pool().query<MailTemplateRow>(
    `
    SELECT template_id, template_key, subject, body_md
    FROM comms.mail_templates
    WHERE template_key = $1::text
      AND is_active = true
    LIMIT 1
    `,
    [templateKey]
  );

  if (!q.rowCount) {
    throw new Error(`Template not found: ${templateKey}`);
  }

  let body = q.rows[0].body_md;

  // very naive {{key}} replacement
  if (payload && typeof payload === "object") {
    for (const [k, v] of Object.entries(payload)) {
      const safe = v == null ? "" : String(v);
      body = body.replace(
        new RegExp(`{{\\s*${k}\\s*}}`, "g"),
        safe
      );
    }
  }

  // here you could transform markdown to HTML; for now treat as HTML-like
  const htmlContent = body;

  return { subject: q.rows[0].subject, htmlContent };
}
