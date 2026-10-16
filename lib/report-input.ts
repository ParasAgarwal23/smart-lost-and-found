import "server-only";

import { z } from "zod";
import { query } from "@/lib/db";
import { localToday } from "@/lib/reference-data";

export type ReportKind = "lost" | "found";

// Shared by create and edit so lost and found reports follow identical rules.
export const DESCRIPTION_MAX = 2000;

export const databaseId = z.string().regex(/^-?\d+$/).transform(Number)
  .pipe(z.number().int().min(-2147483648).max(2147483647));

const isoDate = z.iso.date().refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value && !value.startsWith("0000-");
});

const reportFields = z.object({
  itemName: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(DESCRIPTION_MAX),
  categoryId: databaseId,
  locationId: databaseId,
  // ISO strings compare chronologically; an item cannot be lost or found tomorrow.
  reportDate: isoDate.refine((value) => value <= localToday(), { message: "future" }),
});

export type ReportFields = z.infer<typeof reportFields>;

export function dateFieldName(kind: ReportKind) {
  return kind === "lost" ? "dateLost" : "dateFound";
}

export function parseReportForm(kind: ReportKind, formData: FormData):
  { ok: true; fields: ReportFields } | { ok: false; fieldErrors: Record<string, string> } {
  const dateField = dateFieldName(kind);
  const parsed = reportFields.safeParse({
    itemName: formData.get("itemName"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    locationId: formData.get("locationId"),
    reportDate: formData.get(dateField),
  });
  if (parsed.success) return { ok: true, fields: parsed.data };

  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    if (fieldErrors[key === "reportDate" ? dateField : key]) continue;
    if (key === "itemName") fieldErrors.itemName = "Enter an item name of 1 to 100 characters.";
    if (key === "description") fieldErrors.description = `Enter a description of 1 to ${DESCRIPTION_MAX.toLocaleString("en-US")} characters.`;
    if (key === "categoryId") fieldErrors.categoryId = "Select a category.";
    if (key === "locationId") fieldErrors.locationId = "Select a location.";
    if (key === "reportDate") {
      fieldErrors[dateField] = issue.message === "future"
        ? "The date cannot be in the future."
        : `Enter a valid date ${kind === "lost" ? "lost" : "found"}.`;
    }
  }
  return { ok: false, fieldErrors };
}

// Validate submitted choices against the current database, not UI options.
export async function choicesExist(categoryId: number, locationId: number): Promise<boolean> {
  const choices = await query<{ category_exists: boolean; location_exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM public."CATEGORY" WHERE "Category_ID" = $1) AS category_exists,
            EXISTS (SELECT 1 FROM public."LOCATION" WHERE "Location_ID" = $2) AS location_exists`,
    [categoryId, locationId],
  );
  return !!choices.rows[0]?.category_exists && !!choices.rows[0]?.location_exists;
}

export function isPrimaryKeyCollision(error: unknown, constraint: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === constraint;
}
