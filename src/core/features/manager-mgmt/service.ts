import { getPool } from "@/core/db/db";
import type { CommunityMember, Invite } from "@/core/features/admin-mgmt/types";

const pool = () => getPool();
const MAX_MANAGER_PEOPLE = 20;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const BASE_URL =
  (process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_BASE_URL || "http://localhost:3000").replace(
    /\/+$/,
    ""
  );

function buildInviteUrl(token: string) {
  return `${BASE_URL}/auth?invite=${encodeURIComponent(token)}`;
}

async function countManagerPeople(managerId: string): Promise<number> {
  const q = await pool().query<{ cnt: string }>(
    `
    WITH invite_emails AS (
      SELECT DISTINCT lower(target_email) AS email
      FROM admin.invites
      WHERE manager_id = $1::uuid
    ),
    member_emails AS (
      SELECT DISTINCT lower(email) AS email
      FROM admin.community_members
      WHERE manager_id = $1::uuid
    ),
    unioned AS (
      SELECT email FROM invite_emails
      UNION
      SELECT email FROM member_emails
    )
    SELECT count(*)::text AS cnt FROM unioned
    `,
    [managerId]
  );
  return Number(q.rows[0]?.cnt ?? "0");
}

async function logManagerAction(params: {
  actionKind: string;
  actorEmail: string | null;
  managerId: string;
  targetEmail: string | null;
  payload?: Record<string, unknown>;
  inviteId?: string | null;
  memberId?: string | null;
}) {
  const { actionKind, actorEmail, managerId, targetEmail, payload, inviteId, memberId } = params;
  await pool().query(
    `
    INSERT INTO admin.actions_ledger (
      action_kind,
      action_scope,
      actor_role,
      actor_email,
      manager_id,
      target_email,
      invite_id,
      member_id,
      payload
    )
    VALUES (
      $1::text,
      'manager',
      'manager',
      $2::text,
      $3::uuid,
      $4::text,
      $5::uuid,
      $6::uuid,
      $7::jsonb
    )
    `,
    [
      actionKind,
      actorEmail ?? null,
      managerId,
      targetEmail ?? null,
      inviteId ?? null,
      memberId ?? null,
      JSON.stringify(payload ?? {}),
    ]
  );
}

export async function listManagerInvitesByEmail(managerId: string): Promise<Invite[]> {
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

export async function listManagerCommunityByEmail(
  managerId: string
): Promise<CommunityMember[]> {
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

export async function createInviteForManager(input: {
  managerId: string;
  managerEmail: string | null;
  managerDisplayName?: string | null;
  targetEmail: string;
}): Promise<Invite> {
  const { managerId, managerEmail, managerDisplayName, targetEmail } = input;
  const normalizedTarget = normalizeEmail(targetEmail);
  if (!normalizedTarget || !normalizedTarget.includes("@")) {
    throw new Error("targetEmail must be a valid email");
  }

  const peopleCount = await countManagerPeople(managerId);
  if (peopleCount >= MAX_MANAGER_PEOPLE) {
    throw new Error(`Invite limit reached (max ${MAX_MANAGER_PEOPLE} people per manager)`);
  }

  const managerName =
    managerDisplayName && managerDisplayName.trim().length > 0
      ? managerDisplayName.trim()
      : managerEmail ?? "Community Manager";

  const inviteRes = await pool().query<Invite>(
    `
    INSERT INTO admin.invites (
      target_email,
      created_by_role,
      created_by_email,
      manager_id,
      status,
      token,
      expires_at
    )
    VALUES (
      $1::text,
      'manager',
      $2::text,
      $3::uuid,
      'pending',
      gen_random_uuid(),
      now() + interval '7 days'
    )
    ON CONFLICT (manager_id, lower(target_email)) DO UPDATE SET
      status      = 'pending',
      expires_at  = GREATEST(admin.invites.expires_at, now() + interval '7 days'),
      updated_at  = now()
    RETURNING *
    `,
    [normalizedTarget, managerEmail ?? null, managerId]
  );

  const invite = inviteRes.rows[0];
  const inviteUrl = buildInviteUrl(invite.token);

  await pool().query(
    `
    INSERT INTO comms.mail_queue (
      to_email,
      template_key,
      payload,
      status,
      trigger_role,
      trigger_email,
      manager_id,
      scheduled_at
    )
    VALUES (
      $1::text,
      'manager_invite',
      jsonb_build_object(
        'managerName', $2::text,
        'managerEmail', $3::text,
        'inviteToken', $4::uuid,
        'inviteUrl', $5::text
      ),
      'pending',
      'manager',
      $3::text,
      $6::uuid,
      now()
    )
    `,
    [
      normalizedTarget,
      managerName,
      managerEmail ?? null,
      invite.token,
      inviteUrl,
      managerId,
    ]
  );

  await logManagerAction({
    actionKind: "manager.invite.create",
    actorEmail: managerEmail ?? null,
    managerId,
    targetEmail: normalizedTarget,
    payload: { inviteId: invite.invite_id },
    inviteId: invite.invite_id,
  });

  return invite;
}

export async function signalMember(input: {
  managerId: string;
  managerEmail: string | null;
  memberId: string;
  reason?: string;
}) {
  const { managerId, managerEmail, memberId, reason } = input;
  const reasonText = reason?.trim() ?? null;
  const q = await pool().query<{ member_id: string; email: string }>(
    `
    UPDATE admin.community_members
    SET flagged = true,
        flag_reason = COALESCE($3::text, flag_reason),
        flagged_at = now()
    WHERE member_id = $1::uuid
      AND manager_id = $2::uuid
    RETURNING member_id, email
    `,
    [memberId, managerId, reasonText]
  );

  const member = q.rows[0];
  if (!member) {
    throw new Error("Community member not found");
  }

  await logManagerAction({
    actionKind: "manager.community.signal",
    actorEmail: managerEmail ?? null,
    managerId,
    targetEmail: member.email,
    payload: { reason: reasonText },
    memberId: member.member_id,
  });
}

export async function toggleSuspendMember(input: {
  managerId: string;
  managerEmail: string | null;
  memberId: string;
  suspend: boolean;
}) {
  const { managerId, managerEmail, memberId, suspend } = input;

  if (suspend) {
    const q = await pool().query<{ member_id: string; email: string; suspended_until: string | null }>(
      `
      UPDATE admin.community_members
      SET status = 'suspended',
          suspended_until = now() + interval '2 days'
      WHERE member_id = $1::uuid
        AND manager_id = $2::uuid
      RETURNING member_id, email, suspended_until
      `,
      [memberId, managerId]
    );

    const member = q.rows[0];
    if (!member) {
      throw new Error("Community member not found");
    }

    await logManagerAction({
      actionKind: "manager.community.suspend",
      actorEmail: managerEmail ?? null,
      managerId,
      targetEmail: member.email,
      payload: { suspendedUntil: member.suspended_until },
      memberId: member.member_id,
    });
  } else {
    const q = await pool().query<{ member_id: string; email: string }>(
      `
      UPDATE admin.community_members
      SET status = 'active',
          suspended_until = NULL
      WHERE member_id = $1::uuid
        AND manager_id = $2::uuid
      RETURNING member_id, email
      `,
      [memberId, managerId]
    );

    const member = q.rows[0];
    if (!member) {
      throw new Error("Community member not found");
    }

    await logManagerAction({
      actionKind: "manager.community.unsuspend",
      actorEmail: managerEmail ?? null,
      managerId,
      targetEmail: member.email,
      payload: {},
      memberId: member.member_id,
    });
  }
}
