import * as Brevo from "@getbrevo/brevo";

type SenderId = "system" | "alerts" | "support" | "gus";

type EmailPayload = {
  to: string | string[];
  subject: string;
  text: string;
  /**
   * Logical sender. Defaults to "system".
   * Controls which MAIL_FROM_* env is used.
   */
  sender?: SenderId;
  /**
   * Optional fully custom from string: "Name <email@domain>".
   * If provided, this overrides `sender`.
   */
  fromOverride?: string;
};

function normalizeRecipients(to: string | string[]): string[] {
  if (Array.isArray(to)) {
    return to.map((entry) => entry.trim()).filter(Boolean);
  }
  return to
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Map logical sender IDs to env-based from strings
const SENDER_MAP: Record<SenderId, string> = {
  system:
    process.env.MAIL_FROM_SYSTEM ??
    process.env.MAIL_FROM ??
    process.env.BREVO_SENDER ??
    process.env.SMTP_USER ??
    "CryptoPhi System <no-reply@localhost>",
  alerts:
    process.env.MAIL_FROM_ALERTS ??
    "CryptoPhi Alerts <alerts@mail.cryptophi.xyz>",
  support:
    process.env.MAIL_FROM_SUPPORT ??
    "CryptoPhi Support <support@cryptophi.xyz>",
  gus:
    process.env.MAIL_FROM_GUS ??
    "gus <gus@cryptophi.xyz>",
};

function parseFromAddress(fromEnv?: string) {
  const raw =
    fromEnv ??
    process.env.MAIL_FROM ??
    process.env.BREVO_SENDER ??
    process.env.SMTP_USER;

  if (!raw) {
    return { email: "no-reply@localhost", name: "CryptoPhi" };
  }

  const match = raw.match(/(.*)<(.+)>/);
  if (match) {
    return {
      email: match[2].trim(),
      name: match[1].trim() || undefined,
    };
  }
  return { email: raw.trim(), name: "CryptoPhi" };
}

const brevoClient = new Brevo.TransactionalEmailsApi();
const brevoApiKey = process.env.BREVO_API_KEY || "";
if (brevoApiKey) {
  brevoClient.setApiKey(
    Brevo.TransactionalEmailsApiApiKeys.apiKey,
    brevoApiKey
  );
}

/**
 * Sends transactional emails through Brevo.
 * Falls back to console logging if no API key is configured.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const recipients = normalizeRecipients(payload.to);
  if (!recipients.length) {
    console.info("[mail] skipped (no recipients)", payload.subject);
    return;
  }

  if (!brevoApiKey) {
    console.info(
      `[mail] (dry run) to=${recipients.join(", ")} | subject=${
        payload.subject
      } | sender=${payload.sender ?? "system"}\n${payload.text}`
    );
    return;
  }

  // Pick from address: override → sender map → env fallback
  const fromRaw =
    payload.fromOverride ??
    (payload.sender ? SENDER_MAP[payload.sender] : undefined);

  const sender = parseFromAddress(fromRaw);

  try {
    await brevoClient.sendTransacEmail({
      sender,
      to: recipients.map((email) => ({ email })),
      subject: payload.subject,
      textContent: payload.text,
    });
  } catch (err) {
    console.error("[mail] Brevo send failed", err);
  }
}
