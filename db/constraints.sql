-- Integrity constraints added after the initial schema (revision 2026-10-16).
-- Run once against an existing smart_lost_found database:
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/constraints.sql
-- Fresh installs get the same constraints from db/schema.sql; this script is
-- then a no-op. It never changes or deletes rows: if existing data violates a
-- rule, the whole transaction stops and reports the conflict instead.
BEGIN;

DO $$
DECLARE
    conflicts TEXT := '';
BEGIN
    IF current_database() <> 'smart_lost_found' THEN
        RAISE EXCEPTION 'Connect to smart_lost_found before running this script';
    END IF;

    IF EXISTS (SELECT 1 FROM public."USER" WHERE "Role" NOT IN ('USER', 'ADMIN')) THEN
        conflicts := conflicts || ' USER.Role outside USER/ADMIN;';
    END IF;
    IF EXISTS (SELECT 1 FROM public."USER" WHERE "Email" IS NOT NULL GROUP BY "Email" HAVING COUNT(*) > 1) THEN
        conflicts := conflicts || ' duplicate USER.Email;';
    END IF;
    IF EXISTS (SELECT 1 FROM public."LOST_REPORT" WHERE btrim("Item_Name") = '') THEN
        conflicts := conflicts || ' blank LOST_REPORT.Item_Name;';
    END IF;
    IF EXISTS (SELECT 1 FROM public."FOUND_REPORT" WHERE btrim("Item_Name") = '') THEN
        conflicts := conflicts || ' blank FOUND_REPORT.Item_Name;';
    END IF;
    IF EXISTS (SELECT 1 FROM public."CLAIM_EVIDENCE" WHERE "Evidence_No" < 1) THEN
        conflicts := conflicts || ' CLAIM_EVIDENCE.Evidence_No below 1;';
    END IF;
    IF EXISTS (SELECT 1 FROM public."CLAIM" GROUP BY "User_ID", "Found_ID" HAVING COUNT(*) > 1) THEN
        conflicts := conflicts || ' duplicate CLAIM (User_ID, Found_ID);';
    END IF;
    IF conflicts <> '' THEN
        RAISE EXCEPTION 'Existing rows conflict with the new constraints:% Resolve them manually; nothing was changed.', conflicts;
    END IF;
END
$$;

-- Add each constraint only if it is not already present (fresh schema.sql installs).
DO $$
DECLARE
    item RECORD;
BEGIN
    FOR item IN
        SELECT * FROM (VALUES
            ('USER', 'USER_Role_check', 'CHECK ("Role" IN (''USER'', ''ADMIN''))'),
            ('USER', 'USER_Email_key', 'UNIQUE ("Email")'),
            ('LOST_REPORT', 'LOST_REPORT_Item_Name_check', 'CHECK (btrim("Item_Name") <> '''')'),
            ('FOUND_REPORT', 'FOUND_REPORT_Item_Name_check', 'CHECK (btrim("Item_Name") <> '''')'),
            ('CLAIM_EVIDENCE', 'CLAIM_EVIDENCE_Evidence_No_check', 'CHECK ("Evidence_No" >= 1)'),
            ('CLAIM', 'CLAIM_User_ID_Found_ID_key', 'UNIQUE ("User_ID", "Found_ID")')
        ) AS wanted(table_name, constraint_name, definition)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = format('public.%I', item.table_name)::regclass
              AND conname = item.constraint_name
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',
                item.table_name, item.constraint_name, item.definition);
            RAISE NOTICE 'Added %.%', item.table_name, item.constraint_name;
        END IF;
    END LOOP;
END
$$;

COMMIT;
