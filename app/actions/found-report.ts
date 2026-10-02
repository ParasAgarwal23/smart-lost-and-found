"use server";

import { randomInt } from "node:crypto";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";

export type FoundReportState = {
  error: string | null;
  success: string | null;
};

const databaseId = z.string().regex(/^-?\d+$/).transform(Number)
  .pipe(z.number().int().min(-2147483648).max(2147483647));
const reportSchema = z.object({
  itemName: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1),
  categoryId: databaseId,
  locationId: databaseId,
  dateFound: z.iso.date().refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value && !value.startsWith("0000-");
  }),
});

function isPrimaryKeyCollision(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "FOUND_REPORT_pkey";
}

export async function createFoundReport(
  _previousState: FoundReportState,
  formData: FormData,
): Promise<FoundReportState> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { error: "Please sign in to create a found report.", success: null };

    const parsed = reportSchema.safeParse({
      itemName: formData.get("itemName"),
      description: formData.get("description"),
      categoryId: formData.get("categoryId"),
      locationId: formData.get("locationId"),
      dateFound: formData.get("dateFound"),
    });
    if (!parsed.success) {
      return { error: "Enter valid values for all five fields.", success: null };
    }
    const fields = parsed.data;

    // Validate submitted choices against the current database, not UI options.
    const choices = await query<{ category_exists: boolean; location_exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM public."CATEGORY" WHERE "Category_ID" = $1) AS category_exists,
              EXISTS (SELECT 1 FROM public."LOCATION" WHERE "Location_ID" = $2) AS location_exists`,
      [fields.categoryId, fields.locationId],
    );
    if (!choices.rows[0]?.category_exists || !choices.rows[0]?.location_exists) {
      return { error: "Choose an existing category and location.", success: null };
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await query(
          `INSERT INTO public."FOUND_REPORT"
           ("Found_ID", "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", "Date_Found", "Status", "Embedding")
           VALUES ($1, $2, $3, $4, $5, $6, $7::date, NULL, NULL)`,
          [randomInt(1, 2147483648), user.User_ID, fields.categoryId,
            fields.locationId, fields.itemName, fields.description, fields.dateFound],
        );
        return { error: null, success: "Found report submitted successfully." };
      } catch (error) {
        // Retry only the approved randomly generated primary-key collision.
        if (!isPrimaryKeyCollision(error)) throw error;
      }
    }
  } catch {
    // Includes database/foreign-key failures without exposing internal details.
    return { error: "Unable to submit your report. Please try again.", success: null };
  }
  return { error: "Unable to submit your report. Please try again.", success: null };
}
