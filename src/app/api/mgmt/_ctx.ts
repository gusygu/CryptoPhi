// src/app/api/mgmt/_ctx.ts
import { getCurrentSession } from "@/app/(server)/auth/session";
import { getPool } from "@/core/db/db";

const pool = () => getPool();

type ManagerRow = {
  manager_id: string;
  display_name: string | null;
  signature_email: string | null;
};

export async function getManagerContext() {
  const session = await getCurrentSession();
  const email = session?.email ?? null;
  if (!email) {
    return {
      email: null,
      managerId: null,
      managerDisplayName: null,
      managerSignatureEmail: null,
    } as const;
  }

  const q = await pool().query<ManagerRow>(
    `
    SELECT manager_id, display_name, signature_email
    FROM admin.managers
    WHERE lower(email) = lower($1::text)
      AND status = 'active'
    LIMIT 1
    `,
    [email]
  );

  const row = q.rows[0];

  return {
    email,
    managerId: row?.manager_id ?? null,
    managerDisplayName: row?.display_name ?? null,
    managerSignatureEmail: row?.signature_email ?? null,
  } as const;
}
