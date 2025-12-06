import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { sendInviteEmail } from "@/server/email/sendInviteEmail";
import { env } from "@/env";

type InviteTokenRow = {
  invite_id: string;
  email: string;
  status: string;
  expires_at: string | null;
  used_at: string | null;
  created_at: string;
  used_by_user_id: string | null;
};

type UserRow = {
  user_id: string;
  email: string;
  nickname: string | null;
  created_at: string;
};

const INVITE_TTL_DAYS = 14;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildInviteUrl(rawToken: string) {
  const base = (env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/auth/invite/${encodeURIComponent(rawToken)}`;
}

function mapInvite(row: InviteTokenRow | null) {
  if (!row) return null;
  const consumed = row.status !== "issued" || row.used_at !== null;
  const uses = row.used_at ? 1 : 0;
  return {
    email: row.email,
    createdAt: row.created_at,
    uses,
    maxUses: 1,
    consumed,
  };
}

async function findInvitedUser(invite: InviteTokenRow | null): Promise<UserRow | null> {
  if (!invite) return null;
  // Prefer explicit linkage when invite was consumed
  if (invite.used_by_user_id) {
    const q = await db.query<UserRow>(
      `
        SELECT user_id, email, nickname, created_at
          FROM auth."user"
         WHERE user_id = $1
         LIMIT 1
      `,
      [invite.used_by_user_id]
    );
    return q.rows[0] ?? null;
  }

  // Fallback: if someone already registered with the target email
  const q = await db.query<UserRow>(
    `
      SELECT user_id, email, nickname, created_at
        FROM auth."user"
       WHERE lower(email) = lower($1)
       ORDER BY created_at DESC
       LIMIT 1
    `,
    [invite.email]
  );
  return q.rows[0] ?? null;
}

/**
 * GET /api/user-invite
 * Returns the existing invite (if any) and invited user (if already registered).
 */
export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rows } = await db.query<InviteTokenRow>(
    `
      SELECT invite_id, email, status, expires_at, used_at, created_at, used_by_user_id
        FROM auth.invite_token
       WHERE created_by_user_id = $1
       ORDER BY created_at DESC
       LIMIT 1
    `,
    [user.user_id]
  );

  const invite = rows[0] ?? null;
  const invitedUser = await findInvitedUser(invite);

  return NextResponse.json({
    invite: mapInvite(invite),
    invitedUser: invitedUser
      ? {
          id: invitedUser.user_id,
          email: invitedUser.email,
          name: invitedUser.nickname,
          createdAt: invitedUser.created_at,
        }
      : null,
  });
}

/**
 * POST /api/user-invite
 * Body: { email: string }
 * Creates a one-shot invite and sends transactional email.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const email = body?.email ? normalizeEmail(String(body.email)) : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Enforce "one personal invite" rule
  const { rows: existingRows } = await db.query(
    `
      SELECT 1
        FROM auth.invite_token
       WHERE created_by_user_id = $1
       LIMIT 1
    `,
    [user.user_id]
  );

  if (existingRows.length > 0) {
    return NextResponse.json(
      { error: "You already used your invite." },
      { status: 400 }
    );
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { rows: inserted } = await db.query<InviteTokenRow>(
    `
      INSERT INTO auth.invite_token (
        email,
        token,
        status,
        expires_at,
        created_by_user_id
      )
      VALUES ($1, $2, 'issued', $3, $4)
      RETURNING invite_id, email, status, expires_at, used_at, created_at, used_by_user_id
    `,
    [email, tokenHash, expiresAt, user.user_id]
  );

  const inviteRow = inserted[0];
  const inviteUrl = buildInviteUrl(rawToken);

  await sendInviteEmail({
    to: email,
    inviterName: user.nickname ?? user.email,
    inviteUrl,
  });

  return NextResponse.json({
    ok: true,
    invite: mapInvite(inviteRow),
  });
}
