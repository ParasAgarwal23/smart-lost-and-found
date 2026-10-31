-- Read-only RBAC verification; run after roles.sql, security_functions.sql,
-- procedures.sql and admin_reports.sql:
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/verify_roles.sql
-- Raises an error on the first mismatch; otherwise prints the role attributes,
-- memberships, an allowed/denied privilege matrix and the RLS policies.
BEGIN READ ONLY;
SET LOCAL search_path = public, pg_catalog;

DO $$
DECLARE
    expected RECORD;
    allowed BOOLEAN;
BEGIN
    IF current_database() !~ '^smart_lost_found(_test|_demo)?$' THEN
        RAISE EXCEPTION 'Expected smart_lost_found, smart_lost_found_test or smart_lost_found_demo';
    END IF;

    -- 1. Role attributes. No application role is a superuser, can create
    --    roles/databases, replicate or bypass RLS. Only the two logins can log in.
    FOR expected IN
        SELECT * FROM (VALUES
        ('lf_anon', false, true), ('lf_user', false, true), ('lf_admin', false, true),
        ('lf_auth', false, false), ('lf_reporting', false, false),
        ('lf_web', true, false), ('lf_admin_web', true, false)
        ) AS approved(role_name, can_login, inherits)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_roles
            WHERE rolname = expected.role_name AND rolcanlogin = expected.can_login
              AND rolinherit = expected.inherits AND NOT rolsuper AND NOT rolcreaterole
              AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
        ) THEN
            RAISE EXCEPTION 'Missing role or unexpected attributes: %', expected.role_name;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lf_admin_web'
                   AND 'default_transaction_read_only=on' = ANY(rolconfig)) THEN
        RAISE EXCEPTION 'lf_admin_web must default to read-only transactions';
    END IF;

    -- 2. Memberships: exactly these, with these INHERIT/SET options.
    FOR expected IN
        SELECT * FROM (VALUES
        ('lf_anon', 'lf_user', true, false),
        ('lf_anon', 'lf_web', false, true),
        ('lf_user', 'lf_web', false, true),
        ('lf_admin', 'lf_admin_web', false, true)
        ) AS approved(granted_role, member, inherit_option, set_option)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_auth_members AS m
            WHERE m.roleid = expected.granted_role::regrole AND m.member = expected.member::regrole
              AND m.inherit_option = expected.inherit_option AND m.set_option = expected.set_option
              AND NOT m.admin_option
        ) THEN
            RAISE EXCEPTION 'Missing or incorrect membership: % in %', expected.member, expected.granted_role;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_auth_members AS m
        WHERE pg_get_userbyid(m.roleid) LIKE 'lf\_%' OR pg_get_userbyid(m.member) LIKE 'lf\_%') <> 4 THEN
        RAISE EXCEPTION 'Unexpected extra role memberships involving lf_* roles';
    END IF;
    IF pg_has_role('lf_web', 'lf_admin', 'MEMBER') OR pg_has_role('lf_admin_web', 'lf_user', 'MEMBER') THEN
        RAISE EXCEPTION 'A web login can reach the other login''s privilege role';
    END IF;

    -- 3. Privilege matrix (has_*_privilege follows inherited membership).
    FOR expected IN
        SELECT * FROM (VALUES
        -- role,     kind,     object,                                   column,          privilege,  expected
        ('lf_anon',  'table',  'public."CATEGORY"',                      NULL,            'SELECT',   true),
        ('lf_anon',  'column', 'public."FOUND_REPORT"',                  'Item_Name',     'SELECT',   true),
        ('lf_anon',  'column', 'public."FOUND_REPORT"',                  'Embedding',     'SELECT',   true),
        ('lf_anon',  'column', 'public."FOUND_REPORT"',                  'User_ID',       'SELECT',   false),
        ('lf_anon',  'column', 'public.v_found_report_details',          'User_ID',       'SELECT',   false),
        ('lf_anon',  'table',  'public."USER"',                          NULL,            'SELECT',   false),
        ('lf_anon',  'column', 'public."USER"',                          'Password_Hash', 'SELECT',   false),
        ('lf_anon',  'table',  'public."CLAIM"',                         NULL,            'SELECT',   false),
        ('lf_anon',  'column', 'public."HANDOVER"',                      'Signature',     'SELECT',   false),
        ('lf_anon',  'table',  'public."LOST_REPORT"',                   NULL,            'INSERT',   false),
        ('lf_anon',  'table',  'public.admin_campus_totals',             NULL,            'SELECT',   false),
        ('lf_user',  'table',  'public."LOST_REPORT"',                   NULL,            'INSERT',   true),
        ('lf_user',  'table',  'public."LOST_REPORT"',                   NULL,            'DELETE',   true),
        ('lf_user',  'column', 'public."LOST_REPORT"',                   'Description',   'UPDATE',   true),
        ('lf_user',  'column', 'public."LOST_REPORT"',                   'User_ID',       'UPDATE',   false),
        ('lf_user',  'column', 'public."FOUND_REPORT"',                  'User_ID',       'SELECT',   true),
        ('lf_user',  'column', 'public."CLAIM"',                         'Claim_ID',      'INSERT',   true),
        ('lf_user',  'column', 'public."CLAIM"',                         'Claim_Date',    'INSERT',   false),
        ('lf_user',  'column', 'public."CLAIM"',                         'Found_ID',      'UPDATE',   false),
        ('lf_user',  'column', 'public."HANDOVER"',                      'Handover_Date', 'INSERT',   false),
        ('lf_user',  'table',  'public."HANDOVER"',                      NULL,            'UPDATE',   false),
        ('lf_user',  'table',  'public."HANDOVER"',                      NULL,            'DELETE',   false),
        ('lf_user',  'table',  'public."CLAIM"',                         NULL,            'TRUNCATE', false),
        ('lf_user',  'table',  'public."LOST_REPORT"',                   NULL,            'TRUNCATE', false),
        ('lf_user',  'table',  'public."MATCHES"',                       NULL,            'DELETE',   false),
        ('lf_user',  'table',  'public."USER"',                          NULL,            'SELECT',   false),
        ('lf_user',  'table',  'public."USER"',                          NULL,            'INSERT',   false),
        ('lf_user',  'table',  'public.admin_location_hotspots',         NULL,            'SELECT',   false),
        ('lf_admin', 'table',  'public.admin_campus_totals',             NULL,            'SELECT',   true),
        ('lf_admin', 'table',  'public.admin_contested_items',           NULL,            'SELECT',   true),
        ('lf_admin', 'column', 'public.v_lost_report_details',           'Item_Name',     'SELECT',   true),
        ('lf_admin', 'column', 'public.v_lost_report_details',           'User_ID',       'SELECT',   false),
        ('lf_admin', 'table',  'public."CLAIM"',                         NULL,            'SELECT',   false),
        ('lf_admin', 'table',  'public."CLAIM_EVIDENCE"',                NULL,            'SELECT',   false),
        ('lf_admin', 'table',  'public."LOST_REPORT"',                   NULL,            'INSERT',   false),
        ('lf_web',   'table',  'public."CATEGORY"',                      NULL,            'SELECT',   false),
        ('lf_admin_web', 'table', 'public.admin_campus_totals',          NULL,            'SELECT',   false),
        ('lf_auth',  'column', 'public."USER"',                          'Password_Hash', 'SELECT',   true),
        ('lf_auth',  'table',  'public."USER"',                          NULL,            'UPDATE',   false),
        ('lf_auth',  'table',  'public."USER"',                          NULL,            'DELETE',   false),
        ('lf_reporting', 'table', 'public."CLAIM"',                      NULL,            'SELECT',   true),
        ('lf_reporting', 'table', 'public."CLAIM_EVIDENCE"',             NULL,            'SELECT',   false),
        ('lf_reporting', 'table', 'public."CLAIM"',                      NULL,            'INSERT',   false)
        ) AS approved(role_name, kind, object_name, column_name, privilege, expected_result)
    LOOP
        allowed := CASE expected.kind
            WHEN 'table' THEN has_table_privilege(expected.role_name, expected.object_name, expected.privilege)
            ELSE has_column_privilege(expected.role_name, expected.object_name, expected.column_name, expected.privilege)
        END;
        IF allowed <> expected.expected_result THEN
            RAISE EXCEPTION 'Privilege mismatch: % % on % should be %', expected.role_name, expected.privilege,
                expected.object_name || coalesce('.' || expected.column_name, ''), expected.expected_result;
        END IF;
    END LOOP;

    FOR expected IN
        SELECT * FROM (VALUES
        ('lf_anon', 'public.auth_credentials(character varying)', true),
        ('lf_anon', 'public.auth_session_user()', true),
        ('lf_anon', 'public.register_user(character varying, character varying, character varying, character varying)', true),
        ('lf_anon', 'public.found_report_has_handover(integer)', true),
        ('lf_anon', 'public.found_report_claim_count(integer)', false),
        ('lf_anon', 'public.get_claim_summary(integer)', false),
        ('lf_anon', 'public.withdraw_claim(integer)', false),
        ('lf_anon', 'public.delete_own_report(text, integer)', false),
        ('lf_anon', 'public.admin_daily_activity(integer)', false),
        ('lf_user', 'public.get_claim_summary(integer)', true),
        ('lf_user', 'public.find_potential_matches(integer, integer)', true),
        ('lf_user', 'public.found_report_claim_count(integer)', true),
        ('lf_user', 'public.withdraw_claim(integer)', true),
        ('lf_user', 'public.delete_own_report(text, integer)', true),
        ('lf_user', 'public.admin_daily_activity(integer)', false),
        ('lf_admin', 'public.admin_daily_activity(integer)', true),
        ('lf_admin', 'public.register_user(character varying, character varying, character varying, character varying)', false),
        ('lf_web', 'public.register_user(character varying, character varying, character varying, character varying)', false)
        ) AS approved(role_name, routine, expected_result)
    LOOP
        IF has_function_privilege(expected.role_name, expected.routine, 'EXECUTE') <> expected.expected_result THEN
            RAISE EXCEPTION 'EXECUTE mismatch: % on % should be %', expected.role_name, expected.routine, expected.expected_result;
        END IF;
    END LOOP;

    -- 4. PUBLIC holds nothing on the database, the schema, the managed tables
    --    and views, or the project's functions and procedures.
    IF EXISTS (SELECT 1 FROM pg_database, aclexplode(datacl) AS a WHERE datname = current_database() AND a.grantee = 0)
        OR (SELECT datacl IS NULL FROM pg_database WHERE datname = current_database()) THEN
        RAISE EXCEPTION 'PUBLIC still has database privileges';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_namespace, aclexplode(nspacl) AS a WHERE nspname = 'public' AND a.grantee = 0) THEN
        RAISE EXCEPTION 'PUBLIC still has privileges on schema public';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class AS c, aclexplode(c.relacl) AS a
               WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v') AND a.grantee = 0) THEN
        RAISE EXCEPTION 'PUBLIC still has privileges on a table or view';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc AS p
               LEFT JOIN pg_depend AS d ON d.objid = p.oid AND d.deptype = 'e'
               WHERE p.pronamespace = 'public'::regnamespace AND d.objid IS NULL
                 AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) AS a WHERE a.grantee = 0))) THEN
        RAISE EXCEPTION 'PUBLIC can still execute a project function or procedure';
    END IF;

    -- 5. RLS is enabled with the expected policies.
    FOR expected IN
        SELECT * FROM (VALUES
        ('LOST_REPORT', 'lost_report_read'), ('LOST_REPORT', 'lost_report_insert_own'),
        ('LOST_REPORT', 'lost_report_update_own'), ('LOST_REPORT', 'lost_report_delete_own'),
        ('FOUND_REPORT', 'found_report_read'), ('FOUND_REPORT', 'found_report_insert_own'),
        ('FOUND_REPORT', 'found_report_update_own'), ('FOUND_REPORT', 'found_report_delete_own'),
        ('CLAIM', 'claim_read_own'), ('CLAIM', 'claim_insert_own'), ('CLAIM', 'claim_lock_own'),
        ('CLAIM', 'claim_delete_own'), ('CLAIM', 'claim_reporting_read'),
        ('HANDOVER', 'handover_read_own'), ('HANDOVER', 'handover_insert_own'), ('HANDOVER', 'handover_reporting_read'),
        ('CLAIM_EVIDENCE', 'evidence_read_own'), ('CLAIM_EVIDENCE', 'evidence_insert_own'), ('CLAIM_EVIDENCE', 'evidence_delete_own')
        ) AS approved(table_name, policy_name)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                       AND tablename = expected.table_name AND policyname = expected.policy_name)
           OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', expected.table_name)::regclass) THEN
            RAISE EXCEPTION 'Missing RLS policy % on %', expected.policy_name, expected.table_name;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 19 THEN
        RAISE EXCEPTION 'Expected exactly 19 RLS policies';
    END IF;

    -- 6. Every SECURITY DEFINER routine has a NOLOGIN, non-superuser owner and a fixed search_path.
    IF EXISTS (SELECT 1 FROM pg_proc AS p JOIN pg_roles AS r ON r.oid = p.proowner
               WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
                 AND (r.rolsuper OR r.rolcanlogin OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'])) THEN
        RAISE EXCEPTION 'A SECURITY DEFINER routine has an unsafe owner or search_path';
    END IF;

    RAISE NOTICE 'PASS: 7 roles (no superuser/BYPASSRLS), 4 memberships, 43 table/column and 18 EXECUTE privilege checks, no PUBLIC privileges, 19 RLS policies on 5 tables, SECURITY DEFINER routines owned by NOLOGIN roles with fixed search_path';
END
$$;

SELECT rolname AS role, rolcanlogin AS login, rolinherit AS inherit, rolsuper AS superuser,
    rolbypassrls AS bypass_rls, rolconnlimit AS connection_limit, rolconfig AS settings
FROM pg_roles WHERE rolname LIKE 'lf\_%' ORDER BY rolname;

SELECT pg_get_userbyid(member) AS login_or_role, pg_get_userbyid(roleid) AS member_of,
    inherit_option AS inherits, set_option AS can_set_role
FROM pg_auth_members
WHERE pg_get_userbyid(roleid) LIKE 'lf\_%'
ORDER BY 1, 2;

SELECT tablename AS table_name, policyname AS policy, cmd AS command, roles,
    qual AS using_expression, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;

COMMIT;
