-- Referential actions and column defaults (revision 2026-10-31).
-- Run once against an existing database created before this revision:
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/referential_actions.sql
-- Fresh installs already get the same definitions from db/schema.sql; this
-- script then changes nothing. It never inserts, updates or deletes rows.
--
-- Deletion policy:
--   MATCHES -> LOST_REPORT / FOUND_REPORT  ON DELETE CASCADE  (derived association)
--   FOUND_PHOTOS -> FOUND_REPORT           ON DELETE CASCADE  (multivalued attribute)
--   CLAIM, CLAIM_EVIDENCE, HANDOVER        NO ACTION (unchanged): claim and
--     handover history can never disappear because a report was deleted.
-- Defaults: CLAIM."Claim_Date" and HANDOVER."Handover_Date" are supplied by the
-- database (CURRENT_DATE); the application omits these columns on INSERT.
\set ON_ERROR_STOP on

SELECT current_database() ~ '^smart_lost_found(_test|_demo)?$' AS allowed_database \gset
\if :allowed_database
\else
    \echo 'STOP: connect to smart_lost_found, smart_lost_found_test or smart_lost_found_demo.'
    \quit 1
\endif

-- Which changes are still needed? (confdeltype 'c' = CASCADE, 'a' = NO ACTION)
SELECT
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MATCHES_Lost_ID_fkey'
            AND conrelid = 'public."MATCHES"'::regclass AND confdeltype <> 'c') AS need_matches_lost,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MATCHES_Found_ID_fkey'
            AND conrelid = 'public."MATCHES"'::regclass AND confdeltype <> 'c') AS need_matches_found,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FOUND_PHOTOS_Found_ID_fkey'
            AND conrelid = 'public."FOUND_PHOTOS"'::regclass AND confdeltype <> 'c') AS need_photos
\gset

BEGIN;

\if :need_matches_lost
-- Drop and re-add in one ALTER TABLE statement: the table is never without the FK.
ALTER TABLE public."MATCHES"
    DROP CONSTRAINT "MATCHES_Lost_ID_fkey",
    ADD CONSTRAINT "MATCHES_Lost_ID_fkey"
        FOREIGN KEY ("Lost_ID") REFERENCES public."LOST_REPORT" ("Lost_ID") ON DELETE CASCADE;
\echo 'Changed MATCHES_Lost_ID_fkey to ON DELETE CASCADE'
\endif

\if :need_matches_found
ALTER TABLE public."MATCHES"
    DROP CONSTRAINT "MATCHES_Found_ID_fkey",
    ADD CONSTRAINT "MATCHES_Found_ID_fkey"
        FOREIGN KEY ("Found_ID") REFERENCES public."FOUND_REPORT" ("Found_ID") ON DELETE CASCADE;
\echo 'Changed MATCHES_Found_ID_fkey to ON DELETE CASCADE'
\endif

\if :need_photos
ALTER TABLE public."FOUND_PHOTOS"
    DROP CONSTRAINT "FOUND_PHOTOS_Found_ID_fkey",
    ADD CONSTRAINT "FOUND_PHOTOS_Found_ID_fkey"
        FOREIGN KEY ("Found_ID") REFERENCES public."FOUND_REPORT" ("Found_ID") ON DELETE CASCADE;
\echo 'Changed FOUND_PHOTOS_Found_ID_fkey to ON DELETE CASCADE'
\endif

-- SET DEFAULT is idempotent; existing rows keep their stored dates.
ALTER TABLE public."CLAIM" ALTER COLUMN "Claim_Date" SET DEFAULT CURRENT_DATE;
ALTER TABLE public."HANDOVER" ALTER COLUMN "Handover_Date" SET DEFAULT CURRENT_DATE;

COMMIT;

SELECT conrelid::regclass AS table_name, conname AS constraint_name,
    CASE confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'a' THEN 'NO ACTION' ELSE confdeltype::text END AS on_delete
FROM pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace
ORDER BY 1::text, 2;
