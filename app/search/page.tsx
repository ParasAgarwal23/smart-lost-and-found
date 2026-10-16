import type { Metadata } from "next";
import Link from "next/link";
import { getAuthenticatedUser } from "@/lib/auth";
import { getFoundReportContext, type FoundReportContext } from "@/lib/found-report-context";
import { getReportOptions } from "@/lib/reference-data";
import { searchReports } from "@/lib/search";
import ClaimLink from "@/app/claim/claim-link";
import { Icon } from "@/components/icons";
import { EmptyState, formatDate, Notice, placeLabel, ReportTypeBadge } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search" };

type SearchParams = Record<string, string | string[] | undefined>;
const FILTER_KEYS = ["text", "category", "location", "type", "sort"] as const;

export default async function SearchPage({ searchParams }: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await getAuthenticatedUser();
  // Arrays remain invalid for server validation; display only single values.
  const value = (name: string) => typeof params[name] === "string" ? params[name] : "";
  const [options, result] = await Promise.all([
    getReportOptions()
      .then((loaded) => ({ ...loaded, error: null }))
      .catch(() => ({ categories: [], locations: [], error: "Unable to load filter options. Please try again later." })),
    searchReports({ text: params.text, category: params.category, location: params.location,
      type: params.type, sort: params.sort }),
  ]);

  let contexts: FoundReportContext[] = [];
  try {
    contexts = await getFoundReportContext(result.reports.filter((report) => report.Report_Type === "Found").map((report) => report.Report_ID), user?.User_ID ?? null);
  } catch { /* Results remain readable; claim links show an availability warning. */ }

  const type = value("type") || "Both";
  const moreFiltersActive = !!(value("category") || value("location") || value("sort") === "oldest");

  // Removable chips describing the active filters (each link drops one filter).
  const without = (key: string) => {
    const next = new URLSearchParams();
    for (const name of FILTER_KEYS) if (name !== key && value(name)) next.set(name, value(name));
    const query = next.toString();
    return query ? `/search?${query}` : "/search";
  };
  const chips: { key: string; label: string }[] = [];
  if (value("text")) chips.push({ key: "text", label: `“${value("text")}”` });
  if (value("type") && value("type") !== "Both") chips.push({ key: "type", label: `${value("type")} only` });
  const category = options.categories.find((option) => String(option.Category_ID) === value("category"));
  if (value("category")) chips.push({ key: "category", label: category?.Category_Name ?? "Selected category" });
  const location = options.locations.find((option) => String(option.Location_ID) === value("location"));
  if (value("location")) chips.push({ key: "location", label: location?.Location_Name ?? "Selected location" });
  if (value("sort") === "oldest") chips.push({ key: "sort", label: "Oldest first" });

  return (
    <main id="main-content" tabIndex={-1} className="container-page max-w-5xl py-8 sm:py-12">
      <h1 className="page-title">Search lost &amp; found items</h1>
      <p className="page-description">Everything reported on campus. Anyone can search; claiming an item needs an account.</p>

      <form action="/search" method="get" role="search" aria-label="Search reports" className="card mt-6 grid gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <label htmlFor="text" className="sr-only">Keywords</label>
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input id="text" name="text" type="search" defaultValue={value("text")} placeholder="Item name or description, e.g. blue bottle" className="input pl-10" />
          </div>
          <button type="submit" className="btn btn-primary">Search</button>
        </div>
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">Show</legend>
          <span aria-hidden="true" className="text-sm font-semibold text-ink-2">Show</span>
          <div className="segmented min-w-[16rem]">
            {[["Both", "All"], ["Lost", "Lost items"], ["Found", "Found items"]].map(([option, label]) => (
              <label key={option}>
                <input type="radio" name="type" value={option} defaultChecked={type === option} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <details open={moreFiltersActive} className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-brand">
            <Icon name="filter" size={15} />More filters<span className="sr-only"> (category, location, sort order)</span>
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div className="field">
              <label htmlFor="category" className="label">Category</label>
              <select id="category" name="category" defaultValue={value("category")} className="input">
                <option value="">All categories</option>
                {options.categories.map((option) => <option key={option.Category_ID} value={option.Category_ID}>{option.Category_Name ?? `Category ${option.Category_ID}`}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="location" className="label">Location</label>
              <select id="location" name="location" defaultValue={value("location")} className="input">
                <option value="">All locations</option>
                {options.locations.map((option) => <option key={option.Location_ID} value={option.Location_ID}>{option.Location_Name ?? `Location ${option.Location_ID}`}{option.Building ? ` (${option.Building})` : ""}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sort" className="label">Sort by date</label>
              <select id="sort" name="sort" defaultValue={value("sort") || "newest"} className="input">
                <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>
        </details>
      </form>

      <section aria-labelledby="results-heading" className="mt-8">
        {(options.error || result.error) && <Notice tone="error" className="mb-5">{options.error ?? result.error}</Notice>}
        {!result.error && <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 id="results-heading" className="text-lg font-bold" aria-live="polite">
              {result.reports.length} {result.reports.length === 1 ? "result" : "results"}
            </h2>
            {chips.length > 0 && (
              <ul aria-label="Active filters" className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <li key={chip.key}>
                    <Link href={without(chip.key)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-sm font-semibold text-ink-2 hover:bg-sunken">
                      {chip.label}<Icon name="close" size={14} /><span className="sr-only">(remove filter)</span>
                    </Link>
                  </li>
                ))}
                <li><Link href="/search" className="inline-flex min-h-9 items-center text-sm font-semibold text-ink-3 hover:text-ink">Clear filters</Link></li>
              </ul>
            )}
          </div>
          {result.reports.length === 0 ? (
            <div className="mt-5">
              <EmptyState icon="search" title="No reports match your search."
                actions={<>
                  <Link href="/search" className="btn btn-secondary btn-sm">Clear filters</Link>
                  <Link href="/lost-report" className="btn btn-primary btn-sm"><Icon name="plus" size={16} />Report a lost item</Link>
                </>}>
                Try fewer or different words, or show all categories and locations. If nobody has reported it yet, report it as lost so you can be matched later.
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {result.reports.map((report) => (
                <li key={`${report.Report_Type}-${report.Report_ID}`} className="min-w-0">
                  <article className={`card report-card h-full ${report.Report_Type === "Lost" ? "rail-lost" : "rail-found"}`}>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                      <ReportTypeBadge type={report.Report_Type} />
                      <span>{formatDate(report.Report_Date)} · {placeLabel(report.Location_Name, report.Building)}</span>
                    </p>
                    <h3 className="text-lg font-bold">{report.Item_Name ?? "Unnamed item"}</h3>
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm text-ink-2">{report.Description ?? "No description supplied."}</p>
                    <p className="text-xs text-ink-3"><span className="sr-only">Category: </span>{report.Category_Name ?? "Unnamed category"}</p>
                    <div className="card-actions">
                      {report.Report_Type === "Found"
                        ? <ClaimLink foundId={report.Report_ID} context={contexts.find((context) => context.Found_ID === report.Report_ID)} signedIn={!!user} />
                        : <Link href="/found-report" className="link-quiet"><Icon name="box" size={16} />Found this? Report it</Link>}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </>}
      </section>
    </main>
  );
}
