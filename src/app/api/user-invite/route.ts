import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
// Adjust these imports to your stack:
import { db } from "@/server/db"; // your DB client
import { getCurrentUser } from "@/server/auth/session";
import { sendInviteEmail } from "@/server/email/sendInviteEmail";
import { env } from "@/env";

type AdminInviteRow = {
  email: string;
  created_at: string;
  uses: number;
  max_uses: number;
};

type InvitedUserRow = {
  user_id: string;
  email: string;
  nickname: string | null;
  created_at: string;
};

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * GET /api/user-invite
 * Returns the existing invite (if any) and invited user (if already registered).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rows: inviteRows } = await db.query<AdminInviteRow>(
    `
      SELECT *
      FROM admin.invites
      WHERE inviter_user_id = $1
        AND source = 'user'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [user.user_id],
  );
  const invite = inviteRows[0] ?? null;

  let invitedUser: InvitedUserRow | null = null;
  if (invite) {
    const { rows: invitedRows } = await db.query<InvitedUserRow>(
      `
        SELECT user_id, email, nickname, created_at
        FROM auth."user"
        WHERE invited_by_user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [user.user_id],
    );
    invitedUser = invitedRows[0] ?? null;
  }

  return NextResponse.json({
    invite: invite
      ? {
          email: invite.email,
          createdAt: invite.created_at,
          uses: invite.uses,
          maxUses: invite.max_uses,
          consumed: invite.uses >= invite.max_uses,
        }
      : null,
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
  const email = (body.email as string | undefined)?.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Invalid email" },
      { status: 400 }
    );
  }

  // Check if user already has a user-generated invite
  const { rows: existingRows } = await db.query<AdminInviteRow>(
    `
      SELECT *
      FROM admin.invites
      WHERE inviter_user_id = $1
        AND source = 'user'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [user.user_id],
  );
  const existingInvite = existingRows[0] ?? null;

  if (existingInvite) {
    return NextResponse.json(
      { error: "You already used your invite." },
      { status: 400 }
    );
  }

  // Generate token: plain token is only shown & emailed; hash is persisted
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  // Persist new invite
  const createdAt = new Date();
  const { rows: newInviteRows } = await db.query<AdminInviteRow>(
    `
      INSERT INTO admin.invites (
        email,
        token_hash,
        inviter_user_id,
        source,
        max_uses,
        uses,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING email, created_at, uses, max_uses
    `,
    [email, tokenHash, user.user_id, "user", 1, 0, createdAt],
  );

  const baseUrl = env.BASE_URL ?? "https://your-domain.example";
  const inviteUrl = `${baseUrl}/auth/invite?token=${token}`;

  await sendInviteEmail({
    to: email,
      inviterName: user.nickname ?? user.email,
    inviteUrl,
  });

  return NextResponse.json({
    ok: true,
    invite: {
      email,
      inviteUrl, // for debugging / UI copy, optional
    },
  });
}
