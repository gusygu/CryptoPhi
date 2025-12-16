-- 999_invites_compat.sql
-- Purpose: compatibility layer so code can rely on:
--   admin.invites(id, recipient_email, status, note, nickname, created_at, expires_at, consumed_at, created_by, invite_token_uuid, invite_token_hash)
-- without destructively changing whatever legacy schema exists.

BEGIN;

-- Ensure schema exists
CREATE SCHEMA IF NOT EXISTS admin;

-- Detect whether admin.invites exists; if not, try to bind to public.invites (or invites)
DO $$
DECLARE
  has_admin boolean;
  has_public boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='admin' AND table_name='invites'
  ) INTO has_admin;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema IN ('public') AND table_name='invites'
  ) INTO has_public;

  IF NOT has_admin AND has_public THEN
    -- Create admin.invites as a VIEW pointing to public.invites
    EXECUTE 'CREATE VIEW admin.invites AS SELECT * FROM public.invites';
  ELSIF NOT has_admin AND NOT has_public THEN
    -- Last resort: create a minimal real table that matches code expectations
    EXECUTE $ct$
      CREATE TABLE admin.invites (
        id uuid PRIMARY KEY,
        recipient_email text NOT NULL,
        nickname text,
        note text,
        status text NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz,
        consumed_at timestamptz,
        created_by uuid,
        invite_token_uuid uuid,
        invite_token_hash text
      )
    $ct$;
  END IF;
END$$;

-- At this point admin.invites exists either as table or view.
-- Now create a stable compat VIEW that guarantees the columns the app expects.
-- We'll introspect underlying columns via COALESCE patterns.
DROP VIEW IF EXISTS admin.v_invites_compat CASCADE;

CREATE VIEW admin.v_invites_compat AS
SELECT
  -- id
  COALESCE(
    NULLIF((to_jsonb(i)->>'id')::text, '')::uuid,
    NULLIF((to_jsonb(i)->>'invite_id')::text, '')::uuid,
    NULLIF((to_jsonb(i)->>'invite_uuid')::text, '')::uuid
  ) AS id,

  -- recipient_email
  COALESCE(
    to_jsonb(i)->>'recipient_email',
    to_jsonb(i)->>'email',
    to_jsonb(i)->>'recipient',
    to_jsonb(i)->>'to_email'
  ) AS recipient_email,

  -- nickname (optional)
  COALESCE(
    to_jsonb(i)->>'nickname',
    to_jsonb(i)->>'recipient_nickname'
  ) AS nickname,

  -- note (optional)
  COALESCE(
    to_jsonb(i)->>'note',
    to_jsonb(i)->>'message'
  ) AS note,

  -- status
  COALESCE(
    to_jsonb(i)->>'status',
    CASE WHEN (to_jsonb(i)->>'consumed_at') IS NOT NULL THEN 'consumed' ELSE 'pending' END
  ) AS status,

  -- timestamps / metadata
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

COMMIT;

