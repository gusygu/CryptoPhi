BEGIN;

CREATE SCHEMA IF NOT EXISTS admin;

-- 1) Managers list (mgmt users)
CREATE TABLE IF NOT EXISTS admin.managers (
  manager_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,         -- login/identity email
  display_name      text,
  signature_email   text NOT NULL,                -- email used as "from / signature"
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','blocked','archived')),

  created_by_email  text,                         -- admin who promoted them
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_managers_status
  ON admin.managers (status);

-- 2) Core invites (admin + managers share this)
CREATE TABLE IF NOT EXISTS admin.invites (
  invite_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who is being invited
  target_email      text NOT NULL,

  -- Who created / owns the invite
  created_by_role   text NOT NULL
                    CHECK (created_by_role IN ('admin','manager','system')),
  created_by_email  text,
  manager_id        uuid
                    REFERENCES admin.managers(manager_id)
                    ON DELETE SET NULL,           -- when created by a manager

  -- Status
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','revoked','expired')),
  token             uuid NOT NULL UNIQUE,         -- invitation token
  week_slot         text NOT NULL DEFAULT to_char(date_trunc('week', now() AT TIME ZONE 'UTC'), 'IYYY-IW'),
  expires_at        timestamptz,
  accepted_at       timestamptz,
  revoked_at        timestamptz,

  -- Link to comms.history if it was actually mailed
  last_mail_id      uuid,                         -- comms.mail_queue.mail_id (ledger link)

  notes             text,
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_invites_email
  ON admin.invites (lower(target_email));

CREATE INDEX IF NOT EXISTS idx_admin_invites_status
  ON admin.invites (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_invites_manager
  ON admin.invites (manager_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_invites_manager_email
  ON admin.invites (manager_id, lower(target_email));

CREATE INDEX IF NOT EXISTS idx_admin_invites_week_slot
  ON admin.invites (created_by_role, lower(created_by_email), week_slot);

-- 3) Community list: users invited by managers (or admins)
CREATE TABLE IF NOT EXISTS admin.community_members (
  member_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,
  display_name      text,

  -- How they came in
  invite_id         uuid,                        -- admin.invites.invite_id
  manager_id        uuid
                    REFERENCES admin.managers(manager_id)
                    ON DELETE SET NULL,          -- owner/manager for mgmt view
  source            text,                        -- 'admin-invite' | 'manager-invite' | 'import' | etc.
  personal_id       text,                        -- optional govt/customer reference
  legal_name        text,                        -- stored registration name
  registered_at     timestamptz NOT NULL DEFAULT now(),

  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz,
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_admin_community_manager
  ON admin.community_members (manager_id, joined_at DESC);

-- 4) Admin actions ledger (full ledger of admin/mgmt actions)
--    This is where we write:
--    - invite generated for admin inbox mailing
--    - transactional mailing invites
--    - notifications/updates/alerts sends
--    - mgmt administration changes
--    - any legacy / existing "admin actions" you already log
CREATE TABLE IF NOT EXISTS admin.actions_ledger (
  action_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Taxonomy
  action_kind       text NOT NULL,               -- e.g. 'invite.create', 'invite.send', 'mail.send', 'manager.promote'
  action_scope      text,                        -- e.g. 'admin', 'manager', 'community', 'system'

  -- Actor
  actor_role        text,                        -- 'admin', 'manager', 'system'
  actor_email       text,
  manager_id        uuid,                        -- if actor is a manager

  -- Main "target" handles
  target_email      text,                        -- usually invitee / community member
  invite_id         uuid,                        -- admin.invites.invite_id
  member_id         uuid,                        -- admin.community_members.member_id
  mail_id           uuid,                        -- comms.mail_queue.mail_id (what was actually sent)
  snapshot_id       uuid,                        -- snapshot.snapshot_id (when tied to a snapshot action)

  -- Free-form details
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes             text,

  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 5) Registration ledger for regulatory data requirements
CREATE TABLE IF NOT EXISTS admin.invite_registration_registry (
  registration_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id           uuid NOT NULL REFERENCES admin.invites(invite_id) ON DELETE CASCADE,
  manager_id          uuid REFERENCES admin.managers(manager_id) ON DELETE SET NULL,
  personal_id         text,
  full_name           text,
  email               text NOT NULL,
  registered_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_registration_invite
  ON admin.invite_registration_registry (invite_id);

CREATE INDEX IF NOT EXISTS idx_invite_registration_manager
  ON admin.invite_registration_registry (manager_id, registered_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_kind_created
  ON admin.actions_ledger (action_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_actor_created
  ON admin.actions_ledger (actor_role, lower(actor_email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_target_email
  ON admin.actions_ledger (lower(target_email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_manager
  ON admin.actions_ledger (manager_id, created_at DESC);

COMMIT;


-- 3x_admin_mgmt_community_status.sql
BEGIN;

ALTER TABLE admin.community_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','archived')),
  ADD COLUMN IF NOT EXISTS suspended_until timestamptz,
  ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason text,
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz;

CREATE INDEX IF NOT EXISTS admin_community_members_manager_status_idx
  ON admin.community_members (manager_id, status);

COMMIT;

-- 6) Helper to enforce 20-person limit per manager (invites + members)
BEGIN;

CREATE OR REPLACE FUNCTION admin.fn_enforce_manager_people_limit() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  limit_count int;
  target_manager uuid;
BEGIN
  target_manager := COALESCE(NEW.manager_id, OLD.manager_id);
  IF target_manager IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO limit_count
  FROM (
    SELECT lower(target_email) AS email_handle
    FROM admin.invites
    WHERE manager_id = target_manager
      AND status IN ('pending','accepted')
    UNION
    SELECT lower(email) AS email_handle
    FROM admin.community_members
    WHERE manager_id = target_manager
  ) AS combined_handles;

  IF limit_count >= 20 THEN
    RAISE EXCEPTION
      'manager % invite/community limit (20) exceeded',
      target_manager
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_invites_mgr_limit ON admin.invites;
CREATE TRIGGER trg_admin_invites_mgr_limit
  BEFORE INSERT ON admin.invites
  FOR EACH ROW
  WHEN (NEW.manager_id IS NOT NULL)
  EXECUTE FUNCTION admin.fn_enforce_manager_people_limit();

COMMIT;

DROP TRIGGER IF EXISTS trg_admin_members_mgr_limit ON admin.community_members;
CREATE TRIGGER trg_admin_members_mgr_limit
  BEFORE INSERT ON admin.community_members
  FOR EACH ROW
  WHEN (NEW.manager_id IS NOT NULL)
  EXECUTE FUNCTION admin.fn_enforce_manager_people_limit();


