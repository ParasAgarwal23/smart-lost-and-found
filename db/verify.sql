-- Read-only design verification; execute with psql -X -v ON_ERROR_STOP=1 -f db/verify.sql
-- after the full setup (see db/README.md for the order). Raises an error on the
-- first mismatch; otherwise prints a summary and the constraint/object listing.
-- Checks: tables, columns (types, NOT NULL, defaults, VECTOR(384)), primary,
-- foreign (including ON DELETE actions), UNIQUE and CHECK constraints,
-- indexes (B-tree and HNSW), views, functions, procedures (owners and
-- SECURITY DEFINER settings), triggers, and Row-Level Security.
-- Role/privilege checks live in db/verify_roles.sql.
BEGIN READ ONLY;
SET LOCAL search_path = public, pg_catalog;

DO $$
DECLARE
    expected RECORD;
    relation_oid OID;
    expected_tables TEXT[] := ARRAY['USER', 'CATEGORY', 'LOCATION',
        'LOST_REPORT', 'FOUND_REPORT', 'FOUND_PHOTOS', 'MATCHES',
        'CLAIM', 'HANDOVER', 'CLAIM_EVIDENCE'];
    rls_tables TEXT[] := ARRAY['LOST_REPORT', 'FOUND_REPORT', 'CLAIM', 'HANDOVER', 'CLAIM_EVIDENCE'];
    table_name TEXT;
BEGIN
    IF current_database() !~ '^smart_lost_found(_test|_demo)?$'
        OR current_setting('server_version_num')::integer / 10000 <> 18 THEN
        RAISE EXCEPTION 'Expected smart_lost_found, smart_lost_found_test or smart_lost_found_demo on PostgreSQL 18';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension
        WHERE extname = 'vector' AND extversion = '0.8.6'
    ) THEN
        RAISE EXCEPTION 'Expected enabled vector extension version 0.8.6';
    END IF;
    FOREACH table_name IN ARRAY expected_tables LOOP
        relation_oid := to_regclass(format('public.%I', table_name));
        IF relation_oid IS NULL OR NOT EXISTS (
            SELECT 1 FROM pg_class WHERE oid = relation_oid AND relkind = 'r'
        ) THEN
            RAISE EXCEPTION 'Missing ordinary table public.%', table_name;
        END IF;
        -- RLS is enabled on exactly the five workflow tables.
        IF (SELECT relrowsecurity FROM pg_class WHERE oid = relation_oid) <> (table_name = ANY(rls_tables)) THEN
            RAISE EXCEPTION 'Unexpected Row-Level Security state on public.%', table_name;
        END IF;
    END LOOP;

    -- Columns: type, NOT NULL, and default (NULL = no default).
    FOR expected IN
        SELECT * FROM (VALUES
        ('USER', 'User_ID', 'integer', true, NULL),
        ('USER', 'Name', 'character varying(100)', false, NULL),
        ('USER', 'Email', 'character varying(100)', false, NULL),
        ('USER', 'Phone', 'character varying(15)', false, NULL),
        ('USER', 'Role', 'character varying(20)', false, NULL),
        ('USER', 'Password_Hash', 'character varying(255)', true, NULL),
        ('CATEGORY', 'Category_ID', 'integer', true, NULL),
        ('CATEGORY', 'Category_Name', 'character varying(50)', false, NULL),
        ('LOCATION', 'Location_ID', 'integer', true, NULL),
        ('LOCATION', 'Location_Name', 'character varying(50)', false, NULL),
        ('LOCATION', 'Building', 'character varying(50)', false, NULL),
        ('LOST_REPORT', 'Lost_ID', 'integer', true, NULL),
        ('LOST_REPORT', 'User_ID', 'integer', true, NULL),
        ('LOST_REPORT', 'Category_ID', 'integer', true, NULL),
        ('LOST_REPORT', 'Location_ID', 'integer', true, NULL),
        ('LOST_REPORT', 'Item_Name', 'character varying(100)', false, NULL),
        ('LOST_REPORT', 'Description', 'text', false, NULL),
        ('LOST_REPORT', 'Date_Lost', 'date', false, NULL),
        ('LOST_REPORT', 'Status', 'character varying(20)', false, NULL),
        ('LOST_REPORT', 'Embedding', 'vector(384)', false, NULL),
        ('FOUND_REPORT', 'Found_ID', 'integer', true, NULL),
        ('FOUND_REPORT', 'User_ID', 'integer', true, NULL),
        ('FOUND_REPORT', 'Category_ID', 'integer', true, NULL),
        ('FOUND_REPORT', 'Location_ID', 'integer', true, NULL),
        ('FOUND_REPORT', 'Item_Name', 'character varying(100)', false, NULL),
        ('FOUND_REPORT', 'Description', 'text', false, NULL),
        ('FOUND_REPORT', 'Date_Found', 'date', false, NULL),
        ('FOUND_REPORT', 'Status', 'character varying(20)', false, NULL),
        ('FOUND_REPORT', 'Embedding', 'vector(384)', false, NULL),
        ('FOUND_PHOTOS', 'Found_ID', 'integer', true, NULL),
        ('FOUND_PHOTOS', 'Photo_URL', 'character varying(255)', true, NULL),
        ('MATCHES', 'Lost_ID', 'integer', true, NULL),
        ('MATCHES', 'Found_ID', 'integer', true, NULL),
        ('MATCHES', 'Match_Score', 'numeric(5,2)', false, NULL),
        ('MATCHES', 'Match_Status', 'character varying(20)', false, NULL),
        ('MATCHES', 'Match_Date', 'date', false, NULL),
        ('CLAIM', 'Claim_ID', 'integer', true, NULL),
        ('CLAIM', 'User_ID', 'integer', true, NULL),
        ('CLAIM', 'Found_ID', 'integer', true, NULL),
        ('CLAIM', 'Claim_Date', 'date', false, 'CURRENT_DATE'),
        ('CLAIM', 'Status', 'character varying(20)', false, NULL),
        ('HANDOVER', 'Handover_ID', 'integer', true, NULL),
        ('HANDOVER', 'Claim_ID', 'integer', true, NULL),
        ('HANDOVER', 'Handover_Date', 'date', false, 'CURRENT_DATE'),
        ('HANDOVER', 'Signature', 'character varying(100)', false, NULL),
        ('CLAIM_EVIDENCE', 'Claim_ID', 'integer', true, NULL),
        ('CLAIM_EVIDENCE', 'Evidence_No', 'integer', true, NULL),
        ('CLAIM_EVIDENCE', 'Evidence_Description', 'character varying(255)', false, NULL),
        ('CLAIM_EVIDENCE', 'File_Path', 'character varying(255)', false, NULL)
        ) AS approved(table_name, column_name, data_type, required, default_expression)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_attribute AS a
            LEFT JOIN pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = to_regclass(format('public.%I', expected.table_name))
                AND a.attname = expected.column_name
                AND a.attnum > 0 AND NOT a.attisdropped
                AND format_type(a.atttypid, a.atttypmod) = expected.data_type
                AND a.attnotnull = expected.required
                AND pg_get_expr(d.adbin, d.adrelid) IS NOT DISTINCT FROM expected.default_expression
                AND a.attidentity = '' AND a.attgenerated = ''
        ) THEN
            RAISE EXCEPTION 'Column type/nullability/default mismatch: %.%',
                expected.table_name, expected.column_name;
        END IF;
    END LOOP;

    IF (SELECT count(*) FROM pg_attribute AS a
        JOIN pg_class AS c ON c.oid = a.attrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY(expected_tables)
            AND a.attnum > 0 AND NOT a.attisdropped) <> 49 THEN
        RAISE EXCEPTION 'Expected exactly 49 approved columns across the ten tables';
    END IF;

    -- Constraints. FK definitions include their ON DELETE action, so the three
    -- CASCADE keys and the ten NO ACTION keys are each checked exactly.
    FOR expected IN
        SELECT * FROM (VALUES
        ('USER', 'p', 'PRIMARY KEY ("User_ID")'),
        ('CATEGORY', 'p', 'PRIMARY KEY ("Category_ID")'),
        ('LOCATION', 'p', 'PRIMARY KEY ("Location_ID")'),
        ('LOST_REPORT', 'p', 'PRIMARY KEY ("Lost_ID")'),
        ('FOUND_REPORT', 'p', 'PRIMARY KEY ("Found_ID")'),
        ('FOUND_PHOTOS', 'p', 'PRIMARY KEY ("Found_ID", "Photo_URL")'),
        ('MATCHES', 'p', 'PRIMARY KEY ("Lost_ID", "Found_ID")'),
        ('CLAIM', 'p', 'PRIMARY KEY ("Claim_ID")'),
        ('HANDOVER', 'p', 'PRIMARY KEY ("Handover_ID")'),
        ('CLAIM_EVIDENCE', 'p', 'PRIMARY KEY ("Claim_ID", "Evidence_No")'),
        ('LOST_REPORT', 'f', 'FOREIGN KEY ("User_ID") REFERENCES "USER"("User_ID")'),
        ('LOST_REPORT', 'f', 'FOREIGN KEY ("Category_ID") REFERENCES "CATEGORY"("Category_ID")'),
        ('LOST_REPORT', 'f', 'FOREIGN KEY ("Location_ID") REFERENCES "LOCATION"("Location_ID")'),
        ('FOUND_REPORT', 'f', 'FOREIGN KEY ("User_ID") REFERENCES "USER"("User_ID")'),
        ('FOUND_REPORT', 'f', 'FOREIGN KEY ("Category_ID") REFERENCES "CATEGORY"("Category_ID")'),
        ('FOUND_REPORT', 'f', 'FOREIGN KEY ("Location_ID") REFERENCES "LOCATION"("Location_ID")'),
        ('FOUND_PHOTOS', 'f', 'FOREIGN KEY ("Found_ID") REFERENCES "FOUND_REPORT"("Found_ID") ON DELETE CASCADE'),
        ('MATCHES', 'f', 'FOREIGN KEY ("Lost_ID") REFERENCES "LOST_REPORT"("Lost_ID") ON DELETE CASCADE'),
        ('MATCHES', 'f', 'FOREIGN KEY ("Found_ID") REFERENCES "FOUND_REPORT"("Found_ID") ON DELETE CASCADE'),
        ('CLAIM', 'f', 'FOREIGN KEY ("User_ID") REFERENCES "USER"("User_ID")'),
        ('CLAIM', 'f', 'FOREIGN KEY ("Found_ID") REFERENCES "FOUND_REPORT"("Found_ID")'),
        ('HANDOVER', 'f', 'FOREIGN KEY ("Claim_ID") REFERENCES "CLAIM"("Claim_ID")'),
        ('CLAIM_EVIDENCE', 'f', 'FOREIGN KEY ("Claim_ID") REFERENCES "CLAIM"("Claim_ID")'),
        ('HANDOVER', 'u', 'UNIQUE ("Claim_ID")'),
        -- Integrity constraints added 2026-10-16 and 2026-10-31 (db/constraints.sql).
        ('USER', 'u', 'UNIQUE ("Email")'),
        ('CLAIM', 'u', 'UNIQUE ("User_ID", "Found_ID")'),
        ('USER', 'c', 'CHECK ((("Role")::text = ANY ((ARRAY[''USER''::character varying, ''ADMIN''::character varying])::text[])))'),
        ('USER', 'c', 'CHECK ((("Email")::text ~ ''^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$''::text))'),
        ('USER', 'c', 'CHECK ((("Email")::text = lower(btrim(("Email")::text))))'),
        ('LOST_REPORT', 'c', 'CHECK ((btrim(("Item_Name")::text) <> ''''::text))'),
        ('FOUND_REPORT', 'c', 'CHECK ((btrim(("Item_Name")::text) <> ''''::text))'),
        ('CLAIM_EVIDENCE', 'c', 'CHECK (("Evidence_No" >= 1))')
        ) AS approved(table_name, constraint_type, definition)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            WHERE c.conrelid = to_regclass(format('public.%I', expected.table_name))
                AND c.contype::text = expected.constraint_type
                AND pg_get_constraintdef(c.oid) = expected.definition
                AND c.convalidated AND NOT c.condeferrable
                AND (c.contype <> 'f' OR c.confupdtype = 'a')
        ) THEN
            RAISE EXCEPTION 'Missing or incorrect constraint on %: %',
                expected.table_name, expected.definition;
        END IF;
    END LOOP;

    IF (SELECT count(*) FROM pg_constraint AS c
        JOIN pg_class AS t ON t.oid = c.conrelid
        JOIN pg_namespace AS n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = ANY(expected_tables)
            AND c.contype IN ('p', 'f', 'u', 'c', 'x')) <> 32 THEN
        RAISE EXCEPTION 'Expected only 10 primary keys, 13 foreign keys, 3 unique and 6 check constraints';
    END IF;

    -- Indexes beyond those created by constraints.
    FOR expected IN
        SELECT * FROM (VALUES
        ('idx_claim_found_id', 'CREATE INDEX idx_claim_found_id ON public."CLAIM" USING btree ("Found_ID")'),
        ('idx_matches_found_id', 'CREATE INDEX idx_matches_found_id ON public."MATCHES" USING btree ("Found_ID")'),
        ('idx_lost_report_embedding_hnsw', 'CREATE INDEX idx_lost_report_embedding_hnsw ON public."LOST_REPORT" USING hnsw ("Embedding" vector_cosine_ops)'),
        ('idx_found_report_embedding_hnsw', 'CREATE INDEX idx_found_report_embedding_hnsw ON public."FOUND_REPORT" USING hnsw ("Embedding" vector_cosine_ops)')
        ) AS approved(index_name, definition)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                       AND indexname = expected.index_name AND indexdef = expected.definition) THEN
            RAISE EXCEPTION 'Missing or incorrect index %', expected.index_name;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') <> 17 THEN
        RAISE EXCEPTION 'Expected 17 indexes (13 from keys/UNIQUE constraints, 2 B-tree, 2 HNSW)';
    END IF;

    -- Views and their owners (admin views run with lf_reporting's rights).
    FOR expected IN
        SELECT * FROM (VALUES
        ('v_lost_report_details', 'postgres'), ('v_found_report_details', 'postgres'),
        ('admin_campus_totals', 'lf_reporting'), ('admin_reports_by_category', 'lf_reporting'),
        ('admin_reports_by_location', 'lf_reporting'), ('admin_location_hotspots', 'lf_reporting'),
        ('admin_contested_items', 'lf_reporting')
        ) AS approved(view_name, owner)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_class
                       WHERE oid = to_regclass(format('public.%I', expected.view_name)) AND relkind = 'v'
                         AND (expected.owner = 'postgres' OR pg_get_userbyid(relowner) = expected.owner)) THEN
            RAISE EXCEPTION 'Missing view or wrong owner: %', expected.view_name;
        END IF;
    END LOOP;

    -- Functions ('f') and procedures ('p'): SECURITY DEFINER only where intended,
    -- each with its NOLOGIN owner and a fixed search_path.
    FOR expected IN
        SELECT * FROM (VALUES
        ('get_claim_summary', 'f', false, NULL),
        ('find_potential_matches', 'f', false, NULL),
        ('invalidate_report_embedding', 'f', false, NULL),
        ('app_current_user_id', 'f', false, NULL),
        ('auth_credentials', 'f', true, 'lf_auth'),
        ('auth_session_user', 'f', true, 'lf_auth'),
        ('register_user', 'f', true, 'lf_auth'),
        ('found_report_has_handover', 'f', true, 'lf_reporting'),
        ('found_report_claim_count', 'f', true, 'lf_reporting'),
        ('admin_daily_activity', 'f', true, 'lf_reporting'),
        ('withdraw_claim', 'p', false, NULL),
        ('delete_own_report', 'p', false, NULL)
        ) AS approved(routine_name, kind, security_definer, owner)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND proname = expected.routine_name
              AND prokind = expected.kind AND prosecdef = expected.security_definer
              AND (expected.owner IS NULL OR pg_get_userbyid(proowner) = expected.owner)
              AND (NOT prosecdef OR proconfig = ARRAY['search_path=pg_catalog, pg_temp'])
        ) THEN
            RAISE EXCEPTION 'Missing or incorrect routine %', expected.routine_name;
        END IF;
    END LOOP;

    -- Embedding-invalidation triggers (enabled, row-level BEFORE UPDATE).
    IF (SELECT count(*) FROM pg_trigger
        WHERE NOT tgisinternal AND tgenabled = 'O'
          AND tgname IN ('trg_lost_report_invalidate_embedding', 'trg_found_report_invalidate_embedding')
          AND tgfoid = 'public.invalidate_report_embedding()'::regprocedure) <> 2 THEN
        RAISE EXCEPTION 'Expected both embedding-invalidation triggers to be enabled';
    END IF;

    -- At least one RLS policy on each RLS table.
    FOREACH table_name IN ARRAY rls_tables LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name) THEN
            RAISE EXCEPTION 'No RLS policies on public.%', table_name;
        END IF;
    END LOOP;

    RAISE NOTICE 'PASS: 10 tables, 49 columns (2 CURRENT_DATE defaults, 2 VECTOR(384)), vector 0.8.6, 10 PKs, 13 FKs (3 ON DELETE CASCADE), 3 UNIQUE, 6 CHECK, 17 indexes (2 HNSW), 7 views, 10 functions, 2 procedures, 2 triggers, RLS on 5 tables';
END
$$;

SELECT t.relname AS table_name, c.contype AS constraint_type,
    pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint AS c
JOIN pg_class AS t ON t.oid = c.conrelid
JOIN pg_namespace AS n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
    AND t.relname IN ('USER', 'CATEGORY', 'LOCATION', 'LOST_REPORT',
        'FOUND_REPORT', 'FOUND_PHOTOS', 'MATCHES', 'CLAIM', 'HANDOVER', 'CLAIM_EVIDENCE')
    AND c.contype IN ('p', 'f', 'u', 'c')
ORDER BY t.relname, c.contype, definition;

COMMIT;
