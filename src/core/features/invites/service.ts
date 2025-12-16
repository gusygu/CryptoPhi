import { createHash, randomBytes, randomUUID } from "crypto";
import { getPool } from "@/core/db/db";

export type InviteTier = "admin" | "mgmt" | "user";

export type InviteStats = {
  tier: InviteTier;
  weekUsed: number;
  weekLimit: number;
  lifetimeUsed: number;
  lifetimeLimit: number;
};

export type InviteLink = {
  inviteId: string;
  inviteUrl: string;
  expiresAt: string;
  rawToken: string;
};

export type InviteListItem = {
  id: string | null;
  recipient_email: string | null;
  nickname: string | null;
  note: string | null;
  status: string | null;
  created_at: string | null;
  expires_at: string | null;
  consumed_at: string | null;
};

type SessionLike = {
  userId: string;
  email: string;
  isAdmin: boolean;
};

const ADMIN_WEEK_LIMIT = 15;
const MGMT_LIFETIME_LIMIT = 20;
const USER_LIFETIME_LIMIT = 1;
const DEFAULT_EXPIRES_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class InviteError extends Error {
  code: string;
  status: number;
  detail?: Record<string, any>;

  constructor(code: string, message: string, status = 400, detail?: Record<string, any>) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

function baseUrl(origin?: string | null) {
  const fromEnv =
    process.env.PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.BASE_URL;
  const chosen = fromEnv || origin || "http://localhost:3000";
  return chosen.replace(/\/+$/, "");
}

function buildInviteUrl(rawToken: string, origin?: string | null) {
  return `${baseUrl(origin)}/register?token=${encodeURIComponent(rawToken)}`;
}

async function resolveManagerId(email: string, client: any): Promise<string | null> {
  try {
    const q = await client.query<{ manager_id: string }>(
      `
      SELECT manager_id
      FROM admin.managers
      WHERE lower(email) = lower($1::text)
        AND status = 'active'
      LIMIT 1
      `,
      [email]
    );
    return q.rows[0]?.manager_id ?? null;
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    const missing = msg.includes("admin.managers") || msg.includes("relation") && msg.includes("does not exist");
    if (missing) return null;
    throw err;
  }
}

async function resolveTier(session: SessionLike, client: any): Promise<{ tier: InviteTier; managerId: string | null }> {
  if (session.isAdmin) return { tier: "admin", managerId: null };
  const managerId = await resolveManagerId(session.email, client);
  if (managerId) return { tier: "mgmt", managerId };
  return { tier: "user", managerId: null };
}

async function getInviteColumns(client: any): Promise<Set<string>> {
  const r = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='admin'
      AND table_name='invites'
    `
  );
  return new Set(r.rows.map((x) => x.column_name));
}

async function ensureCompatView(client: any) {
  try {
    const exists = await client.query<{ exists: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'admin' AND table_name = 'v_invites_compat'
      ) AS exists
      `
    );
    if (exists.rows[0]?.exists) return;
  } catch (err) {
    console.warn("[invites] failed to check compat view:", err);
  }

  const viewSql = `
    CREATE OR REPLACE VIEW admin.v_invites_compat AS
    SELECT
      COALESCE(
        NULLIF((to_jsonb(i)->>'id')::text, '')::uuid,
        NULLIF((to_jsonb(i)->>'invite_id')::text, '')::uuid,
        NULLIF((to_jsonb(i)->>'invite_uuid')::text, '')::uuid
      ) AS id,
      COALESCE(
        to_jsonb(i)->>'recipient_email',
        to_jsonb(i)->>'email',
        to_jsonb(i)->>'recipient',
        to_jsonb(i)->>'to_email',
        to_jsonb(i)->>'target_email'
      ) AS recipient_email,
      COALESCE(
        to_jsonb(i)->>'nickname',
        to_jsonb(i)->>'recipient_nickname'
      ) AS nickname,
      COALESCE(
        to_jsonb(i)->>'note',
        to_jsonb(i)->>'message'
      ) AS note,
      COALESCE(
        to_jsonb(i)->>'status',
        CASE WHEN (to_jsonb(i)->>'consumed_at') IS NOT NULL THEN 'consumed' ELSE 'pending' END
      ) AS status,
      COALESCE(
        (to_jsonb(i)->>'created_at')::timestamptz,
        now()
      ) AS created_at,
      NULLIF(to_jsonb(i)->>'expires_at','')::timestamptz AS expires_at,
      NULLIF(to_jsonb(i)->>'consumed_at','')::timestamptz AS consumed_at,
      NULLIF(to_jsonb(i)->>'created_by','')::uuid AS created_by,
      COALESCE(
        NULLIF(to_jsonb(i)->>'invite_token_uuid','')::uuid,
        NULLIF(to_jsonb(i)->>'token_uuid','')::uuid,
        NULLIF(to_jsonb(i)->>'token_id','')::uuid
      ) AS invite_token_uuid,
      COALESCE(
        to_jsonb(i)->>'invite_token_hash',
        to_jsonb(i)->>'token_hash',
        to_jsonb(i)->>'hash'
      ) AS invite_token_hash
    FROM admin.invites i;
  `;

  try {
    await client.query(viewSql);
  } catch (err) {
    console.warn("[invites] failed to create compat view (non-blocking):", err);
  }
}

async function readUsage(client: any, createdBy: string) {
  const weekWindow = new Date(Date.now() - 7 * MS_PER_DAY).toISOString();
  const { rows: weekRows } = await client.query<{ count: string }>(
    `
    SELECT count(*)::int AS count
    FROM auth.invite_token
    WHERE created_by_user_id = $1::uuid
      AND created_at >= $2::timestamptz
    `,
    [createdBy, weekWindow]
  );
  const { rows: lifetimeRows } = await client.query<{ count: string }>(
    `
    SELECT count(*)::int AS count
    FROM auth.invite_token
    WHERE created_by_user_id = $1::uuid
    `,
    [createdBy]
  );
  return {
    weekUsed: Number(weekRows[0]?.count ?? 0),
    lifetimeUsed: Number(lifetimeRows[0]?.count ?? 0),
  };
}

function buildStats(tier: InviteTier, usage: { weekUsed: number; lifetimeUsed: number }, includeNew = 0): InviteStats {
  const weekLimit = tier === "admin" ? ADMIN_WEEK_LIMIT : tier === "mgmt" ? MGMT_LIFETIME_LIMIT : USER_LIFETIME_LIMIT;
  const lifetimeLimit = tier === "admin" ? ADMIN_WEEK_LIMIT : tier === "mgmt" ? MGMT_LIFETIME_LIMIT : USER_LIFETIME_LIMIT;

  const weekUsed = usage.weekUsed + includeNew;
  const lifetimeUsed = usage.lifetimeUsed + includeNew;

  return {
    tier,
    weekUsed,
    weekLimit,
    lifetimeUsed,
    lifetimeLimit,
  };
}

export async function getInviteStatsForUser(session: SessionLike): Promise<InviteStats> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const tierInfo = await resolveTier(session, client);
    const usage = await readUsage(client, session.userId);
    return buildStats(tierInfo.tier, usage, 0);
  } finally {
    client.release();
  }
}

export async function createInviteLink(params: {
  session: SessionLike;
  recipientEmail: string;
  role?: string | null;
  expiresInDays?: number;
  origin?: string | null;
  note?: string | null;
}): Promise<{ link: InviteLink; stats: InviteStats }> {
  const { session, recipientEmail, role, expiresInDays, origin, note } = params;
  if (!session?.userId || !session.email) {
    throw new InviteError("UNAUTHENTICATED", "Sign in required", 401);
  }
  const normalizedRecipient = normalizeEmail(recipientEmail || "");
  if (!normalizedRecipient || !normalizedRecipient.includes("@")) {
    throw new InviteError("INVALID_EMAIL", "A valid recipient email is required", 400);
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tierInfo = await resolveTier(session, client);
    const usage = await readUsage(client, session.userId);

    if (tierInfo.tier === "admin" && usage.weekUsed >= ADMIN_WEEK_LIMIT) {
      throw new InviteError("INVITE_QUOTA_EXCEEDED", "Admin weekly invite limit reached", 429, {
        tier: tierInfo.tier,
        used: usage.weekUsed,
        limit: ADMIN_WEEK_LIMIT,
        scope: "week",
      });
    }
    if (tierInfo.tier === "mgmt" && usage.lifetimeUsed >= MGMT_LIFETIME_LIMIT) {
      throw new InviteError("INVITE_QUOTA_EXCEEDED", "Manager invite limit reached", 429, {
        tier: tierInfo.tier,
        used: usage.lifetimeUsed,
        limit: MGMT_LIFETIME_LIMIT,
        scope: "lifetime",
      });
    }
    if (tierInfo.tier === "user" && usage.lifetimeUsed >= USER_LIFETIME_LIMIT) {
      throw new InviteError("INVITE_QUOTA_EXCEEDED", "Personal invite already used", 429, {
        tier: tierInfo.tier,
        used: usage.lifetimeUsed,
        limit: USER_LIFETIME_LIMIT,
        scope: "lifetime",
      });
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + (expiresInDays ?? DEFAULT_EXPIRES_DAYS) * MS_PER_DAY);

    const tokenInsert = await client.query<{
      invite_id: string;
      created_at: string;
      expires_at: string | null;
    }>(
      `
      INSERT INTO auth.invite_token (
        email,
        token,
        status,
        expires_at,
        created_by_user_id
      )
      VALUES (
        $1::text,
        $2::text,
        'issued',
        $3::timestamptz,
        $4::uuid
      )
      RETURNING invite_id, created_at, expires_at
      `,
      [normalizedRecipient, tokenHash, expiresAt.toISOString(), session.userId]
    );

    const tokenRow = tokenInsert.rows[0];
    if (!tokenRow?.invite_id) {
      throw new InviteError("INVITE_CREATE_FAILED", "Failed to create invite token", 500);
    }

    const inviteId = tokenRow.invite_id;
    const inviteRole = (role && role.trim()) || "user";
    const inviteTokenUuid = randomUUID();

    const cols = await getInviteColumns(client);

    const idCol =
      cols.has("id") ? "id"
      : cols.has("invite_id") ? "invite_id"
      : "id";

    const emailCol =
      cols.has("target_email") ? "target_email"
      : cols.has("recipient_email") ? "recipient_email"
      : cols.has("email") ? "email"
      : null;

    if (!emailCol) {
      throw new Error("No email column found on admin.invites");
    }

    const insertCols: string[] = [idCol, emailCol];
    const insertVals: any[] = [inviteId, normalizedRecipient];

    if (cols.has("status")) {
      insertCols.push("status");
      insertVals.push("pending");
    }

    if (cols.has("created_at")) {
      insertCols.push("created_at");
      insertVals.push(new Date());
    }

    if (cols.has("created_by")) {
      insertCols.push("created_by");
      insertVals.push(session.userId);
    }

    if (cols.has("role")) {
      insertCols.push("role");
      insertVals.push(inviteRole);
    }

    if (cols.has("created_by_role")) {
      insertCols.push("created_by_role");
      insertVals.push(tierInfo.tier === "mgmt" ? "manager" : tierInfo.tier);
    }

    if (cols.has("created_by_email")) {
      insertCols.push("created_by_email");
      insertVals.push(session.email);
    }

    if (cols.has("manager_id") && tierInfo.managerId) {
      insertCols.push("manager_id");
      insertVals.push(tierInfo.managerId);
    }

    if (cols.has("expires_at")) {
      insertCols.push("expires_at");
      insertVals.push(expiresAt.toISOString());
    }

    if (cols.has("invite_token_uuid")) {
      insertCols.push("invite_token_uuid");
      insertVals.push(inviteTokenUuid);
    } else if (cols.has("token")) {
      insertCols.push("token");
      insertVals.push(inviteTokenUuid);
    }

    if (cols.has("invite_token_hash")) {
      insertCols.push("invite_token_hash");
      insertVals.push(tokenHash);
    } else if (cols.has("token_hash")) {
      insertCols.push("token_hash");
      insertVals.push(tokenHash);
    }

    if (cols.has("note") && note) {
      insertCols.push("note");
      insertVals.push(note);
    }

    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(", ");
    await client.query(
      `INSERT INTO admin.invites (${insertCols.join(", ")}) VALUES (${placeholders})`,
      insertVals
    );

    await client.query("COMMIT");

    const stats = buildStats(tierInfo.tier, usage, 1);
    const inviteUrl = buildInviteUrl(rawToken, origin);

    return {
      link: {
        inviteId,
        inviteUrl,
        expiresAt: expiresAt.toISOString(),
        rawToken,
      },
      stats,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function listInvites(params: {
  status?: "pending" | "all";
  limit?: number;
}): Promise<InviteListItem[]> {
  const { status = "pending", limit = 50 } = params;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await ensureCompatView(client);
    const capped = Math.min(Math.max(Number(limit) || 1, 1), 200);
    try {
      const rows = await client.query<InviteListItem>(
        `
        SELECT
          id,
          recipient_email,
          nickname,
          note,
          status,
          created_at,
          expires_at,
          consumed_at
        FROM admin.v_invites_compat
        WHERE ($1::text IS NULL OR status = $1::text)
        ORDER BY created_at DESC
        LIMIT $2
        `,
        [status === "pending" ? "pending" : null, capped]
      );

      return rows.rows.map((row) => ({
        ...row,
        id: row.id ?? null,
        recipient_email: row.recipient_email ?? null,
        nickname: row.nickname ?? null,
        note: row.note ?? null,
        status: row.status ?? null,
        created_at: row.created_at ?? null,
        expires_at: row.expires_at ?? null,
        consumed_at: row.consumed_at ?? null,
      }));
    } catch (err) {
      console.warn("[invites] compat view missing; falling back to admin.invites", err);
      const fallback = await client.query<{
        id: string | null;
        invite_id: string | null;
        target_email: string | null;
        recipient_email: string | null;
        status: string | null;
        created_at: string | null;
        expires_at: string | null;
        consumed_at: string | null;
        note: string | null;
      }>(
        `
        SELECT
          COALESCE(invite_id, id) AS id,
          COALESCE(recipient_email, target_email) AS recipient_email,
          status,
          created_at,
          expires_at,
          consumed_at,
          note
        FROM admin.invites
        WHERE ($1::text IS NULL OR status = $1::text)
        ORDER BY created_at DESC
        LIMIT $2
        `,
        [status === "pending" ? "pending" : null, capped]
      );
      return fallback.rows.map((row) => ({
        id: row.id ?? null,
        recipient_email: row.recipient_email ?? null,
        nickname: null,
        note: row.note ?? null,
        status: row.status ?? null,
        created_at: row.created_at ?? null,
        expires_at: row.expires_at ?? null,
        consumed_at: row.consumed_at ?? null,
      }));
    }
  } finally {
    client.release();
  }
}
