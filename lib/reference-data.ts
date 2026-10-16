import "server-only";

import { query } from "@/lib/db";

export type CategoryOption = { Category_ID: number; Category_Name: string | null };
export type LocationOption = { Location_ID: number; Location_Name: string | null; Building: string | null };

// Lookup rows for report forms and search filters (CATEGORY and LOCATION tables).
export async function getReportOptions(): Promise<{ categories: CategoryOption[]; locations: LocationOption[] }> {
  const [categories, locations] = await Promise.all([
    query<CategoryOption>(
      'SELECT "Category_ID", "Category_Name" FROM public."CATEGORY" ORDER BY "Category_Name", "Category_ID"',
    ),
    query<LocationOption>(
      'SELECT "Location_ID", "Location_Name", "Building" FROM public."LOCATION" ORDER BY "Location_Name", "Location_ID"',
    ),
  ]);
  return { categories: categories.rows, locations: locations.rows };
}

// The server's local calendar date as YYYY-MM-DD (used as the latest valid report date).
export function localToday(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
