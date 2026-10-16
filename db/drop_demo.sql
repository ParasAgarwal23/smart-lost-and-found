-- Live DDL demonstration: CREATE, ALTER and DROP (college brief §5).
--
-- Run from the repository root (psql only; it uses psql meta-commands):
--   psql -X -h localhost -U postgres -d smart_lost_found -f db/drop_demo.sql
--
-- SAFETY: every object here is a TEMPORARY table, created and dropped with an
-- explicit pg_temp. prefix. Temporary tables live in this session's private
-- schema, are invisible to the application and to other sessions, cannot clash
-- with a project table, and disappear when psql disconnects. No project table
-- (public schema) is read for writing, altered or dropped, and CASCADE is never
-- used. The script is repeatable: it removes leftovers from an earlier run in
-- the same session first.
\set ON_ERROR_STOP on
\pset footer off

-- Repeatability: remove leftovers from a previous run in this same session
-- (child before parent, so no CASCADE is needed).
DROP TABLE IF EXISTS pg_temp.ddl_demo_item;
DROP TABLE IF EXISTS pg_temp.ddl_demo_owner;

-- Snapshot the real schema so the end of the script can prove it is untouched.
SELECT count(*) AS public_tables_before FROM pg_tables WHERE schemaname = 'public' \gset

\echo
\echo '=== A. CREATE a table, ALTER it, then ALTER TABLE ... DROP COLUMN ==='

-- A1. CREATE: a disposable table with a primary key and a NOT NULL column.
CREATE TEMPORARY TABLE ddl_demo_owner (
    owner_id   INT PRIMARY KEY,
    owner_name VARCHAR(50) NOT NULL
);

-- A2. ALTER TABLE ... ADD: add a column and a named CHECK constraint.
ALTER TABLE pg_temp.ddl_demo_owner ADD COLUMN nickname VARCHAR(30);
ALTER TABLE pg_temp.ddl_demo_owner
    ADD CONSTRAINT ddl_demo_owner_name_check CHECK (btrim(owner_name) <> '');

\echo 'Columns after CREATE + ALTER ... ADD COLUMN:'
SELECT attname AS column_name, format_type(atttypid, atttypmod) AS data_type
FROM pg_attribute
WHERE attrelid = 'pg_temp.ddl_demo_owner'::regclass AND attnum > 0 AND NOT attisdropped
ORDER BY attnum;

-- A3. ALTER TABLE ... DROP COLUMN: remove the column again.
ALTER TABLE pg_temp.ddl_demo_owner DROP COLUMN nickname;

\echo 'Columns after ALTER TABLE ... DROP COLUMN nickname:'
SELECT attname AS column_name, format_type(atttypid, atttypmod) AS data_type
FROM pg_attribute
WHERE attrelid = 'pg_temp.ddl_demo_owner'::regclass AND attnum > 0 AND NOT attisdropped
ORDER BY attnum;

-- Metadata check: the column no longer exists (attisdropped hides removed columns).
SELECT NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'pg_temp.ddl_demo_owner'::regclass
      AND attname = 'nickname' AND NOT attisdropped
) AS column_dropped \gset

\echo
\echo '=== B. DROP tables that are linked by a FOREIGN KEY ==='

-- B1. CREATE a child table whose foreign key depends on ddl_demo_owner.
CREATE TEMPORARY TABLE ddl_demo_item (
    item_id  INT PRIMARY KEY,
    owner_id INT NOT NULL,
    CONSTRAINT ddl_demo_item_owner_fk
        FOREIGN KEY (owner_id) REFERENCES pg_temp.ddl_demo_owner (owner_id)
);
INSERT INTO pg_temp.ddl_demo_owner (owner_id, owner_name) VALUES (1, 'Demo owner');
INSERT INTO pg_temp.ddl_demo_item (item_id, owner_id) VALUES (10, 1);

\echo 'The foreign key that creates the dependency:'
SELECT conname AS constraint_name, conrelid::regclass AS child_table,
       confrelid::regclass AS parent_table, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'ddl_demo_item_owner_fk';

-- B2. Wrong order on purpose: PostgreSQL refuses to drop a referenced table.
-- Error stopping is relaxed for this one statement only, so the expected
-- error (SQLSTATE 2BP01, dependent_objects_still_exist) is shown and recorded.
\echo 'Attempting DROP TABLE on the parent first (expected to fail):'
\set ON_ERROR_STOP off
DROP TABLE pg_temp.ddl_demo_owner;
\set drop_parent_sqlstate :SQLSTATE
\set ON_ERROR_STOP on

-- B3. Correct order: handle the constraint first, then drop the tables.
--     (Dropping the child table first would also work; removing the foreign key
--      shows the dependency being resolved explicitly.)
ALTER TABLE pg_temp.ddl_demo_item DROP CONSTRAINT ddl_demo_item_owner_fk;
DROP TABLE pg_temp.ddl_demo_owner;  -- succeeds now that nothing references it
DROP TABLE pg_temp.ddl_demo_item;

-- Metadata check: both disposable tables are gone.
SELECT to_regclass('pg_temp.ddl_demo_owner') IS NULL
   AND to_regclass('pg_temp.ddl_demo_item') IS NULL AS tables_dropped \gset

-- The real project schema is unchanged.
SELECT count(*) AS public_tables_after FROM pg_tables WHERE schemaname = 'public' \gset
SELECT :public_tables_before = :public_tables_after AS project_untouched \gset

\echo
\echo '=== Results ==='
SELECT :'column_dropped'::boolean AS "A: column dropped",
       :'drop_parent_sqlstate' = '2BP01' AS "B: parent drop blocked by FK (2BP01)",
       :'tables_dropped'::boolean AS "B: both tables dropped",
       :'project_untouched'::boolean AS "project tables unchanged";

SELECT :'drop_parent_sqlstate' = '2BP01' AS fk_blocked \gset
\if :column_dropped
\else
    \echo 'FAIL: the column was not dropped.'
    \quit 1
\endif
\if :fk_blocked
\else
    \echo 'FAIL: dropping the referenced table was not blocked by its foreign key.'
    \quit 1
\endif
\if :tables_dropped
\else
    \echo 'FAIL: a disposable table still exists.'
    \quit 1
\endif
\if :project_untouched
    \echo 'PASS: CREATE, ALTER ... ADD, ALTER ... DROP COLUMN, and FK-aware DROP TABLE demonstrated.'
\else
    \echo 'FAIL: the number of project tables changed.'
    \quit 1
\endif
