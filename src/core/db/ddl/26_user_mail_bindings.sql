-- 26_user_mail_bindings.sql
-- User/mail glue: joins invites and audit triggers to comms.mail_queue.

BEGIN;

-- Basic view: latest mail per user (by recipient email)
CREATE OR REPLACE VIEW comms.v_user_mail_latest AS
SELECT DISTINCT ON (lower(q.to_email))
  lower(q.to_email)        AS to_email,
  q.mail_id,
  q.template_key,
  q.status,
  q.scheduled_at,
  q.sent_at,
  q.last_error,
  q.created_at,
  q.updated_at
FROM comms.mail_queue q
ORDER BY lower(q.to_email), q.sent_at DESC NULLS LAST, q.created_at DESC;

-- Helper: pending invites with mail linkage (by email)
CREATE OR REPLACE VIEW comms.v_pending_invites_with_mail AS
SELECT
  i.invite_id,
  i.email,
  i.status,
  i.created_at,
  i.expires_at,
  ml.mail_id,
  ml.status    AS mail_status,
  ml.sent_at   AS mail_sent_at
FROM auth.invite i
LEFT JOIN comms.v_user_mail_latest ml
  ON lower(i.email) = ml.to_email
WHERE i.status = 'active';

COMMIT;
