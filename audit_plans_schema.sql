-- ============================================================
-- YAH PLANS TABLE — SCHEMA AUDIT
-- ============================================================
-- Purpose: Detect schema drift in the `plans` table by comparing
-- the actual schema against what the YAH code expects.
--
-- Run this in Supabase SQL Editor. The output is structured into
-- three sections so you can scan quickly:
--
--   SECTION 1 — Full schema dump (raw column inventory)
--   SECTION 2 — Drift flags (columns code expects vs. has)
--   SECTION 3 — Suspicious patterns (legacy/new pairs, NOT NULL on optional)
--
-- If SECTION 2 and 3 both come back clean, no migration needed.
-- If anything flags, share the output and we'll write a targeted migration.
--
-- Last updated: covers code through the PDF vision build.

-- ----------------------------------------------------------------
-- SECTION 1 — Full schema dump
-- ----------------------------------------------------------------

SELECT
  '--- SECTION 1: Full schema dump ---' AS section;

SELECT
  ordinal_position AS pos,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'plans'
  AND table_schema = 'public'
ORDER BY ordinal_position;


-- ----------------------------------------------------------------
-- SECTION 2 — Drift flags
-- ----------------------------------------------------------------
-- Compares actual columns against what the YAH code expects.

SELECT
  '--- SECTION 2: Drift flags (vs. code expectations) ---' AS section;

WITH expected_columns AS (
  SELECT unnest(ARRAY[
    'id',
    'client_id',
    'week_of',
    'planning_note',
    'status',
    'created_at',
    'updated_at'
  ]) AS column_name
),
actual_columns AS (
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'plans'
    AND table_schema = 'public'
)
SELECT
  CASE
    WHEN e.column_name IS NULL THEN 'EXTRA (in DB, not in code)'
    WHEN a.column_name IS NULL THEN 'MISSING (code expects, not in DB)'
    ELSE 'OK'
  END AS status,
  COALESCE(e.column_name, a.column_name) AS column_name
FROM expected_columns e
FULL OUTER JOIN actual_columns a USING (column_name)
ORDER BY status, column_name;


-- ----------------------------------------------------------------
-- SECTION 3 — Suspicious patterns
-- ----------------------------------------------------------------
-- Looks for common drift signals:
--   - Pairs of columns that look like legacy + new naming
--     (e.g., "post_title" alongside "title")
--   - NOT NULL constraints on columns that should be nullable
--   - Multiple status / timestamp / label columns coexisting

SELECT
  '--- SECTION 3: Suspicious patterns ---' AS section;

-- 3a: Pairs of similarly-named columns (potential legacy duplicates)
WITH cols AS (
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'plans' AND table_schema = 'public'
)
SELECT
  'POTENTIAL LEGACY PAIR' AS flag,
  c1.column_name AS column_a,
  c2.column_name AS column_b
FROM cols c1
JOIN cols c2 ON
  c1.column_name < c2.column_name
  AND (
    -- Common legacy/new pairs we cleaned up in plan_days
    (c1.column_name = 'title' AND c2.column_name = 'plan_title')
    OR (c1.column_name = 'plan_title' AND c2.column_name = 'title')
    OR (c1.column_name = 'label' AND c2.column_name = 'week_of')
    OR (c1.column_name = 'week_of' AND c2.column_name = 'plan_label')
    OR (c1.column_name = 'note' AND c2.column_name = 'planning_note')
    OR (c1.column_name = 'planning_note' AND c2.column_name = 'notes')
    -- Generic similarity: one contains the other
    OR (c1.column_name LIKE '%' || c2.column_name || '%' AND c1.column_name != c2.column_name)
    OR (c2.column_name LIKE '%' || c1.column_name || '%' AND c1.column_name != c2.column_name)
  );

-- 3b: NOT NULL constraints on columns that the code treats as optional
SELECT
  'NOT NULL ON OPTIONAL FIELD' AS flag,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'plans'
  AND table_schema = 'public'
  AND is_nullable = 'NO'
  AND column_default IS NULL
  AND column_name NOT IN ('id', 'client_id', 'created_at');
  -- ^ id, client_id, created_at are legitimately NOT NULL


-- ----------------------------------------------------------------
-- DONE
-- ----------------------------------------------------------------
-- If SECTION 2 returns only 'OK' rows AND SECTION 3 is empty,
-- the plans table is clean. No migration needed.
--
-- If anything else shows, paste the output back and we'll build
-- a cleanup migration like we did for plan_days.

SELECT '--- AUDIT COMPLETE ---' AS section;
