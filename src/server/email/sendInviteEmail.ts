export type SendInviteEmailPayload = {
  to: string;
  inviterName: string;
  inviteUrl: string;
  subject?: string;
};

export async function sendInviteEmail(payload: SendInviteEmailPayload) {
  console.info(
    "[sendInviteEmail] stub dispatch:",
    payload.to,
    payload.inviterName,
    payload.inviteUrl,
  );
  return Promise.resolve();
}
