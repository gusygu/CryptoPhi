// src/core/mail/audit.ts
import { sql } from "@/core/db/db";

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const MAIL_FROM_ALERTS = process.env.MAIL_FROM_ALERTS ?? "CryptoPhi Alerts <alerts@mail.cryptophi.xyz>";
const ADMIN_ALERT_RECIPIENTS = process.env.ADMIN_ALERT_RECIPIENTS ?? "";
const ADMIN_SUGGESTION_RECIPIENTS = process.env.ADMIN_SUGGESTION_RECIPIENTS ?? "";

if (!BREVO_API_KEY) {
  // In dev you might just log; in prod, better to fail early at startup
  console.warn("[mail:audit] BREVO_API_KEY is not set; audit emails will be disabled.");
}

type AuditMailKind = "issue" | "sampling" | "suggestion";

interface AuditReportMailPayload {
  reportId: string;
  userId: string;
  userEmail: string;
  cycleSeq?: number | null;
  category: AuditMailKind;
  severity: string;
  note: string;
  createdAt: string;
}

function resolveRecipients(category: AuditMailKind): string[] {
  const alerts = ADMIN_ALERT_RECIPIENTS.split(",").map((s) => s.trim()).filter(Boolean);
  const suggestions = ADMIN_SUGGESTION_RECIPIENTS.split(",").map((s) => s.trim()).filter(Boolean);

  if (category === "suggestion" && suggestions.length) {
    return suggestions;
  }
  return alerts.length ? alerts : suggestions; // fallback
}

export async function sendAuditReportMail(payload: AuditReportMailPayload) {
  if (!BREVO_API_KEY) return; // silently noop if mail is disabled

  const to = resolveRecipients(payload.category as AuditMailKind);
  if (!to.length) return;

  const subject = `[CryptoPhi/Audit] ${payload.category.toUpperCase()} (${payload.severity})`;

  const lines: string[] = [
    `New audit ${payload.category} from ${payload.userEmail} (${payload.userId.slice(0, 8)}…).`,
    "",
    `Severity: ${payload.severity}`,
    `Report ID: ${payload.reportId}`,
    `Created at: ${payload.createdAt}`,
  ];
  if (payload.cycleSeq != null) {
    lines.push(`Cycle seq: ${payload.cycleSeq}`);
  }
  lines.push("", "Message:", payload.note || "(empty)");

  const html = lines
    .map((line) => `<p>${line.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("");

  const body = {
    sender: parseMailFrom(MAIL_FROM_ALERTS),
    to: to.map((email) => ({ email })),
    subject,
    htmlContent: html,
  };

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  }).catch((err) => {
    console.warn("[mail:audit] Failed to send audit email", err);
  });
}

function parseMailFrom(input: string) {
  // Accept formats like: "Name <email@example.com>" or plain email
  const match = input.match(/^(.*)<(.+)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { email: input.trim() };
}

// Optional helper if you ever want to hydrate userEmail from DB here:
export async function getUserEmail(userId: string): Promise<string | null> {
  const rows = await sql/* sql */`
    select email
    from auth."user"
    where user_id = ${userId}
    limit 1
  `;
  return rows[0]?.email ?? null;
}
