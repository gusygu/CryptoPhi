import { getPool } from "@/core/db/db";
import type {
  AdminInviteLink,
  AdminInviteStats,
  AdminInviteTemplate,
} from "./types";

const pool = () => getPool();

const ADMIN_WEEKLY_INVITE_LIMIT = 15;
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.APP_BASE_URL ??
  "https://app.cryptophi.xyz";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function cleanBaseUrl(base: string) {
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function nowUtc() {
  return new Date();
}

function mondayNoonWindow(now: Date = nowUtc()) {
  const day = now.getUTCDay(); // 0=Sun, 1=Mon
  const daysSinceMonday = (day + 6) % 7; // Monday =>0, Tuesday=>1,...
  const base = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      12,
      0,
      0,
      0
    )
  );
  base.setUTCDate(base.getUTCDate() - daysSinceMonday);
  if (now.getTime() < base.getTime()) {
    base.setUTCDate(base.getUTCDate() - 7);
  }
  const end = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start: base, end };
}

async function readWeeklyUsage(adminEmail: string) {
  const normalized = normalizeEmail(adminEmail);
  const { start, end } = mondayNoonWindow();
  const q = await pool().query<{ total: string }>(
    `
    SELECT count(*)::int AS total
    FROM admin.invites
    WHERE created_by_role = 'admin'
      AND lower(created_by_email) = lower($1::text)
      AND created_at >= $2::timestamptz
  `,
    [normalized, start.toISOString()]
  );
  const used = Number(q.rows[0]?.total ?? 0);
  const remaining = Math.max(0, ADMIN_WEEKLY_INVITE_LIMIT - used);
  const stats: AdminInviteStats = {
    limit: ADMIN_WEEKLY_INVITE_LIMIT,
    used,
    remaining,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
  return stats;
}

async function ensureInviteCapacity(adminEmail: string) {
  const stats = await readWeeklyUsage(adminEmail);
  if (stats.remaining <= 0) {
    throw new Error(
      `Weekly admin invite limit reached (${ADMIN_WEEKLY_INVITE_LIMIT}). Next window opens ${new Date(
        stats.windowEnd
      ).toUTCString()}.`
    );
  }
  return stats;
}

function linkForToken(token: string) {
  return `${cleanBaseUrl(APP_BASE_URL)}/auth/invite/${token}`;
}

async function insertAdminInvite(opts: {
  adminEmail: string;
  targetEmail?: string | null;
}) {
  const normalizedAdmin = normalizeEmail(opts.adminEmail);
  const normalizedTarget = opts.targetEmail
    ? normalizeEmail(opts.targetEmail)
    : null;
  const q = await pool().query<{
    invite_id: string;
    token: string;
  }>(
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
      'admin',
      $2::text,
      NULL,
      'pending',
      gen_random_uuid(),
      now() + interval '14 days'
    )
    RETURNING invite_id, token
    `,
    [normalizedTarget, normalizedAdmin]
  );
  return q.rows[0];
}

async function logAdminAction(params: {
  actionKind: "admin.invite.link" | "admin.invite.email";
  adminEmail: string;
  inviteId: string;
  targetEmail?: string | null;
  payload?: Record<string, unknown>;
}) {
  const { actionKind, adminEmail, inviteId, targetEmail, payload } = params;
  await pool().query(
    `
    INSERT INTO admin.actions_ledger (
      action_kind,
      action_scope,
      actor_role,
      actor_email,
      invite_id,
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
      $5::jsonb
    )
    `,
    [
      actionKind,
      normalizeEmail(adminEmail),
      inviteId,
      targetEmail ? normalizeEmail(targetEmail) : null,
      JSON.stringify(payload ?? {}),
    ]
  );
}

export async function listAdminInviteTemplates(): Promise<AdminInviteTemplate[]> {
  const q = await pool().query<AdminInviteTemplate>(
    `
    SELECT
      template_id,
      template_key,
      lang,
      subject,
      description
    FROM comms.mail_templates
    WHERE template_key LIKE 'admin_invite%'
      AND is_active = true
    ORDER BY subject ASC
    `
  );
  return q.rows;
}

export async function getAdminInviteStats(
  adminEmail: string
): Promise<AdminInviteStats> {
  return readWeeklyUsage(adminEmail);
}

export async function createAdminInviteLink(input: {
  adminEmail: string;
  targetEmail: string;
}): Promise<{ link: AdminInviteLink; stats: AdminInviteStats }> {
  await ensureInviteCapacity(input.adminEmail);
  const invite = await insertAdminInvite({
    adminEmail: input.adminEmail,
    targetEmail: input.targetEmail,
  });
  const link: AdminInviteLink = {
    invite_id: invite.invite_id,
    token: invite.token,
    url: linkForToken(invite.token),
  };
  await logAdminAction({
    actionKind: "admin.invite.link",
    adminEmail: input.adminEmail,
    inviteId: invite.invite_id,
    payload: { inviteUrl: link.url },
  });
  const stats = await readWeeklyUsage(input.adminEmail);
  return { link, stats };
}

export async function sendAdminInviteEmail(input: {
  adminEmail: string;
  adminName: string;
  toEmail: string;
  templateKey: string;
  inviteToken?: string | null;
}): Promise<{ inviteToken: string; inviteUrl: string; stats: AdminInviteStats }> {
  const normalizedAdmin = normalizeEmail(input.adminEmail);
  const normalizedTarget = normalizeEmail(input.toEmail);

  let inviteRow: { invite_id: string; token: string } | null = null;
  if (input.inviteToken) {
    const existing = await pool().query<{ invite_id: string; token: string }>(
      `
      SELECT invite_id, token
      FROM admin.invites
      WHERE token = $1::uuid
        AND created_by_role = 'admin'
        AND lower(created_by_email) = lower($2::text)
      LIMIT 1
      `,
      [input.inviteToken, normalizedAdmin]
    );
    inviteRow = existing.rows[0] ?? null;
    if (inviteRow) {
      await pool().query(
        `
        UPDATE admin.invites
        SET target_email = $2::text,
            updated_at = now()
        WHERE invite_id = $1::uuid
        `,
        [inviteRow.invite_id, normalizedTarget]
      );
    }
  }

  if (!inviteRow) {
    await ensureInviteCapacity(input.adminEmail);
    inviteRow = await insertAdminInvite({
      adminEmail: input.adminEmail,
      targetEmail: normalizedTarget,
    });
  }

  if (!inviteRow) {
    throw new Error("Failed to create or reuse admin invite.");
  }

  const inviteUrl = linkForToken(inviteRow.token);

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
      $2::text,
      jsonb_build_object(
        'adminName', $3::text,
        'inviteUrl', $4::text
      ),
      'pending',
      'admin',
      $5::text,
      NULL,
      now()
    )
    `,
    [
      normalizedTarget,
      input.templateKey,
      input.adminName,
      inviteUrl,
      normalizedAdmin,
    ]
  );

  await logAdminAction({
    actionKind: "admin.invite.email",
    adminEmail: input.adminEmail,
    inviteId: inviteRow.invite_id,
    targetEmail: normalizedTarget,
    payload: { templateKey: input.templateKey },
  });

  const stats = await readWeeklyUsage(input.adminEmail);

  return { inviteToken: inviteRow.token, inviteUrl, stats };
}
