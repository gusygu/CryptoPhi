-- 27_user_profile_views.sql
-- Per-user profile views combining auth + profile tables.

BEGIN;

CREATE SCHEMA IF NOT EXISTS profile;

-- Full profile view: auth.user + profile.user_profile + profile.user_settings
CREATE OR REPLACE VIEW profile.v_user_full_profile AS
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
  us.is_advanced,
  us.theme,
  us.default_matrix_window,
  us.favorite_symbols,
  us.updated_at AS settings_updated_at
FROM auth."user" u
LEFT JOIN profile.user_profile  up ON up.user_id = u.user_id
LEFT JOIN profile.user_settings us ON us.user_id = u.user_id;

COMMIT;
