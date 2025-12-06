// src/core/integrations/brevo.ts
import {
  TransactionalEmailsApi,
  TransactionalEmailsApiApiKeys,
  SendSmtpEmail,
} from "@getbrevo/brevo";

const apiKey = process.env.BREVO_API_KEY;
const DEFAULT_FROM_EMAIL =
  process.env.BREVO_FROM_DEFAULT || "cryptophi@cryptophi.xyz";
const DEFAULT_FROM_NAME =
  process.env.BREVO_FROM_NAME_DEFAULT || "CryptoPhi";
const ADMIN_FROM_EMAIL =
  process.env.BREVO_FROM_ADMIN || DEFAULT_FROM_EMAIL;
const ADMIN_FROM_NAME =
  process.env.BREVO_FROM_NAME_ADMIN || "CryptoPhi Admin";
const MANAGER_FROM_EMAIL =
  process.env.BREVO_FROM_MANAGER || DEFAULT_FROM_EMAIL;
const MANAGER_FROM_NAME =
  process.env.BREVO_FROM_NAME_MANAGER || "CryptoPhi";

if (!apiKey) {
  // Optional: throw or log - you don't want to run mail job without this
  console.warn("BREVO_API_KEY is not set - mail worker will fail.");
}

const transacApi = new TransactionalEmailsApi();
if (apiKey) {
  transacApi.setApiKey(
    TransactionalEmailsApiApiKeys.apiKey,
    apiKey
  );
}

// Helper: choose sender based on template_key
export function getSenderForTemplate(templateKey: string) {
  if (templateKey === "manager_invite") {
    return {
      email: MANAGER_FROM_EMAIL,
      name: MANAGER_FROM_NAME,
    };
  }
  if (templateKey.startsWith("admin_invite")) {
    return {
      email: ADMIN_FROM_EMAIL,
      name: ADMIN_FROM_NAME,
    };
  }
  // fallback
  return {
    email: DEFAULT_FROM_EMAIL,
    name: DEFAULT_FROM_NAME,
  };
}

export async function sendBrevoEmail(args: {
  toEmail: string;
  toName?: string | null;
  subject: string;
  htmlContent: string;
  templateKey: string;
}) {
  const { toEmail, toName, subject, htmlContent, templateKey } = args;
  const sender = getSenderForTemplate(templateKey);

  const payload: SendSmtpEmail = {
    sender,
    to: [{ email: toEmail, name: toName ?? undefined }],
    subject,
    htmlContent,
  };

  const res = await transacApi.sendTransacEmail(payload);
  return res.body; // contains messageId, etc.
}

export default class BrevoApiClient {
  private readonly client: TransactionalEmailsApi;

  constructor(opts: { apiKey?: string } = {}) {
    const key = opts.apiKey ?? apiKey;
    if (!key) {
      throw new Error("BREVO_API_KEY is not configured.");
    }
    this.client = new TransactionalEmailsApi();
    this.client.setApiKey(TransactionalEmailsApiApiKeys.apiKey, key);
  }

  async sendEmail(payload: SendSmtpEmail) {
    return this.client.sendTransacEmail(payload);
  }
}
