// src/core/features/profile/service.ts
import { getPool } from "@/core/db/db";
import type { FullProfile, UserProfile, UserSettings, DensityMode } from "./types";

const pool = () => getPool();

async function getCurrentUserId(): Promise<string | null> {
  // TODO: plug your auth system
  return null;
}

export async function getFullProfile(): Promise<FullProfile | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const client = pool();

  const profileQ = await client.query<UserProfile>(
    `
    SELECT
      user_id    AS "userId",
      email      AS "email",
      display_name AS "displayName",
      created_at AS "createdAt",
      invited_by AS "invitedBy",
      invite_source AS "inviteSource",
      locale     AS "locale",
      timezone   AS "timezone"
    FROM profile.user_profile
    WHERE user_id = $1::uuid
    `,
    [userId]
  );

  if (!profileQ.rowCount) return null;

  const settingsQ = await client.query<UserSettings>(
    `
    SELECT
      user_id AS "userId",
      density_mode AS "densityMode",
      is_advanced  AS "isAdvanced",
      theme,
      default_matrix_window AS "defaultMatrixWindow",
      favorite_symbols      AS "favoriteSymbols",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM profile.user_settings
    WHERE user_id = $1::uuid
    `,
    [userId]
  );

  let settings: UserSettings;
  if (!settingsQ.rowCount) {
    // lazy-init default settings
    const insertQ = await client.query<UserSettings>(
      `
      INSERT INTO profile.user_settings (user_id)
      VALUES ($1::uuid)
      RETURNING
        user_id AS "userId",
        density_mode AS "densityMode",
        is_advanced  AS "isAdvanced",
        theme,
        default_matrix_window AS "defaultMatrixWindow",
        favorite_symbols      AS "favoriteSymbols",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [userId]
    );
    settings = insertQ.rows[0];
  } else {
    settings = settingsQ.rows[0];
  }

  return {
    profile: profileQ.rows[0],
    settings,
  };
}

export async function updateUserSettings(input: {
  densityMode?: DensityMode;
  isAdvanced?: boolean;
  theme?: string;
  defaultMatrixWindow?: string;
  favoriteSymbols?: string[];
}): Promise<UserSettings> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const { densityMode, isAdvanced, theme, defaultMatrixWindow, favoriteSymbols } =
    input;

  const client = pool();

  const q = await client.query<UserSettings>(
    `
    UPDATE profile.user_settings
    SET
      density_mode = COALESCE($2::text, density_mode),
      is_advanced  = COALESCE($3::boolean, is_advanced),
      theme        = COALESCE($4::text, theme),
      default_matrix_window = COALESCE($5::text, default_matrix_window),
      favorite_symbols      = COALESCE($6::text[], favorite_symbols),
      updated_at = now()
    WHERE user_id = $1::uuid
    RETURNING
      user_id AS "userId",
      density_mode AS "densityMode",
      is_advanced  AS "isAdvanced",
      theme,
      default_matrix_window AS "defaultMatrixWindow",
      favorite_symbols      AS "favoriteSymbols",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    `,
    [
      userId,
      densityMode ?? null,
      typeof isAdvanced === "boolean" ? isAdvanced : null,
      theme ?? null,
      defaultMatrixWindow ?? null,
      favoriteSymbols ?? null,
    ]
  );

  if (!q.rowCount) {
    throw new Error("Settings row not found");
  }
  return q.rows[0];
}
