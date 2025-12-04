// src/emails/layouts/TransactionalShell.tsx
import * as React from 'react';

type TransactionalShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

const jetbrainsStack =
  '"JetBrains Mono", Courier New, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function TransactionalShell({ title, subtitle, children }: TransactionalShellProps) {
  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        <title>{title}</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: '#050712',
          color: '#f9fafb',
          fontFamily: jetbrainsStack,
          fontSize: '14px',
          lineHeight: 1.5,
        }}
      >
        <table
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: '#050712', padding: '16px 0' }}
        >
          <tbody>
            <tr>
              <td align="center">
                <table
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: '600px',
                    backgroundColor: '#0b0f1c',
                    borderRadius: '16px',
                    padding: '24px',
                    border: '1px solid #1f2435',
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ textAlign: 'left' }}>
                        <h1
                          style={{
                            margin: '0 0 12px 0',
                            fontSize: '20px',
                            lineHeight: 1.2,
                            fontWeight: 600,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: '#e5e7eb',
                            fontFamily: jetbrainsStack,
                          }}
                        >
                          {title}
                        </h1>

                        {subtitle && (
                          <p
                            style={{
                              margin: '0 0 20px 0',
                              fontSize: '12px',
                              color: '#9ca3af',
                              fontFamily: jetbrainsStack,
                            }}
                          >
                            {subtitle}
                          </p>
                        )}

                        <div
                          style={{
                            fontSize: '14px',
                            color: '#e5e7eb',
                            fontFamily: jetbrainsStack,
                          }}
                        >
                          {children}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
