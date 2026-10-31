-- Stored procedures called by the application with CALL (revision 2026-10-31).
-- Run after roles.sql and security_functions.sql:
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/procedures.sql
-- Both are SECURITY INVOKER: they run as the caller (lf_user), so table grants
-- and RLS still apply inside them. Identity comes from app_current_user_id()
-- (set transaction-locally by lib/db.ts), never from a parameter. Neither
-- procedure COMMITs: each runs inside the caller's transaction, so it is
-- atomic with it and a failure rolls everything back.
--
-- Error codes (custom SQLSTATE class LF, mapped to messages by the app):
--   LF404  not found, or not owned by the caller (indistinguishable on purpose)
--   LF409  refused because history must be kept (handover or claims exist)
--   42501  no signed-in user
\set ON_ERROR_STOP on

SELECT current_database() ~ '^smart_lost_found(_test|_demo)?$' AS allowed_database \gset
\if :allowed_database
\else
    \echo 'STOP: connect to smart_lost_found, smart_lost_found_test or smart_lost_found_demo.'
    \quit 1
\endif

BEGIN;

-- Withdraw one's own claim and its weak-entity evidence rows.
CREATE OR REPLACE PROCEDURE public.withdraw_claim(
    IN p_claim_id INTEGER,
    OUT p_removed_evidence INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user INTEGER := public.app_current_user_id();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Sign in to withdraw a claim' USING ERRCODE = '42501';
    END IF;

    -- Lock order FOUND_REPORT, then CLAIM: the same order as evidence and
    -- handover (app/actions), so a concurrent handover and withdrawal
    -- serialise on the found report instead of deadlocking.
    PERFORM 1
    FROM public."FOUND_REPORT" AS f
    JOIN public."CLAIM" AS c ON c."Found_ID" = f."Found_ID"
    WHERE c."Claim_ID" = p_claim_id AND c."User_ID" = v_user
    FOR UPDATE OF f;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found or unavailable to your account' USING ERRCODE = 'LF404';
    END IF;

    PERFORM 1 FROM public."CLAIM"
    WHERE "Claim_ID" = p_claim_id AND "User_ID" = v_user
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found or unavailable to your account' USING ERRCODE = 'LF404';
    END IF;

    -- The HANDOVER foreign key (NO ACTION) would reject the DELETE as well.
    IF EXISTS (SELECT 1 FROM public."HANDOVER" WHERE "Claim_ID" = p_claim_id) THEN
        RAISE EXCEPTION 'This claim has a recorded handover and cannot be withdrawn' USING ERRCODE = 'LF409';
    END IF;

    -- Children first: CLAIM_EVIDENCE references CLAIM without cascading.
    DELETE FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = p_claim_id;
    GET DIAGNOSTICS p_removed_evidence = ROW_COUNT;
    DELETE FROM public."CLAIM" WHERE "Claim_ID" = p_claim_id AND "User_ID" = v_user;
END;
$$;

-- Delete one's own lost or found report. Its Embedding is a column of the
-- deleted row, so the stored vector is removed with it.
--   lost:  MATCHES rows go through ON DELETE CASCADE.
--   found: refused while any user has a claim on it, so claims, evidence and
--          handovers are never lost; FOUND_PHOTOS and MATCHES cascade. The
--          CLAIM foreign key (NO ACTION) is the database backstop.
CREATE OR REPLACE PROCEDURE public.delete_own_report(
    IN p_report_type TEXT,
    IN p_report_id INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user INTEGER := public.app_current_user_id();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Sign in to delete a report' USING ERRCODE = '42501';
    END IF;

    IF p_report_type = 'lost' THEN
        DELETE FROM public."LOST_REPORT"
        WHERE "Lost_ID" = p_report_id AND "User_ID" = v_user;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Report not found or unavailable to your account' USING ERRCODE = 'LF404';
        END IF;
    ELSIF p_report_type = 'found' THEN
        -- Same lock createClaim takes first, so a claim cannot slip in between
        -- the check below and the DELETE.
        PERFORM 1 FROM public."FOUND_REPORT"
        WHERE "Found_ID" = p_report_id AND "User_ID" = v_user
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Report not found or unavailable to your account' USING ERRCODE = 'LF404';
        END IF;
        -- Claims belong to other users (RLS hides them), so ask the owner-only helper.
        IF public.found_report_claim_count(p_report_id) > 0 THEN
            RAISE EXCEPTION 'This found report has claims and cannot be deleted' USING ERRCODE = 'LF409';
        END IF;
        DELETE FROM public."FOUND_REPORT"
        WHERE "Found_ID" = p_report_id AND "User_ID" = v_user;
    ELSE
        RAISE EXCEPTION 'p_report_type must be lost or found' USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON PROCEDURE public.withdraw_claim(INTEGER, INTEGER),
    public.delete_own_report(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE public.withdraw_claim(INTEGER, INTEGER),
    public.delete_own_report(TEXT, INTEGER) TO lf_user;

COMMIT;
