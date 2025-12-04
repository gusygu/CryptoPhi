import { getPool } from "@/core/db/db";
import type {
  AdminAction,
  CommunityMember,
  Invite,
  MailQueueItem,
  Manager,
  ManagerOverview,
  ManagerStatus,
} from "./types";

const pool = () => getPool();

export async function listManagers(): Promise<Manager[]> {
  const q = await pool().query<Manager>(
    `
    SELECT
      manager_id,
      email,
      display_name,
      signature_email,
      status,
      created_by_email,
      created_at,
      updated_at,
      internal_admin_id
    FROM admin.managers
    ORDER BY created_at DESC
    `
  );
  return q.rows;
}

export type UpsertManagerInput = {
  manager_id?: string | null;
  email: string;
  display_name?: string | null;
  signature_email: string;
  status?: ManagerStatus;
  internal_admin_id?: string | null;
  actorEmail: string | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function upsertManager(input: UpsertManagerInput): Promise<Manager> {
  const managerId = input.manager_id ?? null;
  const email = normalizeEmail(input.email);
  const signature = normalizeEmail(input.signature_email);
  const displayName =
    input.display_name && input.display_name.trim().length > 0
      ? input.display_name.trim()
      : null;
  const status = input.status ?? "active";
  const internalId =
    input.internal_admin_id && input.internal_admin_id.trim().length > 0
      ? input.internal_admin_id.trim().toUpperCase()
      : null;

  if (!email.includes("@")) {
    throw new Error("email must be a valid address");
  }
  if (!signature.includes("@")) {
    throw new Error("signature_email must be a valid address");
  }

  const params = [
    email,
    displayName,
    signature,
    status,
    input.actorEmail ?? null,
    internalId,
  ];

  const manager = managerId
    ? await updateManager(managerId, params)
    : await insertManager(params);

  await logAdminManagerChange(
    managerId ? "admin.manager.update" : "admin.manager.create",
    input.actorEmail ?? null,
    manager
  );

  return manager;
}

async function insertManager(params: any[]): Promise<Manager> {
  const [email, displayName, signature, status, actorEmail, internalId] = params;
  const q = await pool().query<Manager>(
    `
    INSERT INTO admin.managers (
      email,
      display_name,
      signature_email,
      status,
      created_by_email,
      internal_admin_id
    )
    VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text)
    RETURNING *
    `,
    [email, displayName, signature, status, actorEmail, internalId]
  );
  return q.rows[0];
}

async function updateManager(managerId: string, params: any[]): Promise<Manager> {
  const [email, displayName, signature, status, _actorEmail, internalId] = params;
  const q = await pool().query<Manager>(
    `
    UPDATE admin.managers
    SET email = $2::text,
        display_name = $3::text,
        signature_email = $4::text,
        status = $5::text,
        internal_admin_id = $6::text,
        updated_at = now()
    WHERE manager_id = $1::uuid
    RETURNING *
    `,
    [managerId, email, displayName, signature, status, internalId]
  );
  const row = q.rows[0];
  if (!row) {
    throw new Error("Manager not found");
  }
  return row;
}

async function logAdminManagerChange(
  actionKind: "admin.manager.create" | "admin.manager.update",
  actorEmail: string | null,
  manager: Manager
) {
  await pool().query(
    `
    INSERT INTO admin.actions_ledger (
      action_kind,
      action_scope,
      actor_role,
      actor_email,
      manager_id,
      target_email,
      payload
    )
    VALUES (
      $1::text,
      'admin',
      'admin',
      $2::text,
      $3::uuid,
      $4::text,
      jsonb_build_object(
        'managerId', $3::uuid,
        'status', $5::text,
        'internalAdminId', $6::text
      )
    )
    `,
    [
      actionKind,
      actorEmail ?? null,
      manager.manager_id,
      manager.email,
      manager.status,
      manager.internal_admin_id,
    ]
  );
}

export async function getManagerOverview(
  managerId: string
): Promise<ManagerOverview | null> {
  const managerQ = await pool().query<Manager>(
    `
    SELECT
      manager_id,
      email,
      display_name,
      signature_email,
      status,
      created_by_email,
      created_at,
      updated_at,
      internal_admin_id
    FROM admin.managers
    WHERE manager_id = $1::uuid
    LIMIT 1
    `,
    [managerId]
  );

  const manager = managerQ.rows[0];
  if (!manager) {
    return null;
  }

  const [invites, community, recentActions, recentMail] = await Promise.all([
    fetchInvites(managerId),
    fetchCommunity(managerId),
    fetchRecentActions(managerId),
    fetchRecentMail(managerId),
  ]);

  return {
    manager,
    invites,
    community,
    recentActions,
    recentMail,
  };
}

async function fetchInvites(managerId: string): Promise<Invite[]> {
  const q = await pool().query<Invite>(
    `
    SELECT *
    FROM admin.invites
    WHERE manager_id = $1::uuid
    ORDER BY created_at DESC
    LIMIT 100
    `,
    [managerId]
  );
  return q.rows;
}

async function fetchCommunity(managerId: string): Promise<CommunityMember[]> {
  const q = await pool().query<CommunityMember>(
    `
    SELECT *
    FROM admin.community_members
    WHERE manager_id = $1::uuid
    ORDER BY flagged DESC, joined_at DESC
    `,
    [managerId]
  );
  return q.rows;
}

async function fetchRecentActions(managerId: string): Promise<AdminAction[]> {
  const q = await pool().query<AdminAction>(
    `
    SELECT *
    FROM admin.actions_ledger
    WHERE manager_id = $1::uuid
    ORDER BY created_at DESC
    LIMIT 50
    `,
    [managerId]
  );
  return q.rows;
}

async function fetchRecentMail(managerId: string): Promise<MailQueueItem[]> {
  const q = await pool().query<MailQueueItem>(
    `
    SELECT
      mail_id,
      to_email,
      template_key,
      subject_override,
      status,
      scheduled_at,
      sent_at,
      last_error,
      trigger_role,
      trigger_email,
      manager_id,
      created_at,
      updated_at,
      payload
    FROM comms.mail_queue
    WHERE manager_id = $1::uuid
    ORDER BY created_at DESC
    LIMIT 50
    `,
    [managerId]
  );
  return q.rows;
}
