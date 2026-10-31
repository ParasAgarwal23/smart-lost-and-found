import "server-only";

import { query } from "@/lib/db";

export type FoundReportContext = {
  Found_ID: number;
  Item_Name: string | null;
  Category_Name: string | null;
  Location_Name: string | null;
  Building: string | null;
  Date_Found: string | null;
  Is_Own_Report: boolean;
  Own_Claim_ID: number | null;
  Has_Handover: boolean;
};

// Callers supply session identity. Never expose another claimant's ID or details.
// Anonymous visitors have no access to report owners or claims (db/roles.sql),
// so their variant reads only public columns.
export async function getFoundReportContext(foundIds: number[], userId: number | null) {
  if (foundIds.length === 0) return [];
  const result = userId === null
    ? await query<FoundReportContext>(
      `SELECT f."Found_ID", f."Item_Name", f."Category_Name", f."Location_Name", f."Building",
              f."Date_Found"::text AS "Date_Found", false AS "Is_Own_Report", NULL::integer AS "Own_Claim_ID",
              public.found_report_has_handover(f."Found_ID") AS "Has_Handover"
       FROM public.v_found_report_details f WHERE f."Found_ID" = ANY($1::integer[])`,
      [foundIds],
    )
    : await query<FoundReportContext>(
      `SELECT f."Found_ID", f."Item_Name", f."Category_Name", f."Location_Name", f."Building",
              f."Date_Found"::text AS "Date_Found",
              COALESCE(f."User_ID" = $2, false) AS "Is_Own_Report",
              (SELECT c."Claim_ID" FROM public."CLAIM" c
               WHERE c."Found_ID" = f."Found_ID" AND c."User_ID" = $2
               ORDER BY c."Claim_Date" DESC NULLS LAST, c."Claim_ID" DESC LIMIT 1) AS "Own_Claim_ID",
              public.found_report_has_handover(f."Found_ID") AS "Has_Handover"
       FROM public.v_found_report_details f WHERE f."Found_ID" = ANY($1::integer[])`,
      [foundIds, userId],
    );
  return result.rows;
}
