// src/lib/email/transactional.ts
import { brevoTransport } from "./transport";
import { SENDERS, type SenderId } from "./senders";

export type EmailPayload = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  sender?: SenderId; // default "system"
  headers?: Record<string, string>;
};

export async function sendTransactionalEmail(payload: EmailPayload) {
  const {
    to,
    subject,
    html,
    text,
    sender = "system",
    headers = {},
  } = payload;

  const senderCfg = SENDERS[sender];
  if (!senderCfg) {
    throw new Error(`[email] Unknown sender: ${sender}`);
  }

  const from = senderCfg.from;
  const replyTo = senderCfg.replyTo ?? from;

  const info = await brevoTransport.sendMail({
    from,
    to,
    subject,
    html,
    text,
    replyTo,
    headers,
  });

  // hook point for logging
  // await logEmailSend({ sender, to, subject, messageId: info.messageId });

  return info;
}
