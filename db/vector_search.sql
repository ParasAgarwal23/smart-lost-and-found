-- Run after db/schema.sql with psql -X -v ON_ERROR_STOP=1 -f db/vector_search.sql.
-- Part 1: exact, read-only potential-match retrieval.
BEGIN;

CREATE OR REPLACE FUNCTION public.find_potential_matches(
    p_lost_id INTEGER,
    p_limit INTEGER
)
RETURNS TABLE (
    "Found_ID" INTEGER,
    "Item_Name" VARCHAR(100),
    "Description" TEXT,
    "Cosine_Similarity" DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
    query_embedding public.vector(384);
BEGIN
    -- A NULL limit would mean unlimited SQL retrieval; reject it explicitly.
    -- Zero requests no candidates. Negative limits are invalid query inputs.
    IF p_limit IS NULL OR p_limit < 0 THEN
        RAISE EXCEPTION 'p_limit must be a nonnegative integer'
            USING ERRCODE = '22023';
    END IF;
    IF p_limit = 0 THEN
        RETURN;
    END IF;

    SELECT lost."Embedding"
    INTO query_embedding
    FROM public."LOST_REPORT" AS lost
    WHERE lost."Lost_ID" = p_lost_id;

    IF query_embedding IS NULL OR public.vector_norm(query_embedding) = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    -- Materialize all eligible distances BEFORE sorting/limiting. This keeps
    -- retrieval exact even after HNSW indexes are installed: the outer ordering
    -- cannot become an approximate nearest-neighbor index scan on FOUND_REPORT.
    WITH scored_candidates AS MATERIALIZED (
        SELECT
            found."Found_ID" AS found_id,
            found."Item_Name" AS item_name,
            found."Description" AS description,
            found."Embedding" OPERATOR(public.<=>) query_embedding AS distance
        FROM public."FOUND_REPORT" AS found
        WHERE found."Embedding" IS NOT NULL
            AND public.vector_norm(found."Embedding") > 0
    )
    SELECT
        candidate.found_id,
        candidate.item_name,
        candidate.description,
        1::DOUBLE PRECISION - candidate.distance
    FROM scored_candidates AS candidate
    ORDER BY candidate.distance ASC, candidate.found_id ASC
    LIMIT p_limit;
END;
$$;

COMMIT;

-- Part 2: optional approximate-search indexes. These do not change the exact
-- function above. Direct distance ORDER BY ... LIMIT queries can use HNSW.
BEGIN;

CREATE INDEX idx_lost_report_embedding_hnsw
ON public."LOST_REPORT" USING hnsw ("Embedding" public.vector_cosine_ops);

CREATE INDEX idx_found_report_embedding_hnsw
ON public."FOUND_REPORT" USING hnsw ("Embedding" public.vector_cosine_ops);

COMMIT;
