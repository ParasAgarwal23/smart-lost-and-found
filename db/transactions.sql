-- Run with psql, after db/schema.sql. This is a demonstration, not project data.
-- Requires an empty smart_lost_found database and no concurrent application writes.
-- Negative IDs below are test identifiers only, not an ID-generation policy.
\set ON_ERROR_STOP on

SELECT current_database() = 'smart_lost_found'
    AND NOT EXISTS (SELECT 1 FROM public."USER")
    AND NOT EXISTS (SELECT 1 FROM public."CATEGORY")
    AND NOT EXISTS (SELECT 1 FROM public."LOCATION")
    AND NOT EXISTS (SELECT 1 FROM public."LOST_REPORT")
    AND NOT EXISTS (SELECT 1 FROM public."FOUND_REPORT")
    AND NOT EXISTS (SELECT 1 FROM public."FOUND_PHOTOS")
    AND NOT EXISTS (SELECT 1 FROM public."MATCHES")
    AND NOT EXISTS (SELECT 1 FROM public."CLAIM")
    AND NOT EXISTS (SELECT 1 FROM public."HANDOVER")
    AND NOT EXISTS (SELECT 1 FROM public."CLAIM_EVIDENCE") AS ready
\gset
\if :ready
\else
    \echo 'STOP: run only in the empty smart_lost_found demonstration database.'
    \quit 1
\endif

-- Minimal prerequisite fixtures for the required CLAIM foreign keys.
-- The password field is an unusable test placeholder, not a real credential.
-- No status values or other business rules are introduced.
BEGIN;
INSERT INTO public."USER" ("User_ID", "Password_Hash")
VALUES (-1, 'TRANSACTION_DEMO_NOT_A_USABLE_PASSWORD_HASH');
INSERT INTO public."CATEGORY" ("Category_ID") VALUES (-1);
INSERT INTO public."LOCATION" ("Location_ID") VALUES (-1);
INSERT INTO public."FOUND_REPORT"
    ("Found_ID", "User_ID", "Category_ID", "Location_ID")
VALUES (-1, -1, -1, -1);
COMMIT;

-- 1. Successful atomic creation: the claim and both evidence rows commit together.
BEGIN;
INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID")
VALUES (-1, -1, -1);
INSERT INTO public."CLAIM_EVIDENCE" ("Claim_ID", "Evidence_No")
VALUES (-1, 1), (-1, 2);
COMMIT;

-- Check committed rows after the transaction has ended.
SELECT (SELECT COUNT(*) FROM public."CLAIM" WHERE "Claim_ID" = -1) = 1
    AND (SELECT COUNT(*) FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = -1) = 2
    AS success_passed
\gset

-- 2. Failure: duplicate (Claim_ID, Evidence_No) violates the existing composite PK.
-- Temporarily allow psql to continue ONLY across the intentional error, so the
-- explicit ROLLBACK is reached. No SAVEPOINT is used: the entire claim transaction
-- must be discarded, including its first valid evidence insertion.
BEGIN;
INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID")
VALUES (-2, -1, -1);
INSERT INTO public."CLAIM_EVIDENCE" ("Claim_ID", "Evidence_No")
VALUES (-2, 1);
\set ON_ERROR_STOP off
INSERT INTO public."CLAIM_EVIDENCE" ("Claim_ID", "Evidence_No")
VALUES (-2, 1);
\set evidence_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK;

-- Expected SQLSTATE 23505 = unique_violation. Neither failed-transaction row remains.
SELECT :'evidence_sqlstate' = '23505'
    AND NOT EXISTS (SELECT 1 FROM public."CLAIM" WHERE "Claim_ID" = -2)
    AND NOT EXISTS (SELECT 1 FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = -2)
    AS rollback_passed
\gset

-- Cleanup the successfully committed example and its prerequisite fixtures.
-- Include both test claim IDs so cleanup still completes if an assertion fails.
BEGIN;
DELETE FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" IN (-1, -2);
DELETE FROM public."CLAIM" WHERE "Claim_ID" IN (-1, -2);
DELETE FROM public."FOUND_REPORT" WHERE "Found_ID" = -1;
DELETE FROM public."LOCATION" WHERE "Location_ID" = -1;
DELETE FROM public."CATEGORY" WHERE "Category_ID" = -1;
DELETE FROM public."USER" WHERE "User_ID" = -1;
COMMIT;

SELECT NOT EXISTS (SELECT 1 FROM public."USER")
    AND NOT EXISTS (SELECT 1 FROM public."CATEGORY")
    AND NOT EXISTS (SELECT 1 FROM public."LOCATION")
    AND NOT EXISTS (SELECT 1 FROM public."LOST_REPORT")
    AND NOT EXISTS (SELECT 1 FROM public."FOUND_REPORT")
    AND NOT EXISTS (SELECT 1 FROM public."FOUND_PHOTOS")
    AND NOT EXISTS (SELECT 1 FROM public."MATCHES")
    AND NOT EXISTS (SELECT 1 FROM public."CLAIM")
    AND NOT EXISTS (SELECT 1 FROM public."HANDOVER")
    AND NOT EXISTS (SELECT 1 FROM public."CLAIM_EVIDENCE") AS cleanup_passed
\gset

SELECT :'success_passed'::BOOLEAN AS committed_claim_and_two_evidence_rows,
    :'rollback_passed'::BOOLEAN AS failed_claim_and_evidence_rolled_back,
    :'cleanup_passed'::BOOLEAN AS all_application_tables_empty;

\if :success_passed
\else
    \echo 'FAIL: committed transaction verification failed.'
    \quit 1
\endif
\if :rollback_passed
\else
    \echo 'FAIL: expected constraint error or full rollback was not observed.'
    \quit 1
\endif
\if :cleanup_passed
    \echo 'PASS: commit, atomic rollback, and cleanup verified.'
\else
    \echo 'FAIL: cleanup verification failed.'
    \quit 1
\endif
