-- Run after db/schema.sql with psql -X -v ON_ERROR_STOP=1 -f db/views.sql.
BEGIN;

CREATE OR REPLACE VIEW public.v_lost_report_details AS
SELECT
    report."Lost_ID",
    report."User_ID",
    report."Category_ID",
    category."Category_Name",
    report."Location_ID",
    location."Location_Name",
    location."Building",
    report."Item_Name",
    report."Description",
    report."Date_Lost",
    report."Status"
FROM public."LOST_REPORT" AS report
JOIN public."CATEGORY" AS category
    ON category."Category_ID" = report."Category_ID"
JOIN public."LOCATION" AS location
    ON location."Location_ID" = report."Location_ID";

CREATE OR REPLACE VIEW public.v_found_report_details AS
SELECT
    report."Found_ID",
    report."User_ID",
    report."Category_ID",
    category."Category_Name",
    report."Location_ID",
    location."Location_Name",
    location."Building",
    report."Item_Name",
    report."Description",
    report."Date_Found",
    report."Status",
    COALESCE(photos."Photo_Count", 0::BIGINT) AS "Photo_Count"
FROM public."FOUND_REPORT" AS report
JOIN public."CATEGORY" AS category
    ON category."Category_ID" = report."Category_ID"
JOIN public."LOCATION" AS location
    ON location."Location_ID" = report."Location_ID"
LEFT JOIN (
    SELECT
        "Found_ID",
        COUNT(*) AS "Photo_Count"
    FROM public."FOUND_PHOTOS"
    GROUP BY "Found_ID"
) AS photos ON photos."Found_ID" = report."Found_ID";

COMMIT;
