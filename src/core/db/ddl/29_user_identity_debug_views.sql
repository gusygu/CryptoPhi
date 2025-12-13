-- 29_user_identity_debug_views.sql
-- Debug/inspection views around auth/profile/invites for per-user diagnostics.

BEGIN;

-- List users with profile/settings and invite metadata
CREATE OR REPLACE VIEW profile.v_user_identity_debug AS
SELECT
  u.user_id,
  u.email,
  u.nickname,
  u.is_admin,
  u.status,
  up.display_name,
  up.invited_by,
  up.invite_source,
  up.locale,
  up.timezone,
  us.density_mode,
  us.theme,
  us.is_advanced,
  us.default_matrix_window,
  us.favorite_symbols,
  u.created_at,
  u.last_login_at
FROM auth."user" u
LEFT JOIN profile.user_profile  up ON up.user_id = u.user_id
LEFT JOIN profile.user_settings us ON us.user_id = u.user_id;

COMMIT;
