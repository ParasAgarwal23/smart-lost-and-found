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

COMMIT;
