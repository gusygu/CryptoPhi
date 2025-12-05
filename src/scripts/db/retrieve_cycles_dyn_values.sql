-- Retrieve benchmark/id_pct/pct_ref for opening + next 3 cycles.
-- Two modes:
--   A) Session-aware: set app.current_session_id before running to target a session.
--   B) Session-agnostic: defaults to the latest opening across all sessions.

-- ===================== Session-aware (uses app.current_session_id) =====================
-- Uncomment the next line and set your session if needed:
-- SELECT set_config('app.current_session_id', '<your-session-id>', true);

WITH vars AS (
  SELECT COALESCE(NULLIF(current_setting('app.current_session_id', true), ''), 'global')::text AS app_session_id
),
opening AS (
  SELECT ts_ms
  FROM matrices.dyn_values
  WHERE matrix_type = 'benchmark'
    AND opening_stamp = TRUE
    AND COALESCE(meta->>'app_session_id','global') = (SELECT app_session_id FROM vars)
  ORDER BY COALESCE(opening_ts, to_timestamp(ts_ms/1000.0)) DESC, ts_ms DESC
  LIMIT 1
),
cycles AS (
  SELECT DISTINCT dv.ts_ms
  FROM matrices.dyn_values dv
  JOIN opening o ON dv.ts_ms >= o.ts_ms
  WHERE COALESCE(dv.meta->>'app_session_id','global') = (SELECT app_session_id FROM vars)
  ORDER BY dv.ts_ms ASC
  LIMIT 4  -- opening + cycles 1-3
)
SELECT
  ROW_NUMBER() OVER (ORDER BY c.ts_ms) - 1 AS relative_cycle,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY c.ts_ms) = 1 THEN 'opening'
       ELSE 'cycle_' || (ROW_NUMBER() OVER (ORDER BY c.ts_ms) - 1)::text END AS label,
  dv.matrix_type,
  dv.base,
  dv.quote,
  dv.value,
  dv.ts_ms,
  to_timestamp(dv.ts_ms/1000.0) AS ts_utc,
  dv.meta,
  dv.opening_stamp,
  dv.opening_ts,
  dv.snapshot_stamp,
  dv.snapshot_ts,
  COALESCE(dv.meta->>'app_session_id','global') AS app_session_id
FROM cycles c
JOIN matrices.dyn_values dv
  ON dv.ts_ms = c.ts_ms
 AND dv.matrix_type IN ('benchmark','id_pct','pct_ref')
WHERE COALESCE(dv.meta->>'app_session_id','global') = (SELECT app_session_id FROM vars)
ORDER BY relative_cycle, dv.matrix_type, dv.base, dv.quote;


-- ===================== Session-agnostic (latest opening across all sessions) =====================
WITH opening AS (
  SELECT ts_ms
  FROM matrices.dyn_values
  WHERE matrix_type = 'benchmark'
    AND opening_stamp = TRUE
  ORDER BY COALESCE(opening_ts, to_timestamp(ts_ms/1000.0)) DESC, ts_ms DESC
  LIMIT 1
),
cycles AS (
  SELECT DISTINCT dv.ts_ms
  FROM matrices.dyn_values dv
  JOIN opening o ON dv.ts_ms >= o.ts_ms
  ORDER BY dv.ts_ms ASC
  LIMIT 4  -- opening + cycles 1-3
)
SELECT
  ROW_NUMBER() OVER (ORDER BY c.ts_ms) - 1 AS relative_cycle,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY c.ts_ms) = 1 THEN 'opening'
       ELSE 'cycle_' || (ROW_NUMBER() OVER (ORDER BY c.ts_ms) - 1)::text END AS label,
  dv.matrix_type,
  dv.base,
  dv.quote,
  dv.value,
  dv.ts_ms,
  to_timestamp(dv.ts_ms/1000.0) AS ts_utc,
  dv.meta,
  dv.opening_stamp,
  dv.opening_ts,
  dv.snapshot_stamp,
  dv.snapshot_ts,
  COALESCE(dv.meta->>'app_session_id','global') AS app_session_id
FROM cycles c
JOIN matrices.dyn_values dv
  ON dv.ts_ms = c.ts_ms
 AND dv.matrix_type IN ('benchmark','id_pct','pct_ref')
ORDER BY relative_cycle, dv.matrix_type, dv.base, dv.quote;
