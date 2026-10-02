"use server";

import { z } from "zod";
import { query } from "@/lib/db";

const optionalId = z.union([
  z.literal(""),
  z.string().regex(/^-?\d+$/).transform(Number)
    .pipe(z.number().int().min(-2147483648).max(2147483647)),
]).default("").transform((value) => value === "" ? null : value);

const filtersSchema = z.object({
  text: z.string().trim().default(""),
  category: optionalId,
  location: optionalId,
  type: z.enum(["", "Both", "Lost", "Found"]).default("Both")
    .transform((value) => value || "Both"),
  sort: z.enum(["", "newest", "oldest"]).default("newest")
    .transform((value) => value || "newest"),
});

export type SearchReport = {
  Report_ID: number;
  Report_Type: "Lost" | "Found";
  Item_Name: string | null;
  Description: string | null;
  Category_Name: string | null;
  Location_Name: string | null;
  Report_Date: string | null;
};

export async function searchReports(input: unknown): Promise<{
  reports: SearchReport[];
  error: string | null;
}> {
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success) return { reports: [], error: "Choose valid search filters." };
  const filters = parsed.data;
  // Escape ILIKE wildcards so the text field searches literal substrings.
  const pattern = `%${filters.text.replace(/[\\%_]/g, "\\$&")}%`;

  try {
    const result = await query<SearchReport>(
      `WITH reports AS (
         SELECT "Lost_ID" AS "Report_ID", 'Lost'::text AS "Report_Type",
                "Item_Name", "Description", "Category_ID", "Location_ID", "Date_Lost" AS report_date
         FROM public."LOST_REPORT"
         UNION ALL
         SELECT "Found_ID", 'Found'::text, "Item_Name", "Description",
                "Category_ID", "Location_ID", "Date_Found"
         FROM public."FOUND_REPORT"
       )
       SELECT r."Report_ID", r."Report_Type", r."Item_Name", r."Description",
              c."Category_Name", l."Location_Name", r.report_date::text AS "Report_Date"
       FROM reports r
       JOIN public."CATEGORY" c ON c."Category_ID" = r."Category_ID"
       JOIN public."LOCATION" l ON l."Location_ID" = r."Location_ID"
       WHERE ($1::text = '' OR r."Item_Name" ILIKE $2::text OR r."Description" ILIKE $2::text)
         AND ($3::integer IS NULL OR r."Category_ID" = $3)
         AND ($4::integer IS NULL OR r."Location_ID" = $4)
         AND ($5::text = 'Both' OR r."Report_Type" = $5)
       ORDER BY
         CASE WHEN $6::text = 'oldest' THEN r.report_date END ASC NULLS LAST,
         CASE WHEN $6::text = 'newest' THEN r.report_date END DESC NULLS LAST,
         r."Report_Type", r."Report_ID"`,
      [filters.text, pattern, filters.category, filters.location, filters.type, filters.sort],
    );
    return { reports: result.rows, error: null };
  } catch {
    return { reports: [], error: "Unable to search reports. Please try again later." };
  }
}
