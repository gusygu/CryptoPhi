declare module "@getbrevo/brevo" {
  export class TransactionalEmailsApi {
    constructor();
    setApiKey(key: TransactionalEmailsApiApiKeys, value: string): void;
    sendTransacEmail(payload: SendSmtpEmail): Promise<{ body: unknown }>;
  }

  export enum TransactionalEmailsApiApiKeys {
    apiKey = "apiKey",
  }

  export class SendSmtpEmail {
    sender?: { email: string; name?: string };
    to?: Array<{ email: string; name?: string }>;
    subject?: string;
    htmlContent?: string;
    textContent?: string;
  }
}
