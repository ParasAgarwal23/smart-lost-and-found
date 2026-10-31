-- Administrative campus analytics (revision 2026-10-31). Run after roles.sql:
--   psql -X -v ON_ERROR_STOP=1 -d smart_lost_found -f db/admin_reports.sql
-- Used by /admin/campus-summary through the read-only lf_admin_web login.
-- Every object is owned by the NOLOGIN role lf_reporting, which may read the
-- report, claim and handover tables (explicit RLS policies in roles.sql).
-- lf_admin receives SELECT/EXECUTE on these objects only: it has no access to
-- the underlying tables, to claimant identities or to evidence. Rerunnable.
\set ON_ERROR_STOP on

SELECT current_database() ~ '^smart_lost_found(_test|_demo)?$' AS allowed_database \gset
\if :allowed_database
\else
    \echo 'STOP: connect to smart_lost_found, smart_lost_found_test or smart_lost_found_demo.'
    \quit 1
\endif

BEGIN;

-- Four independent totals (scalar subqueries avoid one-to-many multiplication).
CREATE OR REPLACE VIEW public.admin_campus_totals AS
SELECT
    (SELECT COUNT(*) FROM public."LOST_REPORT") AS lost_reports,
    (SELECT COUNT(*) FROM public."FOUND_REPORT") AS found_reports,
    (SELECT COUNT(*) FROM public."CLAIM") AS claims,
    (SELECT COUNT(*) FROM public."HANDOVER") AS handovers;

-- Ordinary CTE + UNION ALL + LEFT JOIN + GROUP BY + COUNT ... FILTER.
-- UNION ALL yields one row per report before grouping, so lost and found
-- reports are never joined to each other (which would multiply counts).
CREATE OR REPLACE VIEW public.admin_reports_by_category AS
WITH reports AS (
    SELECT "Category_ID" AS group_id, 'Lost'::TEXT AS type FROM public."LOST_REPORT"
    UNION ALL
    SELECT "Category_ID", 'Found' FROM public."FOUND_REPORT"
)
SELECT
    c."Category_ID" AS id,
    c."Category_Name" AS label,
    NULL::VARCHAR(50) AS building,
    COUNT(*) FILTER (WHERE r.type = 'Lost') AS lost,
    COUNT(*) FILTER (WHERE r.type = 'Found') AS found,
    COUNT(r.group_id) AS total
FROM public."CATEGORY" AS c
LEFT JOIN reports AS r ON r.group_id = c."Category_ID"
GROUP BY c."Category_ID", c."Category_Name";

CREATE OR REPLACE VIEW public.admin_reports_by_location AS
WITH reports AS (
    SELECT "Location_ID" AS group_id, 'Lost'::TEXT AS type FROM public."LOST_REPORT"
    UNION ALL
    SELECT "Location_ID", 'Found' FROM public."FOUND_REPORT"
)
SELECT
    l."Location_ID" AS id,
    l."Location_Name" AS label,
    l."Building" AS building,
    COUNT(*) FILTER (WHERE r.type = 'Lost') AS lost,
    COUNT(*) FILTER (WHERE r.type = 'Found') AS found,
    COUNT(r.group_id) AS total
FROM public."LOCATION" AS l
LEFT JOIN reports AS r ON r.group_id = l."Location_ID"
GROUP BY l."Location_ID", l."Location_Name", l."Building";

-- Loss hotspots: locations whose lost + found report count is above the
-- campus average per location. HAVING filters the groups using a nested
-- (non-correlated) scalar subquery: total reports / number of locations.
CREATE OR REPLACE VIEW public.admin_location_hotspots AS
WITH reports AS (
    SELECT "Location_ID" AS location_id, 'Lost'::TEXT AS type FROM public."LOST_REPORT"
    UNION ALL
    SELECT "Location_ID", 'Found' FROM public."FOUND_REPORT"
)
SELECT
    l."Location_ID" AS id,
    l."Location_Name" AS label,
    l."Building" AS building,
    COUNT(*) FILTER (WHERE r.type = 'Lost') AS lost,
    COUNT(*) FILTER (WHERE r.type = 'Found') AS found,
    COUNT(*) AS total,
    ROUND((SELECT COUNT(*) FROM reports)::NUMERIC
          / NULLIF((SELECT COUNT(*) FROM public."LOCATION"), 0), 2) AS campus_average
FROM public."LOCATION" AS l
JOIN reports AS r ON r.location_id = l."Location_ID"
GROUP BY l."Location_ID", l."Location_Name", l."Building"
HAVING COUNT(*) > (SELECT COUNT(*) FROM reports)::NUMERIC
                  / NULLIF((SELECT COUNT(*) FROM public."LOCATION"), 0);

-- Contested items: found reports claimed by at least two different users.
-- HAVING keeps only those groups; the correlated EXISTS reports whether any
-- of the claims has been resolved by a handover. No claimant identities.
CREATE OR REPLACE VIEW public.admin_contested_items AS
SELECT
    f."Found_ID" AS id,
    f."Item_Name" AS item,
    l."Location_Name" AS location,
    l."Building" AS building,
    f."Date_Found" AS date_found,
    COUNT(c."Claim_ID") AS claims,
    COUNT(DISTINCT c."User_ID") AS claimants,
    MIN(c."Claim_Date") AS first_claim,
    MAX(c."Claim_Date") AS latest_claim,
    EXISTS (
        SELECT 1
        FROM public."CLAIM" AS handed
        JOIN public."HANDOVER" AS h ON h."Claim_ID" = handed."Claim_ID"
        WHERE handed."Found_ID" = f."Found_ID"
    ) AS resolved
FROM public."FOUND_REPORT" AS f
JOIN public."CLAIM" AS c ON c."Found_ID" = f."Found_ID"
JOIN public."LOCATION" AS l ON l."Location_ID" = f."Location_ID"
GROUP BY f."Found_ID", f."Item_Name", l."Location_Name", l."Building", f."Date_Found"
HAVING COUNT(DISTINCT c."User_ID") >= 2;

-- Daily activity timeline. The recursive CTE builds a continuous calendar of
-- p_days dates ending today (anchor = first day, recursive step = day + 1),
-- so days with no reports, claims or handovers still appear with zeros; a
-- plain GROUP BY date would skip them. Each event table is grouped by date
-- and LEFT JOINed onto the calendar.
CREATE OR REPLACE FUNCTION public.admin_daily_activity(p_days INTEGER)
RETURNS TABLE (
    day DATE,
    lost_reports BIGINT,
    found_reports BIGINT,
    claims BIGINT,
    handovers BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
BEGIN
    IF p_days IS NULL OR p_days < 7 OR p_days > 366 THEN
        RAISE EXCEPTION 'p_days must be between 7 and 366' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH RECURSIVE calendar (day) AS (
        SELECT CURRENT_DATE - (p_days - 1)       -- anchor member
        UNION ALL
        SELECT calendar.day + 1                  -- recursive member
        FROM calendar
        WHERE calendar.day < CURRENT_DATE        -- termination condition
    )
    SELECT
        calendar.day,
        COALESCE(lost.n, 0),
        COALESCE(found.n, 0),
        COALESCE(claimed.n, 0),
        COALESCE(handed.n, 0)
    FROM calendar
    LEFT JOIN (SELECT "Date_Lost" AS d, COUNT(*) AS n FROM public."LOST_REPORT" GROUP BY "Date_Lost") AS lost
        ON lost.d = calendar.day
    LEFT JOIN (SELECT "Date_Found" AS d, COUNT(*) AS n FROM public."FOUND_REPORT" GROUP BY "Date_Found") AS found
        ON found.d = calendar.day
    LEFT JOIN (SELECT "Claim_Date" AS d, COUNT(*) AS n FROM public."CLAIM" GROUP BY "Claim_Date") AS claimed
        ON claimed.d = calendar.day
    LEFT JOIN (SELECT "Handover_Date" AS d, COUNT(*) AS n FROM public."HANDOVER" GROUP BY "Handover_Date") AS handed
        ON handed.d = calendar.day
    ORDER BY calendar.day;
END;
$$;

ALTER VIEW public.admin_campus_totals OWNER TO lf_reporting;
ALTER VIEW public.admin_reports_by_category OWNER TO lf_reporting;
ALTER VIEW public.admin_reports_by_location OWNER TO lf_reporting;
ALTER VIEW public.admin_location_hotspots OWNER TO lf_reporting;
ALTER VIEW public.admin_contested_items OWNER TO lf_reporting;
ALTER FUNCTION public.admin_daily_activity(INTEGER) OWNER TO lf_reporting;

REVOKE ALL ON TABLE public.admin_campus_totals, public.admin_reports_by_category,
    public.admin_reports_by_location, public.admin_location_hotspots,
    public.admin_contested_items
FROM PUBLIC;
GRANT SELECT ON TABLE public.admin_campus_totals, public.admin_reports_by_category,
    public.admin_reports_by_location, public.admin_location_hotspots,
    public.admin_contested_items
TO lf_admin;
REVOKE ALL ON FUNCTION public.admin_daily_activity(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_daily_activity(INTEGER) TO lf_admin;

COMMIT;
