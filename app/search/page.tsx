import Link from "next/link";
import { getAuthenticatedUser } from "@/lib/auth";
import { getFoundReportContext, type FoundReportContext } from "@/lib/found-report-context";
import ClaimLink from "@/app/claim/claim-link";
import { searchReports } from "@/app/actions/search";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const fieldClass = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700";

export default async function SearchPage({ searchParams }: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await getAuthenticatedUser();
  // Arrays remain invalid for server validation; display only single values.
  const value = (name: string) => typeof params[name] === "string" ? params[name] : "";
  const [options, result] = await Promise.all([
    (async () => {
      try {
        const [categories, locations] = await Promise.all([
          query<{ Category_ID: number; Category_Name: string | null }>(
            'SELECT "Category_ID", "Category_Name" FROM public."CATEGORY" ORDER BY "Category_Name", "Category_ID"',
          ),
          query<{ Location_ID: number; Location_Name: string | null; Building: string | null }>(
            'SELECT "Location_ID", "Location_Name", "Building" FROM public."LOCATION" ORDER BY "Location_Name", "Location_ID"',
          ),
        ]);
        return { categories: categories.rows, locations: locations.rows, error: null };
      } catch {
        return { categories: [], locations: [], error: "Unable to load filter options. Please try again later." };
      }
    })(),
    searchReports({ text: params.text, category: params.category, location: params.location,
      type: params.type, sort: params.sort }),
  ]);

  let contexts: FoundReportContext[] = [];
  try {
    contexts = await getFoundReportContext(result.reports.filter((report) => report.Report_Type === "Found").map((report) => report.Report_ID), user?.User_ID ?? null);
  } catch { /* Results remain readable; claim links show an availability warning. */ }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="mb-6 inline-block text-sm font-medium text-teal-700 underline hover:text-teal-800">
        ← Back to Home
      </Link>
      <h1 className="page-title">Search Lost &amp; Found</h1>
      <p className="page-description">Browse items reported around campus. Use a few distinctive words, then narrow your search.</p>
      <form action="/search" method="get" className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <label htmlFor="text" className="block text-sm font-medium">Item name or description</label>
          <input id="text" name="text" type="search" defaultValue={value("text")} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="category" className="block text-sm font-medium">Category</label>
          <select id="category" name="category" defaultValue={value("category")} className={fieldClass}>
            <option value="">All categories</option>
            {options.categories.map((category) => <option key={category.Category_ID} value={category.Category_ID}>{category.Category_Name ?? `Category ${category.Category_ID}`}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="location" className="block text-sm font-medium">Location</label>
          <select id="location" name="location" defaultValue={value("location")} className={fieldClass}>
            <option value="">All locations</option>
            {options.locations.map((location) => <option key={location.Location_ID} value={location.Location_ID}>{location.Location_Name ?? `Location ${location.Location_ID}`}{location.Building ? ` (${location.Building})` : ""}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="type" className="block text-sm font-medium">Report type</label>
          <select id="type" name="type" defaultValue={value("type") || "Both"} className={fieldClass}>
            <option value="Both">Both</option><option value="Lost">Lost</option><option value="Found">Found</option>
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="block text-sm font-medium">Sort by date</label>
          <select id="sort" name="sort" defaultValue={value("sort") || "newest"} className={fieldClass}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 sm:col-span-2">Search</button>
        <Link href="/search" className="inline-flex min-h-11 items-center justify-center font-medium text-teal-700 underline sm:col-span-2">Clear filters</Link>
      </form>
      {(options.error || result.error) && <p role="alert" className="mt-6 text-red-700">{options.error ?? result.error}</p>}
      {!result.error && (
        <section aria-label="Search results" className="results-grid mt-8">
          <p className="results-heading">{result.reports.length} report(s) found.</p>
          {result.reports.length === 0 && <p className="empty-panel">No reports match your search. Try fewer keywords, change the category or location, or <Link href="/search" className="font-medium text-teal-700 underline">clear all filters</Link>.</p>}
          {result.reports.map((report) => (
            <article key={`${report.Report_Type}-${report.Report_ID}`} className="item-card">
              <span className={`badge ${report.Report_Type === "Lost" ? "badge-lost" : ""}`}>{report.Report_Type} report</span>
              <h2 className="mt-3 text-xl font-semibold">{report.Item_Name ?? "Unnamed item"}</h2>
              <p className="mt-1 text-sm text-teal-700">{report.Report_Type} · {report.Report_Date ?? "Date not supplied"}</p>
              <p className="mt-2 whitespace-pre-wrap break-words">{report.Description ?? "No description supplied."}</p>
              <dl className="item-details">
                <div><dt className="inline font-medium">Category: </dt><dd className="inline">{report.Category_Name ?? "Unnamed category"}</dd></div>
                <div><dt className="inline font-medium">Location: </dt><dd className="inline">{report.Location_Name ?? "Unnamed location"}{report.Building ? ` (${report.Building})` : ""}</dd></div>
              </dl>
              {report.Report_Type === "Found" && <ClaimLink foundId={report.Report_ID} context={contexts.find((context) => context.Found_ID === report.Report_ID)} signedIn={!!user} />}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
