import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import FoundReportForm from "./found-report-form";

export const runtime = "nodejs";

export default async function FoundReportPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  let categories: { Category_ID: number; Category_Name: string | null }[] = [];
  let locations: { Location_ID: number; Location_Name: string | null; Building: string | null }[] = [];
  let error: string | null = null;
  try {
    const [categoryResult, locationResult] = await Promise.all([
    query<{ Category_ID: number; Category_Name: string | null }>(
      'SELECT "Category_ID", "Category_Name" FROM public."CATEGORY" ORDER BY "Category_Name", "Category_ID"',
    ),
    query<{ Location_ID: number; Location_Name: string | null; Building: string | null }>(
      'SELECT "Location_ID", "Location_Name", "Building" FROM public."LOCATION" ORDER BY "Location_Name", "Location_ID"',
    ),
    ]);
    categories = categoryResult.rows;
    locations = locationResult.rows;
  } catch {
    error = "Unable to load categories and locations. Please reload this page to try again.";
  }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="mb-6 inline-block text-sm font-medium text-teal-700 underline hover:text-teal-800">
        ← Back to Home
      </Link>
      <section className="form-panel">
        <h1 className="page-title">Report a found item</h1>
        <p className="mt-2 text-sm text-slate-600">
          Describe the item and where and when you found it.
        </p>
        {error ? <p role="alert" className="mt-6 text-red-700">{error} <a href="/found-report" className="font-medium underline">Reload page</a></p>
          : <FoundReportForm categories={categories} locations={locations} />}
      </section>
    </main>
  );
}
