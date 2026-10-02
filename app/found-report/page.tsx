import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import FoundReportForm from "./found-report-form";

export const runtime = "nodejs";

export default async function FoundReportPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const [categories, locations] = await Promise.all([
    query<{ Category_ID: number; Category_Name: string | null }>(
      'SELECT "Category_ID", "Category_Name" FROM public."CATEGORY" ORDER BY "Category_Name", "Category_ID"',
    ),
    query<{ Location_ID: number; Location_Name: string | null; Building: string | null }>(
      'SELECT "Location_ID", "Location_Name", "Building" FROM public."LOCATION" ORDER BY "Location_Name", "Location_ID"',
    ),
  ]);

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Report a found item</h1>
        <p className="mt-2 text-sm text-slate-600">
          Describe your item and where and when you found it.
        </p>
        <FoundReportForm categories={categories.rows} locations={locations.rows} />
      </section>
    </main>
  );
}
