-- Run after db/schema.sql with psql -X -v ON_ERROR_STOP=1 -f db/indexes.sql.
BEGIN;

CREATE INDEX idx_claim_found_id
ON public."CLAIM" USING btree ("Found_ID");

CREATE INDEX idx_matches_found_id
ON public."MATCHES" USING btree ("Found_ID");

COMMIT;
