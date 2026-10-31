-- Recovery: remove the database-level RBAC layer from the current database.
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/roles_rollback.sql
--   add  -v drop_roles=1  to also DROP the cluster-wide lf_* roles, but only
--   after this script has been run in EVERY database that uses them.
--
-- The preferred full recovery is to restore the pre-migration backup
-- (pg_restore of the pg_dump taken before the migration, see README). This
-- script is the in-place alternative. It never changes table rows. It:
--   1. disables RLS and drops the 19 policies,
--   2. drops the objects owned by lf_auth / lf_reporting (the SECURITY DEFINER
--      auth/registration/helper functions and the admin_* analytics objects),
--   3. revokes every privilege held by the lf_* roles in this database,
--   4. restores PostgreSQL's default PUBLIC privileges.
-- The application code that relies on RBAC must then be reverted as well and
-- DATABASE_URL pointed back at the previous (owner) login.
\set ON_ERROR_STOP on

SELECT current_database() ~ '^smart_lost_found(_test|_demo)?$' AS allowed_database \gset
\if :allowed_database
\else
    \echo 'STOP: connect to smart_lost_found, smart_lost_found_test or smart_lost_found_demo.'
    \quit 1
\endif

BEGIN;

ALTER TABLE public."LOST_REPORT" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."FOUND_REPORT" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."CLAIM" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."HANDOVER" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."CLAIM_EVIDENCE" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lost_report_read ON public."LOST_REPORT";
DROP POLICY IF EXISTS lost_report_insert_own ON public."LOST_REPORT";
DROP POLICY IF EXISTS lost_report_update_own ON public."LOST_REPORT";
DROP POLICY IF EXISTS lost_report_delete_own ON public."LOST_REPORT";
DROP POLICY IF EXISTS found_report_read ON public."FOUND_REPORT";
DROP POLICY IF EXISTS found_report_insert_own ON public."FOUND_REPORT";
DROP POLICY IF EXISTS found_report_update_own ON public."FOUND_REPORT";
DROP POLICY IF EXISTS found_report_delete_own ON public."FOUND_REPORT";
DROP POLICY IF EXISTS claim_read_own ON public."CLAIM";
DROP POLICY IF EXISTS claim_insert_own ON public."CLAIM";
DROP POLICY IF EXISTS claim_lock_own ON public."CLAIM";
DROP POLICY IF EXISTS claim_delete_own ON public."CLAIM";
DROP POLICY IF EXISTS claim_reporting_read ON public."CLAIM";
DROP POLICY IF EXISTS handover_read_own ON public."HANDOVER";
DROP POLICY IF EXISTS handover_insert_own ON public."HANDOVER";
DROP POLICY IF EXISTS handover_reporting_read ON public."HANDOVER";
DROP POLICY IF EXISTS evidence_read_own ON public."CLAIM_EVIDENCE";
DROP POLICY IF EXISTS evidence_insert_own ON public."CLAIM_EVIDENCE";
DROP POLICY IF EXISTS evidence_delete_own ON public."CLAIM_EVIDENCE";

-- Objects owned by the NOLOGIN owner roles, then every remaining privilege.
DROP OWNED BY lf_auth, lf_reporting;
DROP OWNED BY lf_anon, lf_user, lf_admin, lf_web, lf_admin_web;

-- PostgreSQL defaults for PUBLIC.
GRANT CONNECT, TEMPORARY ON DATABASE :"DBNAME" TO PUBLIC;
GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_claim_summary(INTEGER),
    public.find_potential_matches(INTEGER, INTEGER),
    public.invalidate_report_embedding(),
    public.app_current_user_id() TO PUBLIC;
DO $$
BEGIN
    -- The procedures exist only if procedures.sql was applied.
    IF to_regprocedure('public.withdraw_claim(integer)') IS NOT NULL THEN
        GRANT EXECUTE ON PROCEDURE public.withdraw_claim(INTEGER, INTEGER) TO PUBLIC;
    END IF;
    IF to_regprocedure('public.delete_own_report(text, integer)') IS NOT NULL THEN
        GRANT EXECUTE ON PROCEDURE public.delete_own_report(TEXT, INTEGER) TO PUBLIC;
    END IF;
END
$$;

COMMIT;

\if :{?drop_roles}
DROP ROLE IF EXISTS lf_web, lf_admin_web, lf_anon, lf_user, lf_admin, lf_auth, lf_reporting;
\echo 'Dropped the lf_* roles.'
\endif

SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname;
\echo 'RBAC layer removed from this database. Restore DATABASE_URL to the previous login and revert the RBAC application code.'
