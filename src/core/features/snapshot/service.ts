// src/core/features/snapshot/service.ts
import { getPool, stampSnapshotForSession } from "@/core/db/db";
import { getSettingsWithVersion } from "@/app/(server)/settings/gateway";

const pool = () => getPool();

export interface SnapshotRecord {
  snapshot_id: string;
  snapshot_stamp: string;
  label: string;
  created_by_email: string | null;
  app_session_id?: string | null;
  app_user_id?: string | null;
  app_version: string | null;
  scope: string[];
  notes: string | null;
  client_context: any;
  created_at: string;
}

export const SNAPSHOT_SCOPE_DEFAULT = [
  "settings",
  "market",
  "wallet",
  "matrices",
  "str_aux",
  "cin_aux",
  "mea_dynamics",
  "ops",
] as const;

export type SnapshotScope = (typeof SNAPSHOT_SCOPE_DEFAULT)[number];

const SNAPSHOT_SCOPE_SET = new Set<string>(SNAPSHOT_SCOPE_DEFAULT);
const SNAPSHOT_LABEL_MAX = 160;
const SNAPSHOT_VERSION_MAX = 64;

const canonicalizeEmail = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

export function normalizeSnapshotScope(raw: unknown): SnapshotScope[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SnapshotScope[] = [];
  const seen = new Set<string>();
  for (const token of raw) {
    if (typeof token !== "string") continue;
    const normalized = token.trim().toLowerCase();
    if (!normalized || !SNAPSHOT_SCOPE_SET.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized as SnapshotScope);
  }
  return out.length ? out : null;
}

const sanitizeLabel = (value?: string | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, SNAPSHOT_LABEL_MAX);
};

const sanitizeAppVersion = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, SNAPSHOT_VERSION_MAX) : null;
};

const sanitizeText = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sanitizeUuid = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return UUID_RE.test(trimmed) ? trimmed : null;
};

let registryEnsured = false;
async function ensureSnapshotRegistry(): Promise<void> {
  if (registryEnsured) return;

  await pool().query(`CREATE SCHEMA IF NOT EXISTS snapshot`);
  await pool().query(`
    CREATE TABLE IF NOT EXISTS snapshot.snapshot_registry (
      snapshot_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_stamp   timestamptz NOT NULL UNIQUE,
      label            text NOT NULL,
      created_by_email text,
      app_session_id   text,
      app_user_id      uuid,
      app_version      text,
      scope            text[] NOT NULL DEFAULT ARRAY[
        'settings','market','wallet','matrices','str_aux','cin_aux','mea_dynamics','ops'
      ],
      notes            text,
      client_context   jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at       timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool().query(
    `ALTER TABLE snapshot.snapshot_registry
       ADD COLUMN IF NOT EXISTS app_session_id text,
       ADD COLUMN IF NOT EXISTS app_user_id uuid`
  );
  await pool().query(`
    CREATE INDEX IF NOT EXISTS idx_snapshot_registry_stamp
      ON snapshot.snapshot_registry (snapshot_stamp DESC)
  `);
  await pool().query(`
    CREATE INDEX IF NOT EXISTS idx_snapshot_registry_app_session
      ON snapshot.snapshot_registry (app_session_id, snapshot_stamp DESC)
  `);
  await pool().query(`
    CREATE INDEX IF NOT EXISTS idx_snapshot_registry_app_user
      ON snapshot.snapshot_registry (app_user_id, snapshot_stamp DESC)
  `);
  registryEnsured = true;
}

export async function listSnapshots(limit = 50): Promise<SnapshotRecord[]> {
  await ensureSnapshotRegistry();
  const q = await pool().query<SnapshotRecord>(
    `
    SELECT
      snapshot_id,
      snapshot_stamp,
      label,
      created_by_email,
      app_version,
      scope,
      notes,
      client_context,
      created_at
    FROM snapshot.snapshot_registry
    ORDER BY snapshot_stamp DESC
    LIMIT $1::int
    `,
    [limit]
  );
  return q.rows;
}

export async function listSnapshotsForUser(
  email: string,
  limit = 50,
  appSessionId?: string | null
): Promise<SnapshotRecord[]> {
  await ensureSnapshotRegistry();
  const normalizedEmail = canonicalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("email_required");
  }
  const hasSession = !!(appSessionId && appSessionId.trim());
  const q = await pool().query<SnapshotRecord>(
    `
    SELECT
      snapshot_id,
      snapshot_stamp,
      label,
      created_by_email,
      app_session_id,
      app_user_id,
      app_version,
      scope,
      notes,
      client_context,
      created_at
    FROM snapshot.snapshot_registry
    WHERE LOWER(created_by_email) = $2::text
      AND ($3::text IS NULL OR app_session_id = $3::text)
    ORDER BY snapshot_stamp DESC
    LIMIT $1::int
    `,
    [limit, normalizedEmail, hasSession ? appSessionId : null]
  );
  return q.rows;
}

export async function createSnapshot(input: {
  label?: string;
  createdByEmail: string | null;
  appVersion?: string | null;
  scopeOverride?: string[] | null;
  appSessionId?: string | null;
  appUserId?: string | null;
}): Promise<SnapshotRecord> {
  await ensureSnapshotRegistry();
  const normalizedEmail = canonicalizeEmail(input.createdByEmail);
  const normalizedLabel =
    sanitizeLabel(input.label) ??
    `snapshot @ ${new Date().toISOString().replace("T", " ").slice(0, 19)}`;
  const normalizedVersion = sanitizeAppVersion(input.appVersion ?? null);
  const normalizedScope = normalizeSnapshotScope(input.scopeOverride ?? null);
  const normalizedSessionId = sanitizeText(input.appSessionId ?? null);
  const normalizedUserId = sanitizeUuid(input.appUserId ?? null);

  if (!normalizedEmail) {
    throw new Error("email_required");
  }

  let clientContext: any = {};
  let ctxAppSessionId: string | null = null;
  try {
    const { settings, version } = await getSettingsWithVersion();
    clientContext.settings = settings;
    clientContext.settingsVersion = version;
    if (input.appSessionId) clientContext.app_session_id = input.appSessionId;
    if (input.appUserId) clientContext.app_user_id = input.appUserId;
  } catch {
    // snapshot still useful even without settings metadata
  }

  try {
    const { rows } = await pool().query<{
      app_session_id: string | null;
      app_user_id: string | null;
    }>(
      `
      select
        nullif(current_setting('app.current_session_id', true), '') as app_session_id,
        nullif(current_setting('app.current_user_id', true), '') as app_user_id
    `,
    );
    const ctxRow = rows?.[0];
    if (!clientContext.app_session_id && ctxRow?.app_session_id)
      clientContext.app_session_id = ctxRow.app_session_id;
    if (!clientContext.app_user_id && ctxRow?.app_user_id)
      clientContext.app_user_id = ctxRow.app_user_id;
    ctxAppSessionId = ctxRow?.app_session_id ?? null;
  } catch {
    // snapshot still useful even without settings metadata
  }

  const q = await pool().query<SnapshotRecord>(
    `
    INSERT INTO snapshot.snapshot_registry (
      snapshot_stamp,
      label,
      created_by_email,
      app_session_id,
      app_user_id,
      app_version,
      scope,
      notes,
      client_context
    )
    VALUES (
      now(),
      $1::text,
      $2::text,
      nullif($3::text, '')::text,
      nullif($4::uuid, '00000000-0000-0000-0000-000000000000')::uuid,
      $5::text,
      COALESCE($6::text[], $7::text[]),
      NULL,
      $8::jsonb
    )
    RETURNING *
    `,
    [
      normalizedLabel,
      normalizedEmail,
      normalizedSessionId,
      normalizedUserId,
      normalizedVersion,
      normalizedScope,
      SNAPSHOT_SCOPE_DEFAULT,
      clientContext,
    ]
  );

  const snapshot = q.rows[0];

  // Best-effort: mark matrices benchmark slice with the snapshot stamp so downstream meta carries it.
  try {
    const stampMs = Date.parse(snapshot.snapshot_stamp);
    const sessionForStamp =
      normalizedSessionId ?? clientContext?.app_session_id ?? ctxAppSessionId ?? "global";
    if (Number.isFinite(stampMs)) {
      await stampSnapshotForSession(sessionForStamp, stampMs);
    }
  } catch {
    /* non-critical; snapshot still returned */
  }

  return snapshot;
}

export async function createSnapshotForUser(input: {
  email: string;
  label?: string;
  appVersion?: string | null;
  scopeOverride?: string[] | null;
  appSessionId?: string | null;
  appUserId?: string | null;
}): Promise<SnapshotRecord> {
  const normalizedEmail = canonicalizeEmail(input.email);
  if (!normalizedEmail) {
    throw new Error("email_required");
  }
  return createSnapshot({
    label: input.label,
    createdByEmail: normalizedEmail,
    appVersion: input.appVersion ?? null,
    scopeOverride: input.scopeOverride ?? null,
    appSessionId: input.appSessionId ?? null,
    appUserId: input.appUserId ?? null,
  });
}
