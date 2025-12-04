// src/emails/SessionDigestEmail.tsx
import * as React from 'react';
import { TransactionalShell } from './layouts/TransactionalShell';

type SessionDigestEmailProps = {
  recipientName: string;
  sessionIdShort: string;
  openedAt: string;
};

export function SessionDigestEmail(props: SessionDigestEmailProps) {
  const { recipientName, sessionIdShort, openedAt } = props;

  return (
    <TransactionalShell
      title="Session digest"
      subtitle={`Session ${sessionIdShort} • opened ${openedAt}`}
    >
      <p style={{ margin: '0 0 12px 0' }}>
        Hello {recipientName},
      </p>

      <p style={{ margin: '0 0 12px 0' }}>
        Here is a short summary of your latest Cryptophi session. Matrices and Cin-Aux data are now
        available in your dashboard.
      </p>

      <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#9ca3af' }}>
        You can safely ignore this email if you did not start a new session.
      </p>

      <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
        — Cryptophi engine
      </p>
    </TransactionalShell>
  );
}
