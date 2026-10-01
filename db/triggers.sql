-- Run after db/schema.sql with psql -X -v ON_ERROR_STOP=1 -f db/triggers.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.invalidate_report_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
    IF NEW."Item_Name" IS DISTINCT FROM OLD."Item_Name"
        OR NEW."Description" IS DISTINCT FROM OLD."Description" THEN
        NEW."Embedding" := NULL;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_lost_report_invalidate_embedding
BEFORE UPDATE OF "Item_Name", "Description"
ON public."LOST_REPORT"
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_report_embedding();

CREATE OR REPLACE TRIGGER trg_found_report_invalidate_embedding
BEFORE UPDATE OF "Item_Name", "Description"
ON public."FOUND_REPORT"
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_report_embedding();

COMMIT;
