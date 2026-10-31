-- Database-level role-based access control (revision 2026-10-31).
-- Run after schema.sql, views.sql, functions.sql, triggers.sql, indexes.sql and
-- vector_search.sql, as the database owner (postgres):
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/roles.sql
-- Then run security_functions.sql, procedures.sql and admin_reports.sql, which
-- grant access to their own objects. Rerunnable.
--
-- Roles are cluster-wide; grants, ACLs and policies are per database, so run
-- this script in every database the application uses. No password is set
-- here: set the two login passwords privately with psql's \password command.
--
--   lf_anon       privilege role: public visitor (read public report columns)
--   lf_user       privilege role: signed-in USER or ADMIN acting as a user
--                 (inherits lf_anon)
--   lf_admin      privilege role: read-only campus analytics through admin_*
--                 objects only; NOT a member of lf_user
--   lf_auth       owner of the SECURITY DEFINER authentication functions
--   lf_reporting  owner of the SECURITY DEFINER reporting views/functions
--   lf_web        LOGIN for every web request; NOINHERIT, so it has no
--                 privileges until lib/db.ts sets lf_anon or lf_user for the
--                 current transaction. It can never become lf_admin.
--   lf_admin_web  LOGIN used only by lib/admin-db.ts after an ADMIN check;
--                 can become lf_admin only; read-only by default.
\set ON_ERROR_STOP on

SELECT current_database() ~ '^smart_lost_found(_test|_demo)?$' AS allowed_database \gset
\if :allowed_database
\else
    \echo 'STOP: connect to smart_lost_found, smart_lost_found_test or smart_lost_found_demo.'
    \quit 1
\endif

BEGIN;

-- 1. Roles (CREATE ROLE has no IF NOT EXISTS). Attributes are re-asserted on
--    every run so a manual change cannot silently widen a role.
DO $$
DECLARE
    role_name TEXT;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['lf_anon', 'lf_user', 'lf_admin', 'lf_auth',
                                      'lf_reporting', 'lf_web', 'lf_admin_web'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
        END IF;
    END LOOP;
END
$$;

ALTER ROLE lf_anon      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE lf_user      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE lf_admin     NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE lf_auth      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE lf_reporting NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE lf_web       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 20;
ALTER ROLE lf_admin_web LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 10;

-- Per-role session limits (cluster-wide settings).
ALTER ROLE lf_web SET statement_timeout = '15s';
ALTER ROLE lf_web SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE lf_admin_web SET statement_timeout = '15s';
ALTER ROLE lf_admin_web SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE lf_admin_web SET default_transaction_read_only = on;

-- 2. Memberships (PostgreSQL 16+ options). INHERIT FALSE + SET TRUE: the login
--    gains a role's privileges only after SET ROLE, which lib/db.ts performs
--    transaction-locally from a fixed allowlist.
GRANT lf_anon TO lf_user WITH INHERIT TRUE, SET FALSE;
GRANT lf_anon TO lf_web WITH INHERIT FALSE, SET TRUE;
GRANT lf_user TO lf_web WITH INHERIT FALSE, SET TRUE;
GRANT lf_admin TO lf_admin_web WITH INHERIT FALSE, SET TRUE;

-- 3. Database and schema access. PUBLIC loses its default CONNECT/TEMP and
--    schema USAGE; only the application logins may connect.
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO lf_web, lf_admin_web;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lf_anon, lf_admin, lf_auth, lf_reporting;

-- 4. Start every managed table/view from no privileges, then grant precisely.
--    (Revoking a table privilege also revokes the matching column privileges.)
REVOKE ALL ON TABLE public."USER", public."CATEGORY", public."LOCATION",
    public."LOST_REPORT", public."FOUND_REPORT", public."FOUND_PHOTOS", public."MATCHES",
    public."CLAIM", public."CLAIM_EVIDENCE", public."HANDOVER",
    public.v_lost_report_details, public.v_found_report_details
FROM PUBLIC, lf_anon, lf_user, lf_admin, lf_auth, lf_reporting, lf_web, lf_admin_web;

-- lf_anon: public browsing and search. No USER table, no claim/handover rows,
-- no report owner IDs.
GRANT SELECT ON public."CATEGORY", public."LOCATION" TO lf_anon;
GRANT SELECT ("Lost_ID", "Category_ID", "Location_ID", "Item_Name", "Description",
              "Date_Lost", "Status", "Embedding")
    ON public."LOST_REPORT" TO lf_anon;
GRANT SELECT ("Found_ID", "Category_ID", "Location_ID", "Item_Name", "Description",
              "Date_Found", "Status", "Embedding")
    ON public."FOUND_REPORT" TO lf_anon;
GRANT SELECT ("Lost_ID", "Category_ID", "Category_Name", "Location_ID", "Location_Name",
              "Building", "Item_Name", "Description", "Date_Lost", "Status")
    ON public.v_lost_report_details TO lf_anon, lf_admin;
GRANT SELECT ("Found_ID", "Category_ID", "Category_Name", "Location_ID", "Location_Name",
              "Building", "Item_Name", "Description", "Date_Found", "Status", "Photo_Count")
    ON public.v_found_report_details TO lf_anon, lf_admin;

-- lf_user: owner workflows. RLS (section 6) limits rows to the caller's own.
GRANT SELECT, INSERT, DELETE ON public."LOST_REPORT", public."FOUND_REPORT" TO lf_user;
GRANT UPDATE ("Item_Name", "Description", "Category_ID", "Location_ID", "Date_Lost", "Embedding")
    ON public."LOST_REPORT" TO lf_user;
GRANT UPDATE ("Item_Name", "Description", "Category_ID", "Location_ID", "Date_Found", "Embedding")
    ON public."FOUND_REPORT" TO lf_user;
GRANT SELECT ON public.v_lost_report_details, public.v_found_report_details TO lf_user;
-- Claim_Date and Handover_Date are not insertable: only their DEFAULT CURRENT_DATE
-- can supply them, so a client cannot backdate a claim or receipt.
GRANT SELECT, DELETE ON public."CLAIM" TO lf_user;
GRANT INSERT ("Claim_ID", "User_ID", "Found_ID") ON public."CLAIM" TO lf_user;
-- PostgreSQL requires UPDATE privilege for SELECT ... FOR UPDATE row locks.
-- The application never updates CLAIM; RLS limits this to the caller's claims.
GRANT UPDATE ("Status") ON public."CLAIM" TO lf_user;
GRANT SELECT, INSERT, DELETE ON public."CLAIM_EVIDENCE" TO lf_user;
-- Receipts are history: no UPDATE or DELETE for any application role.
GRANT SELECT ON public."HANDOVER" TO lf_user;
GRANT INSERT ("Handover_ID", "Claim_ID", "Signature") ON public."HANDOVER" TO lf_user;

-- Owner roles of SECURITY DEFINER code (security_functions.sql, admin_reports.sql).
GRANT SELECT ("User_ID", "Name", "Email", "Role", "Password_Hash") ON public."USER" TO lf_auth;
GRANT INSERT ("User_ID", "Name", "Email", "Phone", "Role", "Password_Hash") ON public."USER" TO lf_auth;
GRANT SELECT ON public."CATEGORY", public."LOCATION", public."LOST_REPORT",
    public."FOUND_REPORT", public."CLAIM", public."HANDOVER" TO lf_reporting;

-- 5. Functions from functions.sql, triggers.sql and vector_search.sql. EXECUTE is
--    revoked by name: a blanket revoke would also hit pgvector's own functions.
REVOKE EXECUTE ON FUNCTION public.get_claim_summary(INTEGER),
    public.find_potential_matches(INTEGER, INTEGER),
    public.invalidate_report_embedding(),
    public.app_current_user_id()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_claim_summary(INTEGER),
    public.find_potential_matches(INTEGER, INTEGER) TO lf_user;
GRANT EXECUTE ON FUNCTION public.app_current_user_id() TO lf_anon, lf_auth, lf_reporting;

-- 6. Row-Level Security. Owner = "User_ID" equals app_current_user_id(), the
--    transaction-local identity set by lib/db.ts from the verified session.
--    The table owner (postgres, used only for maintenance) bypasses RLS.
ALTER TABLE public."LOST_REPORT" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FOUND_REPORT" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CLAIM" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HANDOVER" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CLAIM_EVIDENCE" ENABLE ROW LEVEL SECURITY;

-- Reports are public to read; only the owner may create, change or delete one.
DROP POLICY IF EXISTS lost_report_read ON public."LOST_REPORT";
CREATE POLICY lost_report_read ON public."LOST_REPORT"
    FOR SELECT TO lf_anon, lf_user, lf_reporting USING (true);
DROP POLICY IF EXISTS lost_report_insert_own ON public."LOST_REPORT";
CREATE POLICY lost_report_insert_own ON public."LOST_REPORT"
    FOR INSERT TO lf_user WITH CHECK ("User_ID" = public.app_current_user_id());
DROP POLICY IF EXISTS lost_report_update_own ON public."LOST_REPORT";
CREATE POLICY lost_report_update_own ON public."LOST_REPORT"
    FOR UPDATE TO lf_user
    USING ("User_ID" = public.app_current_user_id())
    WITH CHECK ("User_ID" = public.app_current_user_id());
DROP POLICY IF EXISTS lost_report_delete_own ON public."LOST_REPORT";
CREATE POLICY lost_report_delete_own ON public."LOST_REPORT"
    FOR DELETE TO lf_user USING ("User_ID" = public.app_current_user_id());

DROP POLICY IF EXISTS found_report_read ON public."FOUND_REPORT";
CREATE POLICY found_report_read ON public."FOUND_REPORT"
    FOR SELECT TO lf_anon, lf_user, lf_reporting USING (true);
DROP POLICY IF EXISTS found_report_insert_own ON public."FOUND_REPORT";
CREATE POLICY found_report_insert_own ON public."FOUND_REPORT"
    FOR INSERT TO lf_user WITH CHECK ("User_ID" = public.app_current_user_id());
-- Claim, evidence and handover transactions serialise on the found report by
-- locking it (SELECT ... FOR UPDATE), and the claimant is not its owner. Row
-- locks check only USING, so USING (true) lets any user lock the row; an
-- actual UPDATE must still pass WITH CHECK, and "User_ID" is not updatable,
-- so only the owner can change a found report.
DROP POLICY IF EXISTS found_report_update_own ON public."FOUND_REPORT";
CREATE POLICY found_report_update_own ON public."FOUND_REPORT"
    FOR UPDATE TO lf_user
    USING (true)
    WITH CHECK ("User_ID" = public.app_current_user_id());
DROP POLICY IF EXISTS found_report_delete_own ON public."FOUND_REPORT";
CREATE POLICY found_report_delete_own ON public."FOUND_REPORT"
    FOR DELETE TO lf_user USING ("User_ID" = public.app_current_user_id());

-- Claims are private to the claimant. Cross-user questions ("has this item
-- been handed over?", "how many claims are on my found report?") go through
-- the narrow SECURITY DEFINER helpers in security_functions.sql instead.
DROP POLICY IF EXISTS claim_read_own ON public."CLAIM";
CREATE POLICY claim_read_own ON public."CLAIM"
    FOR SELECT TO lf_user USING ("User_ID" = public.app_current_user_id());
DROP POLICY IF EXISTS claim_insert_own ON public."CLAIM";
CREATE POLICY claim_insert_own ON public."CLAIM"
    FOR INSERT TO lf_user WITH CHECK ("User_ID" = public.app_current_user_id());
DROP POLICY IF EXISTS claim_lock_own ON public."CLAIM";
CREATE POLICY claim_lock_own ON public."CLAIM"
    FOR UPDATE TO lf_user
    USING ("User_ID" = public.app_current_user_id())
    WITH CHECK ("User_ID" = public.app_current_user_id());
DROP POLICY IF EXISTS claim_delete_own ON public."CLAIM";
CREATE POLICY claim_delete_own ON public."CLAIM"
    FOR DELETE TO lf_user USING ("User_ID" = public.app_current_user_id());
DROP POLICY IF EXISTS claim_reporting_read ON public."CLAIM";
CREATE POLICY claim_reporting_read ON public."CLAIM"
    FOR SELECT TO lf_reporting USING (true);

-- A receipt is visible to, and can be recorded by, the owner of its claim only.
DROP POLICY IF EXISTS handover_read_own ON public."HANDOVER";
CREATE POLICY handover_read_own ON public."HANDOVER"
    FOR SELECT TO lf_user
    USING (EXISTS (SELECT 1 FROM public."CLAIM" AS c
                   WHERE c."Claim_ID" = "HANDOVER"."Claim_ID"
                     AND c."User_ID" = public.app_current_user_id()));
DROP POLICY IF EXISTS handover_insert_own ON public."HANDOVER";
CREATE POLICY handover_insert_own ON public."HANDOVER"
    FOR INSERT TO lf_user
    WITH CHECK (EXISTS (SELECT 1 FROM public."CLAIM" AS c
                        WHERE c."Claim_ID" = "HANDOVER"."Claim_ID"
                          AND c."User_ID" = public.app_current_user_id()));
DROP POLICY IF EXISTS handover_reporting_read ON public."HANDOVER";
CREATE POLICY handover_reporting_read ON public."HANDOVER"
    FOR SELECT TO lf_reporting USING (true);

-- Evidence is private to the claimant (no administrator override).
DROP POLICY IF EXISTS evidence_read_own ON public."CLAIM_EVIDENCE";
CREATE POLICY evidence_read_own ON public."CLAIM_EVIDENCE"
    FOR SELECT TO lf_user
    USING (EXISTS (SELECT 1 FROM public."CLAIM" AS c
                   WHERE c."Claim_ID" = "CLAIM_EVIDENCE"."Claim_ID"
                     AND c."User_ID" = public.app_current_user_id()));
DROP POLICY IF EXISTS evidence_insert_own ON public."CLAIM_EVIDENCE";
CREATE POLICY evidence_insert_own ON public."CLAIM_EVIDENCE"
    FOR INSERT TO lf_user
    WITH CHECK (EXISTS (SELECT 1 FROM public."CLAIM" AS c
                        WHERE c."Claim_ID" = "CLAIM_EVIDENCE"."Claim_ID"
                          AND c."User_ID" = public.app_current_user_id()));
DROP POLICY IF EXISTS evidence_delete_own ON public."CLAIM_EVIDENCE";
CREATE POLICY evidence_delete_own ON public."CLAIM_EVIDENCE"
    FOR DELETE TO lf_user
    USING (EXISTS (SELECT 1 FROM public."CLAIM" AS c
                   WHERE c."Claim_ID" = "CLAIM_EVIDENCE"."Claim_ID"
                     AND c."User_ID" = public.app_current_user_id()));

COMMIT;

SELECT rolname, rolcanlogin AS login, rolinherit AS inherit, rolsuper AS superuser,
    rolbypassrls AS bypass_rls, rolconnlimit AS connection_limit
FROM pg_roles WHERE rolname LIKE 'lf\_%' ORDER BY rolname;
\echo 'Roles and grants applied. Set login passwords privately if not already set: \\password lf_web  and  \\password lf_admin_web'
