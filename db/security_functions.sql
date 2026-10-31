-- Narrow SECURITY DEFINER access paths (revision 2026-10-31). Run after roles.sql:
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/security_functions.sql
-- Application roles have no privileges on "USER" and can read only their own
-- CLAIM/HANDOVER rows. These functions are the only ways to:
--   * look up login credentials by email     auth_credentials     (lf_auth)
--   * load the signed-in user's own profile  auth_session_user    (lf_auth)
--   * create a USER account                  register_user        (lf_auth)
--   * ask whether an item was handed over    found_report_has_handover  (lf_reporting)
--   * count claims on one's own found report found_report_claim_count   (lf_reporting)
-- Each runs as a NOLOGIN owner that holds only the privileges it needs, has a
-- fixed search_path (pg_catalog, then pg_temp last), schema-qualifies every
-- object, uses no dynamic SQL, and is executable only by the role listed.
-- Rerunnable (CREATE OR REPLACE).
\set ON_ERROR_STOP on

SELECT current_database() ~ '^smart_lost_found(_test|_demo)?$' AS allowed_database \gset
\if :allowed_database
\else
    \echo 'STOP: connect to smart_lost_found, smart_lost_found_test or smart_lost_found_demo.'
    \quit 1
\endif

BEGIN;

-- Login: the Argon2id hash is verified in Node.js (lib/auth.ts), so the hash
-- must be returned, but only for one exact, normalised email at a time; no
-- application role can list hashes. Name, email and phone are not returned.
CREATE OR REPLACE FUNCTION public.auth_credentials(p_email VARCHAR)
RETURNS TABLE ("User_ID" INTEGER, "Role" VARCHAR, "Password_Hash" VARCHAR)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT u."User_ID", u."Role", u."Password_Hash"
    FROM public."USER" AS u
    WHERE u."Email" = lower(btrim(p_email))
    LIMIT 2;  -- USER_Email_key makes this unique; two rows would mean ambiguity.
$$;

-- Session: takes no argument. It returns only the row of the user whose ID the
-- server placed in the transaction-local app.user_id (from the sealed session
-- cookie), so it cannot be called with arbitrary IDs to list users, and it
-- returns no email, phone or hash.
CREATE OR REPLACE FUNCTION public.auth_session_user()
RETURNS TABLE ("User_ID" INTEGER, "Name" VARCHAR, "Role" VARCHAR)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT u."User_ID", u."Name", u."Role"
    FROM public."USER" AS u
    WHERE u."User_ID" = public.app_current_user_id();
$$;

-- Public registration. The role is the constant 'USER': there is no role
-- parameter, and the function only INSERTs, so it can never create an ADMIN
-- or change an existing account. ADMIN accounts are provisioned only through
-- the maintenance connection (scripts/provision-account.mjs).
CREATE OR REPLACE FUNCTION public.register_user(
    p_name VARCHAR,
    p_email VARCHAR,
    p_phone VARCHAR,
    p_password_hash VARCHAR
)
RETURNS TABLE ("User_ID" INTEGER, "Name" VARCHAR)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_name VARCHAR := btrim(p_name);
    v_email VARCHAR := lower(btrim(p_email));
    v_phone VARCHAR := NULLIF(btrim(p_phone), '');
    v_id INTEGER;
    v_constraint TEXT;
BEGIN
    IF v_name IS NULL OR v_name = '' OR length(v_name) > 100 THEN
        RAISE EXCEPTION 'Name must be 1 to 100 characters' USING ERRCODE = '22023';
    END IF;
    IF v_phone IS NOT NULL AND (length(v_phone) > 15 OR v_phone !~ '^\+?[0-9][0-9 -]*[0-9]$') THEN
        RAISE EXCEPTION 'Phone number is not valid' USING ERRCODE = '22023';
    END IF;
    -- Defence in depth: refuse anything that is not an Argon2id hash, so this
    -- path can never store a plaintext password.
    IF p_password_hash IS NULL OR p_password_hash !~ '^\$argon2id\$' THEN
        RAISE EXCEPTION 'Password must be supplied as an Argon2id hash' USING ERRCODE = '22023';
    END IF;

    -- IDs are explicit INTs (no sequences in the approved schema): pick a random
    -- positive ID and retry only on a primary-key collision. A duplicate email
    -- raises USER_Email_key (23505), which is race-safe and reported to the caller.
    FOR attempt IN 1..5 LOOP
        v_id := 1 + floor(random() * 2147483646)::INTEGER;
        BEGIN
            INSERT INTO public."USER" ("User_ID", "Name", "Email", "Phone", "Role", "Password_Hash")
            VALUES (v_id, v_name, v_email, v_phone, 'USER', p_password_hash);
            RETURN QUERY SELECT v_id, v_name;
            RETURN;
        EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            IF v_constraint <> 'USER_pkey' THEN
                RAISE;  -- e.g. USER_Email_key: re-raise unchanged
            END IF;
        END;
    END LOOP;
    RAISE EXCEPTION 'Could not allocate a user ID' USING ERRCODE = '40001';
END;
$$;

-- Public fact already shown in the interface ("Returned"): has any claim on
-- this found report been handed over? Reveals no claimant or claim details.
CREATE OR REPLACE FUNCTION public.found_report_has_handover(p_found_id INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public."CLAIM" AS c
        JOIN public."HANDOVER" AS h ON h."Claim_ID" = c."Claim_ID"
        WHERE c."Found_ID" = p_found_id
    );
$$;

-- Number of claims on a found report, answered only for the report's owner
-- (NULL for anyone else). Used by My Reports and delete_own_report.
CREATE OR REPLACE FUNCTION public.found_report_claim_count(p_found_id INTEGER)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM public."FOUND_REPORT" AS f
                     WHERE f."Found_ID" = p_found_id
                       AND f."User_ID" = public.app_current_user_id())
        THEN (SELECT COUNT(*) FROM public."CLAIM" AS c WHERE c."Found_ID" = p_found_id)
    END;
$$;

ALTER FUNCTION public.auth_credentials(VARCHAR) OWNER TO lf_auth;
ALTER FUNCTION public.auth_session_user() OWNER TO lf_auth;
ALTER FUNCTION public.register_user(VARCHAR, VARCHAR, VARCHAR, VARCHAR) OWNER TO lf_auth;
ALTER FUNCTION public.found_report_has_handover(INTEGER) OWNER TO lf_reporting;
ALTER FUNCTION public.found_report_claim_count(INTEGER) OWNER TO lf_reporting;

REVOKE ALL ON FUNCTION public.auth_credentials(VARCHAR),
    public.auth_session_user(),
    public.register_user(VARCHAR, VARCHAR, VARCHAR, VARCHAR),
    public.found_report_has_handover(INTEGER),
    public.found_report_claim_count(INTEGER)
FROM PUBLIC;
-- lf_user inherits lf_anon, so signed-in requests can use these too.
GRANT EXECUTE ON FUNCTION public.auth_credentials(VARCHAR),
    public.auth_session_user(),
    public.register_user(VARCHAR, VARCHAR, VARCHAR, VARCHAR),
    public.found_report_has_handover(INTEGER)
TO lf_anon;
GRANT EXECUTE ON FUNCTION public.found_report_claim_count(INTEGER) TO lf_user;

COMMIT;
