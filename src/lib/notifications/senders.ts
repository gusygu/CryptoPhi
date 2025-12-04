// src/lib/email/senders.ts

type SenderId =
  | "system"      // app transactional (invites, signup, etc.)
  | "alerts"      // daemon / job alerts
  | "family";     // your personal one for now

type SenderConfig = {
  from: string;
  replyTo?: string;
};

const FALLBACK_FROM = process.env.EMAIL_FROM_SYSTEM || "no-reply@send.cryptophi.xyz";
const SUPPORT_REPLY_TO = process.env.EMAIL_REPLY_TO_SUPPORT || "support@cryptophi.xyz";

export const SENDERS: Record<SenderId, SenderConfig> = {
  system: {
    from: process.env.EMAIL_FROM_SYSTEM || FALLBACK_FROM,
    replyTo: SUPPORT_REPLY_TO,
  },
  alerts: {
    from: process.env.EMAIL_FROM_ALERTS || FALLBACK_FROM,
    replyTo: SUPPORT_REPLY_TO,
  },
  family: {
    from: process.env.EMAIL_FROM_FAMILY || FALLBACK_FROM,
    replyTo: process.env.EMAIL_FROM_FAMILY || FALLBACK_FROM,
  },
};

export type { SenderId, SenderConfig };
