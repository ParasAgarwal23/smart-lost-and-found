-- pgvector extension setup. Run first, before db/schema.sql:
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/vector_setup.sql
-- pgvector is an extension inside this PostgreSQL server (not a separate
-- database). It adds the VECTOR type, the cosine-distance operator <=> and the
-- HNSW index method used by LOST_REPORT/FOUND_REPORT."Embedding".
-- Requires a role allowed to create extensions (the local postgres role).
-- Rerunnable: an existing installation of the expected version is accepted.
\set ON_ERROR_STOP on

DO $$
BEGIN
    IF current_database() !~ '^smart_lost_found(_test|_demo)?$' THEN
        RAISE EXCEPTION 'Connect to smart_lost_found, smart_lost_found_test or smart_lost_found_demo (connected to %)', current_database();
    END IF;
    IF current_setting('server_version_num')::integer / 10000 <> 18 THEN
        RAISE EXCEPTION 'PostgreSQL 18 is required (server is %)', current_setting('server_version');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_available_extension_versions
        WHERE name = 'vector' AND version = '0.8.6'
    ) THEN
        RAISE EXCEPTION 'pgvector 0.8.6 is not installed on this server. Install it, then rerun this script.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector' AND extversion <> '0.8.6') THEN
        RAISE EXCEPTION 'The vector extension is enabled with version %, but 0.8.6 is required',
            (SELECT extversion FROM pg_extension WHERE extname = 'vector');
    END IF;
END
$$;

-- The type and operators live in public so every script can write public.vector(384).
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public VERSION '0.8.6';

SELECT e.extname AS extension, e.extversion AS version, n.nspname AS schema
FROM pg_extension AS e
JOIN pg_namespace AS n ON n.oid = e.extnamespace
WHERE e.extname = 'vector';
