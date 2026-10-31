-- Run after db/schema.sql with psql -X -v ON_ERROR_STOP=1 -f db/functions.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_claim_summary(p_claim_id INTEGER)
RETURNS TABLE (
    "Claim_ID" INTEGER,
    "Found_ID" INTEGER,
    "Evidence_Count" BIGINT,
    "Handover_ID" INTEGER
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
    SELECT
        claim."Claim_ID",
        claim."Found_ID",
        (
            SELECT COUNT(*)
            FROM public."CLAIM_EVIDENCE" AS evidence
            WHERE evidence."Claim_ID" = claim."Claim_ID"
        ) AS "Evidence_Count",
        handover."Handover_ID"
    FROM public."CLAIM" AS claim
    LEFT JOIN public."HANDOVER" AS handover
        ON handover."Claim_ID" = claim."Claim_ID"
    WHERE claim."Claim_ID" = p_claim_id;
$$;

-- Identity of the signed-in application user for the current transaction.
-- lib/db.ts sets app.user_id with set_config(..., true) (transaction-local) from
-- the server-verified session; it is never taken from a browser field. Returns
-- NULL for anonymous requests. Used by RLS policies and the stored procedures.
CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::INTEGER;
$$;

COMMIT;
