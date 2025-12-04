// src/core/integrations/brevo.ts
import {
  TransactionalEmailsApi,
  TransactionalEmailsApiApiKeys,
  SendSmtpEmail,
} from "@getbrevo/brevo";

const apiKey = process.env.BREVO_API_KEY;

if (!apiKey) {
  // Optional: throw or log – you don't want to run mail job without this
  console.warn("BREVO_API_KEY is not set – mail worker will fail.");
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
      email: "no-reply@mail.cryptophi.xyz",
      name: "CryptoPhi",
    };
  }
  if (templateKey.startsWith("admin_invite")) {
    return {
      email: "cryptophi@mail.cryptophi.xyz",
      name: "CryptoPhi Admin",
    };
  }
  // fallback
  return {
    email: "no-reply@mail.cryptophi.xyz",
    name: "CryptoPhi",
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
