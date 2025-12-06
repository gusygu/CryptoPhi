// src/core/features/snapshot/service.ts
import { getPool } from "@/core/db/db";
import { getSettingsWithVersion } from "@/app/(server)/settings/gateway";

const pool = () => getPool();

export interface SnapshotRecord {
  snapshot_id: string;
  snapshot_stamp: string;
  label: string;
  created_by_email: string | null;
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
      app_version      text,
      scope            text[] NOT NULL DEFAULT ARRAY[
        'settings','market','wallet','matrices','str_aux','cin_aux','mea_dynamics','ops'
      ],
      notes            text,
      client_context   jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at       timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool().query(`
    CREATE INDEX IF NOT EXISTS idx_snapshot_registry_stamp
      ON snapshot.snapshot_registry (snapshot_stamp DESC)
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
  limit = 50
): Promise<SnapshotRecord[]> {
  await ensureSnapshotRegistry();
  const normalizedEmail = canonicalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("email_required");
  }
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
    WHERE LOWER(created_by_email) = $2::text
    ORDER BY snapshot_stamp DESC
    LIMIT $1::int
    `,
    [limit, normalizedEmail]
  );
  return q.rows;
}

export async function createSnapshot(input: {
  label?: string;
  createdByEmail: string | null;
  appVersion?: string | null;
  scopeOverride?: string[] | null;
}): Promise<SnapshotRecord> {
  await ensureSnapshotRegistry();
  const normalizedEmail = canonicalizeEmail(input.createdByEmail);
  const normalizedLabel =
    sanitizeLabel(input.label) ??
    `snapshot @ ${new Date().toISOString().replace("T", " ").slice(0, 19)}`;
  const normalizedVersion = sanitizeAppVersion(input.appVersion ?? null);
  const normalizedScope = normalizeSnapshotScope(input.scopeOverride ?? null);

  if (!normalizedEmail) {
    throw new Error("email_required");
  }

  let clientContext: any = {};
  try {
    const { settings, version } = await getSettingsWithVersion();
    clientContext.settings = settings;
    clientContext.settingsVersion = version;
  } catch {
    // snapshot still useful even without settings metadata
  }

  const q = await pool().query<SnapshotRecord>(
    `
    INSERT INTO snapshot.snapshot_registry (
      snapshot_stamp,
      label,
      created_by_email,
      app_version,
      scope,
      notes,
      client_context
    )
    VALUES (
      now(),
      $1::text,
      $2::text,
      $3::text,
      COALESCE($4::text[], $5::text[]),
      NULL,
      $6::jsonb
    )
    RETURNING *
    `,
    [
      normalizedLabel,
      normalizedEmail,
      normalizedVersion,
      normalizedScope,
      SNAPSHOT_SCOPE_DEFAULT,
      clientContext,
    ]
  );

  return q.rows[0];
}

export async function createSnapshotForUser(input: {
  email: string;
  label?: string;
  appVersion?: string | null;
  scopeOverride?: string[] | null;
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
  });
}
