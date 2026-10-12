import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthorizationError, requireRole } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportGroup = { id: number; label: string | null; building: string | null; lost: string; found: string; total: string };
type RecentReport = { id: number; type: string; item: string | null; category: string | null; location: string | null; building: string | null; date: string | null };

function ReportBreakdown({ title, groups, dimension }: { title: string; groups: ReportGroup[]; dimension: string }) {
  return (
    <section className="form-panel min-w-0">
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">Highest report counts first. Includes groups with no reports.</p>
      {groups.length === 0 ? <p className="mt-5 text-slate-600">No {dimension.toLowerCase()} records are available.</p> : (
        <table aria-label={title} className="mt-5 w-full table-fixed text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-slate-600">
            <th scope="col" className="w-[46%] pb-3 pr-2 font-medium">{dimension}</th>
            <th scope="col" className="pb-3 text-right font-medium">Lost</th>
            <th scope="col" className="pb-3 text-right font-medium">Found</th>
            <th scope="col" className="pb-3 text-right font-medium">Total</th>
          </tr></thead>
          <tbody>{groups.map(group => <tr key={group.id} data-group-id={group.id} className="border-b border-slate-100 last:border-0">
            <th scope="row" className="break-words py-3 pr-2 text-left font-medium [overflow-wrap:anywhere]">{group.label ?? `Unnamed ${dimension.toLowerCase()}`}{group.building && <span className="mt-1 block text-xs font-normal text-slate-500">{group.building}</span>}</th>
            <td className="py-3 text-right tabular-nums text-amber-800 [overflow-wrap:anywhere]">{BigInt(group.lost).toLocaleString("en-US")}</td>
            <td className="py-3 text-right tabular-nums text-teal-800 [overflow-wrap:anywhere]">{BigInt(group.found).toLocaleString("en-US")}</td>
            <td className="py-3 text-right font-bold tabular-nums [overflow-wrap:anywhere]">{BigInt(group.total).toLocaleString("en-US")}</td>
          </tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

export default async function CampusSummaryPage() {
  // Authorize before any aggregate query; the navigation link is not a guard.
  try {
    await requireRole("ADMIN");
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (error.status === 401) redirect("/login");
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <section className="form-panel">
          <h1 className="page-title">Access denied</h1>
          <p role="alert" className="mt-4 text-slate-600">Campus Summary is available only to ADMIN accounts.</p>
          <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-medium text-teal-700 underline">Back to Home</Link>
        </section>
      </main>
    );
  }

  let counts: { label: string; value: string }[] = [];
  let error: string | null = null;
  try {
    // Independent counts avoid multiplying records through one-to-many joins.
    const [lost, found, claims, handovers] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public."LOST_REPORT"'),
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public."FOUND_REPORT"'),
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public."CLAIM"'),
      query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public."HANDOVER"'),
    ]);
    counts = [
      { label: "Total lost reports", value: lost.rows[0].count },
      { label: "Total found reports", value: found.rows[0].count },
      { label: "Total claims", value: claims.rows[0].count },
      { label: "Total handovers", value: handovers.rows[0].count },
    ];
  } catch {
    error = "Unable to load campus totals. Please try again.";
  }

  let categories: ReportGroup[] = [];
  let locations: ReportGroup[] = [];
  let recent: RecentReport[] = [];
  let insightsError: string | null = null;
  try {
    // UNION ALL creates one row per report before grouping; never join the
    // two report tables together, which would multiply their counts.
    const [categoryResult, locationResult, recentResult] = await Promise.all([
      query<ReportGroup>(`WITH reports AS (
        SELECT "Category_ID" AS group_id, 'Lost' AS type FROM public."LOST_REPORT"
        UNION ALL SELECT "Category_ID", 'Found' FROM public."FOUND_REPORT"
      )
      SELECT c."Category_ID" AS id, c."Category_Name" AS label, NULL::text AS building,
             COUNT(*) FILTER (WHERE r.type = 'Lost')::text AS lost,
             COUNT(*) FILTER (WHERE r.type = 'Found')::text AS found,
             COUNT(r.group_id)::text AS total
      FROM public."CATEGORY" c LEFT JOIN reports r ON r.group_id = c."Category_ID"
      GROUP BY c."Category_ID", c."Category_Name"
      ORDER BY COUNT(r.group_id) DESC, c."Category_Name" NULLS LAST, c."Category_ID"`),
      query<ReportGroup>(`WITH reports AS (
        SELECT "Location_ID" AS group_id, 'Lost' AS type FROM public."LOST_REPORT"
        UNION ALL SELECT "Location_ID", 'Found' FROM public."FOUND_REPORT"
      )
      SELECT l."Location_ID" AS id, l."Location_Name" AS label, l."Building" AS building,
             COUNT(*) FILTER (WHERE r.type = 'Lost')::text AS lost,
             COUNT(*) FILTER (WHERE r.type = 'Found')::text AS found,
             COUNT(r.group_id)::text AS total
      FROM public."LOCATION" l LEFT JOIN reports r ON r.group_id = l."Location_ID"
      GROUP BY l."Location_ID", l."Location_Name", l."Building"
      ORDER BY COUNT(r.group_id) DESC, l."Location_Name" NULLS LAST, l."Location_ID"`),
      query<RecentReport>(`WITH reports AS (
        SELECT "Lost_ID" AS id, 'Lost' AS type, "Item_Name" AS item,
               "Category_Name" AS category, "Location_Name" AS location, "Building" AS building, "Date_Lost" AS report_date
        FROM public.v_lost_report_details
        UNION ALL
        SELECT "Found_ID", 'Found', "Item_Name", "Category_Name", "Location_Name", "Building", "Date_Found"
        FROM public.v_found_report_details
      )
      SELECT id, type, item, category, location, building, report_date::text AS date
      FROM reports ORDER BY report_date DESC NULLS LAST, id DESC, type ASC LIMIT $1`, [10]),
    ]);
    categories = categoryResult.rows;
    locations = locationResult.rows;
    recent = recentResult.rows;
  } catch {
    insightsError = "Unable to load campus insights and recent activity. Please try again.";
  }

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="mb-6 inline-flex min-h-11 items-center text-sm font-medium text-teal-700 underline">Back to Home</Link>
      <p className="eyebrow">ADMIN · READ ONLY</p>
      <h1 className="page-title mt-3">Campus Summary</h1>
      <p className="page-description">Live totals of reports, claims, and recorded handovers across campus. Explore report patterns and recent lost/found activity. Individual claims and evidence remain private.</p>
      {error ? (
        <section className="form-panel mt-6">
          <p role="alert" className="text-red-700">{error}</p>
          <a href="/admin/campus-summary" className="mt-3 inline-flex min-h-11 items-center font-medium text-teal-700 underline">Try again</a>
        </section>
      ) : (
        <dl aria-label="Campus totals" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {counts.map(({ label, value }) => (
            <div key={label} className="form-panel">
              <dt className="text-sm font-medium text-slate-600">{label}</dt>
              <dd className="mt-3 break-words text-4xl font-bold tracking-tight text-teal-800">{BigInt(value).toLocaleString("en-US")}</dd>
            </div>
          ))}
        </dl>
      )}
      <section aria-labelledby="insights-heading" className="mt-10">
        <h2 id="insights-heading" className="text-2xl font-semibold">Campus Insights</h2>
        <p className="mt-2 text-sm text-slate-600">Lost and found reports grouped by their recorded category and campus location.</p>
        {insightsError ? <div className="form-panel mt-5"><p role="alert" className="text-red-700">{insightsError}</p><a href="/admin/campus-summary" className="mt-3 inline-flex min-h-11 items-center font-medium text-teal-700 underline">Try again</a></div> : (
          <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
            <ReportBreakdown title="Reports by Category" groups={categories} dimension="Category" />
            <ReportBreakdown title="Reports by Location" groups={locations} dimension="Location" />
          </div>
        )}
      </section>
      {!insightsError && <section aria-labelledby="activity-heading" className="form-panel mt-8">
        <h2 id="activity-heading" className="text-2xl font-semibold">Recent Campus Activity</h2>
        <p className="mt-2 text-sm text-slate-600">Up to 10 reports, newest lost/found date first. These are the dates items were lost or found, not submission timestamps.</p>
        {recent.length === 0 ? <p className="mt-5 text-slate-600">No lost or found reports have been recorded yet.</p> : (
          <div role="region" aria-label="Recent report details" tabIndex={0} className="mt-5 overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-teal-700">
            <table aria-label="Recent Campus Activity" className="w-full min-w-[36rem] table-fixed text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-slate-600">
                <th scope="col" className="w-[26%] px-2 pb-3 font-medium">Item</th><th scope="col" className="w-[14%] px-2 pb-3 font-medium">Type</th><th scope="col" className="w-[18%] px-2 pb-3 font-medium">Category</th><th scope="col" className="w-[24%] px-2 pb-3 font-medium">Location</th><th scope="col" className="w-[18%] px-2 pb-3 font-medium">Lost/found date</th>
              </tr></thead>
              <tbody>{recent.map(report => <tr key={`${report.type}-${report.id}`} data-report-id={report.id} data-report-type={report.type} className="border-b border-slate-100 last:border-0 [&_td]:break-words [&_td]:px-2 [&_td]:py-4 [&_td]:align-top [&_td]:[overflow-wrap:anywhere]">
                <th scope="row" className="break-words px-2 py-4 align-top font-medium [overflow-wrap:anywhere]">{report.item ?? "Unnamed item"}</th>
                <td><span className={`badge ${report.type === "Lost" ? "badge-lost" : ""}`}>{report.type}</span></td>
                <td>{report.category ?? "Unnamed category"}</td>
                <td>{report.location ?? "Unnamed location"}{report.building && <span className="mt-1 block text-xs text-slate-500">{report.building}</span>}</td>
                <td className="tabular-nums">{report.date ?? "Date not supplied"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>}
      <p className="mt-6 text-sm text-slate-600">Totals are retrieved when this page loads. A zero means no records exist for that category. Claims are requests, not proof of ownership.</p>
    </main>
  );
}
