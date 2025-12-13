BEGIN;

CREATE SCHEMA IF NOT EXISTS comms;

-- 1) Templates: transactional / invites / alerts
CREATE TABLE IF NOT EXISTS comms.mail_templates (
  template_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key     text NOT NULL UNIQUE,   -- e.g. 'admin_invite', 'manager_invite', 'ops_alert'
  lang             text NOT NULL DEFAULT 'en',
  subject          text NOT NULL,
  body_md          text NOT NULL,          -- markdown, rendered server-side
  description      text,
  is_active        boolean NOT NULL DEFAULT true,

  created_by_email text,
  updated_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 2) Files: any docs you want to attach to comms
CREATE TABLE IF NOT EXISTS comms.mail_files (
  file_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,          -- filename
  mime_type        text NOT NULL,
  storage_url      text,                   -- optional: S3 / public URL
  content          bytea,                  -- optional: store inline for small docs
  checksum_sha256  text,
  size_bytes       bigint,

  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mail_files_name
  ON comms.mail_files (name);

-- 3) Queue + history: this **is** the "mailing control ledger"
--    Every email to every person lives here, with status + sent_at.
DO $$
BEGIN
  CREATE TYPE comms.mail_status AS ENUM ('pending','sending','sent','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

CREATE TABLE IF NOT EXISTS comms.mail_queue (
  mail_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who
  to_email         text NOT NULL,
  cc_emails        text[],
  bcc_emails       text[],

  -- What (template + overrides)
  template_key     text,                   -- NULL => fully custom
  subject_override text,
  body_md_override text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Ledger bits
  status           comms.mail_status NOT NULL DEFAULT 'pending',
  scheduled_at     timestamptz,
  sent_at          timestamptz,
  last_error       text,

  -- “Who triggered this” for admin/mgmt wiring
  trigger_role     text,                   -- 'admin' | 'manager' | 'system'
  trigger_email    text,                   -- admin/manager email
  manager_id       uuid,                   -- optional: link to admin.managers later

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mail_queue_status_scheduled
  ON comms.mail_queue (status, scheduled_at NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_mail_queue_to_email
  ON comms.mail_queue (lower(to_email), created_at DESC);

-- 4) Attachments per mail row
CREATE TABLE IF NOT EXISTS comms.mail_queue_files (
  mail_id uuid NOT NULL REFERENCES comms.mail_queue(mail_id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES comms.mail_files(file_id) ON DELETE RESTRICT,
  position int NOT NULL DEFAULT 0,
  PRIMARY KEY (mail_id, file_id)
);

-- 5) Optional helper view: explicit “history”
CREATE OR REPLACE VIEW comms.v_mail_history AS
SELECT
  q.mail_id,
  q.to_email,
  q.cc_emails,
  q.bcc_emails,
  COALESCE(q.subject_override, t.subject) AS subject,
  q.template_key,
  q.status,
  q.scheduled_at,
  q.sent_at,
  q.last_error,
  q.trigger_role,
  q.trigger_email,
  q.manager_id,
  q.created_at,
  q.updated_at
FROM comms.mail_queue q
LEFT JOIN comms.mail_templates t
  ON q.template_key = t.template_key;

COMMIT;


INSERT INTO comms.mail_templates (
  template_key,
  lang,
  subject,
  body_md,
  description,
  is_active
)
VALUES (
  'admin_invite_default',
  'en',
  'You have been invited to CryptoPhi',
  $md$
Hi,

You have been invited to join CryptoPhi.

Click the link below to accept your invitation:

[Accept my invite]({{inviteUrl}})

---

Invited by **{{adminName}}**
$md$,
  'Admin invitation template (default).',
  true
)
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO comms.mail_templates (
  template_key,
  lang,
  subject,
  body_md,
  description,
  is_active
)
VALUES (
  'manager_invite',
  'en',
  'You have been invited to CryptoPhi',
  $md$
Hi,

You’ve been invited to join CryptoPhi.

Click the link below to accept your invitation:

{{inviteUrl}}

---

Invited by **{{managerName}}**
$md$,
  'Invitation email sent when a community manager invites a user.',
  true
)
ON CONFLICT (template_key) DO NOTHING;

