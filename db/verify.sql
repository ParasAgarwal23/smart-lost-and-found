-- Read-only checks; execute with psql -X -v ON_ERROR_STOP=1 -f db/verify.sql.
BEGIN READ ONLY;
SET LOCAL search_path = public, pg_catalog;

DO $$
DECLARE
    expected RECORD;
    relation_oid OID;
    expected_tables TEXT[] := ARRAY['USER', 'CATEGORY', 'LOCATION',
        'LOST_REPORT', 'FOUND_REPORT', 'FOUND_PHOTOS', 'MATCHES',
        'CLAIM', 'HANDOVER', 'CLAIM_EVIDENCE'];
    table_name TEXT;
BEGIN
    IF current_database() <> 'smart_lost_found'
        OR current_setting('server_version_num')::integer / 10000 <> 18 THEN
        RAISE EXCEPTION 'Expected smart_lost_found on PostgreSQL 18';
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
    END LOOP;

    FOR expected IN
        SELECT * FROM (VALUES
        ('USER', 'User_ID', 'integer', true),
        ('USER', 'Name', 'character varying(100)', false),
        ('USER', 'Email', 'character varying(100)', false),
        ('USER', 'Phone', 'character varying(15)', false),
        ('USER', 'Role', 'character varying(20)', false),
        ('USER', 'Password_Hash', 'character varying(255)', true),
        ('CATEGORY', 'Category_ID', 'integer', true),
        ('CATEGORY', 'Category_Name', 'character varying(50)', false),
        ('LOCATION', 'Location_ID', 'integer', true),
        ('LOCATION', 'Location_Name', 'character varying(50)', false),
        ('LOCATION', 'Building', 'character varying(50)', false),
        ('LOST_REPORT', 'Lost_ID', 'integer', true),
        ('LOST_REPORT', 'User_ID', 'integer', true),
        ('LOST_REPORT', 'Category_ID', 'integer', true),
        ('LOST_REPORT', 'Location_ID', 'integer', true),
        ('LOST_REPORT', 'Item_Name', 'character varying(100)', false),
        ('LOST_REPORT', 'Description', 'text', false),
        ('LOST_REPORT', 'Date_Lost', 'date', false),
        ('LOST_REPORT', 'Status', 'character varying(20)', false),
        ('LOST_REPORT', 'Embedding', 'vector(384)', false),
        ('FOUND_REPORT', 'Found_ID', 'integer', true),
        ('FOUND_REPORT', 'User_ID', 'integer', true),
        ('FOUND_REPORT', 'Category_ID', 'integer', true),
        ('FOUND_REPORT', 'Location_ID', 'integer', true),
        ('FOUND_REPORT', 'Item_Name', 'character varying(100)', false),
        ('FOUND_REPORT', 'Description', 'text', false),
        ('FOUND_REPORT', 'Date_Found', 'date', false),
        ('FOUND_REPORT', 'Status', 'character varying(20)', false),
        ('FOUND_REPORT', 'Embedding', 'vector(384)', false),
        ('FOUND_PHOTOS', 'Found_ID', 'integer', true),
        ('FOUND_PHOTOS', 'Photo_URL', 'character varying(255)', true),
        ('MATCHES', 'Lost_ID', 'integer', true),
        ('MATCHES', 'Found_ID', 'integer', true),
        ('MATCHES', 'Match_Score', 'numeric(5,2)', false),
        ('MATCHES', 'Match_Status', 'character varying(20)', false),
        ('MATCHES', 'Match_Date', 'date', false),
        ('CLAIM', 'Claim_ID', 'integer', true),
        ('CLAIM', 'User_ID', 'integer', true),
        ('CLAIM', 'Found_ID', 'integer', true),
        ('CLAIM', 'Claim_Date', 'date', false),
        ('CLAIM', 'Status', 'character varying(20)', false),
        ('HANDOVER', 'Handover_ID', 'integer', true),
        ('HANDOVER', 'Claim_ID', 'integer', true),
        ('HANDOVER', 'Handover_Date', 'date', false),
        ('HANDOVER', 'Signature', 'character varying(100)', false),
        ('CLAIM_EVIDENCE', 'Claim_ID', 'integer', true),
        ('CLAIM_EVIDENCE', 'Evidence_No', 'integer', true),
        ('CLAIM_EVIDENCE', 'Evidence_Description', 'character varying(255)', false),
        ('CLAIM_EVIDENCE', 'File_Path', 'character varying(255)', false)
        ) AS approved(table_name, column_name, data_type, required)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_attribute AS a
            WHERE a.attrelid = to_regclass(format('public.%I', expected.table_name))
                AND a.attname = expected.column_name
                AND a.attnum > 0 AND NOT a.attisdropped
                AND format_type(a.atttypid, a.atttypmod) = expected.data_type
                AND a.attnotnull = expected.required
                AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = ''
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
        ('FOUND_PHOTOS', 'f', 'FOREIGN KEY ("Found_ID") REFERENCES "FOUND_REPORT"("Found_ID")'),
        ('MATCHES', 'f', 'FOREIGN KEY ("Lost_ID") REFERENCES "LOST_REPORT"("Lost_ID")'),
        ('MATCHES', 'f', 'FOREIGN KEY ("Found_ID") REFERENCES "FOUND_REPORT"("Found_ID")'),
        ('CLAIM', 'f', 'FOREIGN KEY ("User_ID") REFERENCES "USER"("User_ID")'),
        ('CLAIM', 'f', 'FOREIGN KEY ("Found_ID") REFERENCES "FOUND_REPORT"("Found_ID")'),
        ('HANDOVER', 'f', 'FOREIGN KEY ("Claim_ID") REFERENCES "CLAIM"("Claim_ID")'),
        ('CLAIM_EVIDENCE', 'f', 'FOREIGN KEY ("Claim_ID") REFERENCES "CLAIM"("Claim_ID")'),
        ('HANDOVER', 'u', 'UNIQUE ("Claim_ID")')
        ) AS approved(table_name, constraint_type, definition)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            WHERE c.conrelid = to_regclass(format('public.%I', expected.table_name))
                AND c.contype::text = expected.constraint_type
                AND pg_get_constraintdef(c.oid) = expected.definition
                AND c.convalidated AND NOT c.condeferrable
                AND (c.contype <> 'f' OR (c.confdeltype = 'a' AND c.confupdtype = 'a'))
        ) THEN
            RAISE EXCEPTION 'Missing or incorrect constraint on %: %',
                expected.table_name, expected.definition;
        END IF;
    END LOOP;

    IF (SELECT count(*) FROM pg_constraint AS c
        JOIN pg_class AS t ON t.oid = c.conrelid
        JOIN pg_namespace AS n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = ANY(expected_tables)
            AND c.contype IN ('p', 'f', 'u', 'c', 'x')) <> 24 THEN
        RAISE EXCEPTION 'Expected only 10 primary keys, 13 foreign keys, and 1 unique constraint';
    END IF;
    RAISE NOTICE 'PASS: ten tables, 49 columns, vector 0.8.6, both VECTOR(384) columns, approved NOT NULL constraints, 10 PKs, 13 FKs, and HANDOVER Claim_ID UNIQUE';
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
    AND c.contype IN ('p', 'f', 'u')
ORDER BY t.relname, c.contype, definition;

COMMIT;
