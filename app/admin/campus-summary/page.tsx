import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/next-path";
import { AuthorizationError, requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { Icon, type IconName } from "@/components/icons";
import { DateText, EmptyState, Notice, PageHeader, ReportTypeBadge } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campus Summary" };

type ReportGroup = { id: number; label: string | null; building: string | null; lost: string; found: string; total: string };
type RecentReport = { id: number; type: string; item: string | null; category: string | null; location: string | null; building: string | null; date: string | null };

const format = (value: string) => BigInt(value).toLocaleString("en-US");

function ReportBreakdown({ title, groups, dimension }: { title: string; groups: ReportGroup[]; dimension: string }) {
  const max = groups.reduce((largest, group) => Math.max(largest, Number(group.total)), 0);
  return (
    <section className="card card-pad min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="section-title">{title}</h3>
        <p className="flex gap-3 text-meta font-semibold text-ink-2" aria-hidden="true">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-lost" />Lost</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brand" />Found</span>
        </p>
      </div>
      {groups.length === 0 ? <p className="mt-5 text-ink-2">No {dimension.toLowerCase()} records are available.</p> : (
        <table aria-label={title} className="data-table mt-5 table-fixed">
          <thead><tr>
            <th scope="col" className="w-[52%]">{dimension}</th>
            <th scope="col" className="num">Lost</th>
            <th scope="col" className="num">Found</th>
            <th scope="col" className="num">Total</th>
          </tr></thead>
          <tbody>{groups.map(group => {
            const lostWidth = max ? (Number(group.lost) / max) * 100 : 0;
            const foundWidth = max ? (Number(group.found) / max) * 100 : 0;
            return (
              <tr key={group.id} data-group-id={group.id}>
                <th scope="row" className="text-left font-semibold">
                  {group.label ?? `Unnamed ${dimension.toLowerCase()}`}
                  {group.building && <span className="block text-meta font-normal text-ink-3">{group.building}</span>}
                  <span aria-hidden="true" className="mt-2 flex h-2 overflow-hidden rounded-full bg-sunken">
                    <span className="bg-lost" style={{ width: `${lostWidth}%` }} />
                    <span className="bg-brand" style={{ width: `${foundWidth}%` }} />
                  </span>
                </th>
                <td className="num text-lost-ink">{format(group.lost)}</td>
                <td className="num text-brand-ink">{format(group.found)}</td>
                <td className="num font-bold">{format(group.total)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </section>
  );
}

// Icon, colour and source table for each total (the note becomes a tooltip).
const statMeta: Record<string, { icon: IconName; tone: string; note: string }> = {
  "Total lost reports": { icon: "question", tone: "bg-lost-soft text-lost", note: "LOST_REPORT rows" },
  "Total found reports": { icon: "box", tone: "bg-brand-soft text-brand", note: "FOUND_REPORT rows" },
  "Total claims": { icon: "clipboard", tone: "bg-claim-soft text-claim", note: "CLAIM rows" },
  "Total handovers": { icon: "gift", tone: "bg-accent-soft text-accent-ink", note: "HANDOVER rows" },
};

export default async function CampusSummaryPage() {
  // Authorize before any aggregate query; the navigation link is not a guard.
  try {
    await requireRole("ADMIN");
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (error.status === 401) redirect(loginPath("/admin/campus-summary"));
    return (
      <main id="main-content" tabIndex={-1} className="container-page py-12">
        <div className="mx-auto max-w-xl">
          <EmptyState icon="lock" title="Access denied" actions={<Link href="/" className="btn btn-secondary btn-sm"><Icon name="home" size={16} />Back to Home</Link>}>
            <p role="alert">Campus Summary is available only to ADMIN accounts.</p>
          </EmptyState>
        </div>
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

  // Each found report can have at most one handover (enforced by the handover
  // transaction), so handovers / found reports is the share of items returned.
  const foundTotal = counts.length ? Number(counts[1].value) : 0;
  const handoverTotal = counts.length ? Number(counts[3].value) : 0;
  const returnRate = foundTotal > 0 ? Math.round((handoverTotal / foundTotal) * 100) : null;

  return (
    <main id="main-content" tabIndex={-1} className="container-page py-8 sm:py-12">
      <PageHeader eyebrow="ADMIN · READ ONLY" icon="shield" title="Campus Summary"
        description="Activity across campus. Totals update each time this page loads; individual claims and evidence stay private." />
      {error ? (
        <Notice tone="error" className="mt-8" action={<a href="/admin/campus-summary" className="btn btn-secondary btn-sm">Try again</a>}>{error}</Notice>
      ) : (
        <>
          <dl aria-label="Campus totals" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {counts.map(({ label, value }) => (
              <div key={label} title={statMeta[label].note} className="card relative p-5 pr-20">
                <dt className="text-sm font-semibold text-ink-2">{label}<span className={`absolute right-5 top-5 grid size-11 place-items-center rounded-xl ${statMeta[label].tone}`}><Icon name={statMeta[label].icon} size={20} /></span></dt>
                <dd className="font-display mt-2 text-4xl font-semibold tracking-tight tabular-nums">{format(value)}</dd>
              </div>
            ))}
          </dl>
          {returnRate !== null && (
            <div className="card mt-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
              <p className="shrink-0 text-sm font-semibold"><span className="font-display mr-2 text-2xl">{returnRate}%</span>of found items handed over</p>
              <div className="meter flex-1" role="img" aria-label={`${handoverTotal.toLocaleString("en-US")} of ${foundTotal.toLocaleString("en-US")} found reports have a recorded handover`}>
                <span style={{ width: `${Math.min(returnRate, 100)}%` }} />
              </div>
            </div>
          )}
        </>
      )}
      <section aria-labelledby="insights-heading" className="mt-12">
        <h2 id="insights-heading" className="font-display text-2xl font-semibold">Campus Insights</h2>
        <p className="mt-1 text-sm text-ink-2">Where things go missing and turn up, busiest first.</p>
        {insightsError ? <Notice tone="error" className="mt-5" action={<a href="/admin/campus-summary" className="btn btn-secondary btn-sm">Try again</a>}>{insightsError}</Notice> : (
          <div className="mt-5 grid items-start gap-5 xl:grid-cols-2">
            <ReportBreakdown title="Reports by Category" groups={categories} dimension="Category" />
            <ReportBreakdown title="Reports by Location" groups={locations} dimension="Location" />
          </div>
        )}
      </section>
      {!insightsError && <section aria-labelledby="activity-heading" className="card card-pad mt-8">
        <h2 id="activity-heading" className="section-title">Recent Campus Activity</h2>
        <p className="mt-1 text-sm text-ink-3">The 10 most recent reports, by the date the item was lost or found.</p>
        {recent.length === 0 ? <p className="mt-5 text-ink-2">No lost or found reports have been recorded yet.</p> : (
          <div role="region" aria-label="Recent report details" tabIndex={0} className="mt-5 overflow-x-auto rounded-lg">
            <table aria-label="Recent Campus Activity" className="data-table min-w-[38rem] table-fixed">
              <thead><tr>
                <th scope="col" className="w-[28%]">Item</th><th scope="col" className="w-[13%]">Type</th><th scope="col" className="w-[18%]">Category</th><th scope="col" className="w-[24%]">Location</th><th scope="col" className="w-[17%]">Lost/found date</th>
              </tr></thead>
              <tbody>{recent.map(report => <tr key={`${report.type}-${report.id}`} data-report-id={report.id} data-report-type={report.type}>
                <th scope="row" className="text-left font-semibold">{report.item ?? "Unnamed item"}</th>
                <td><ReportTypeBadge type={report.type} /></td>
                <td>{report.category ?? "Unnamed category"}</td>
                <td>{report.location ?? "Unnamed location"}{report.building && <span className="block text-meta text-ink-3">{report.building}</span>}</td>
                <td className="tabular-nums"><DateText value={report.date} /></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>}
    </main>
  );
}
