import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/next-path";
import { AuthorizationError, requireRole } from "@/lib/auth";
import { adminQuery } from "@/lib/admin-db";
import { Icon, type IconName } from "@/components/icons";
import { Badge, DateText, EmptyState, formatDate, Notice, PageHeader, ReportTypeBadge } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campus Summary" };

type ReportGroup = { id: number; label: string | null; building: string | null; lost: string; found: string; total: string };
type RecentReport = { id: number; type: string; item: string | null; category: string | null; location: string | null; building: string | null; date: string | null };
type DailyRow = { day: string; lost: number; found: number; claims: number; handovers: number };
type Hotspot = { id: number; label: string | null; building: string | null; lost: string; found: string; total: string; campus_average: string };
type Contested = { id: number; item: string | null; location: string | null; building: string | null; claims: string; claimants: string; first_claim: string | null; latest_claim: string | null; resolved: boolean };

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

const SERIES = [
  { key: "lost", label: "Lost", tone: "bg-lost" },
  { key: "found", label: "Found", tone: "bg-brand" },
  { key: "claims", label: "Claims", tone: "bg-claim" },
  { key: "handovers", label: "Handovers", tone: "bg-accent" },
] as const;

// One stacked column per calendar day from admin_daily_activity (a recursive
// CTE), so quiet days are visible as gaps rather than silently skipped.
function DailyActivity({ rows, days }: { rows: DailyRow[]; days: number }) {
  const sum = (row: DailyRow) => row.lost + row.found + row.claims + row.handovers;
  const max = Math.max(1, ...rows.map(sum));
  const quiet = rows.filter((row) => sum(row) === 0).length;
  const totals = SERIES.map((series) => ({ ...series, total: rows.reduce((acc, row) => acc + row[series.key], 0) }));
  return (
    <>
      <p className="mt-1 text-sm text-ink-2">
        {totals.map((series) => `${series.total.toLocaleString("en-US")} ${series.label.toLowerCase()}`).join(" · ")} in the last {days} days
        {" · "}<span className="font-semibold">{quiet} quiet {quiet === 1 ? "day" : "days"}</span> with no activity
      </p>
      <div role="img" aria-label={`Daily activity for the last ${days} days. ${quiet} days had no activity. The table below lists every day.`}
        className="mt-5 flex h-36 items-end gap-px border-b border-line">
        {rows.map((row) => (
          <div key={row.day} title={`${formatDate(row.day)}: ${row.lost} lost, ${row.found} found, ${row.claims} claims, ${row.handovers} handovers`}
            className="flex h-full min-w-0 flex-1 flex-col justify-end">
            {SERIES.map((series) => row[series.key] > 0 && (
              <span key={series.key} className={`${series.tone} block w-full first:rounded-t-sm`} style={{ height: `${(row[series.key] / max) * 100}%` }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-meta text-ink-3" aria-hidden="true">
        <span>{formatDate(rows[0]?.day)}</span><span>{formatDate(rows.at(-1)?.day)}</span>
      </div>
      <p className="mt-3 flex flex-wrap gap-3 text-meta font-semibold text-ink-2" aria-hidden="true">
        {SERIES.map((series) => <span key={series.key} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${series.tone}`} />{series.label}</span>)}
      </p>
      <details className="mt-4">
        <summary className="w-fit cursor-pointer text-sm font-bold text-brand">View as table</summary>
        <div role="region" aria-label="Daily activity table" tabIndex={0} className="mt-3 max-h-80 overflow-auto rounded-lg">
          <table aria-label="Daily activity" className="data-table min-w-[28rem]">
            <thead><tr><th scope="col">Date</th>{SERIES.map((series) => <th key={series.key} scope="col" className="num">{series.label}</th>)}</tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.day} data-day={row.day}>
                <th scope="row" className="text-left font-normal tabular-nums"><DateText value={row.day} /></th>
                {SERIES.map((series) => <td key={series.key} className={`num ${row[series.key] === 0 ? "text-ink-3" : "font-semibold"}`}>{row[series.key]}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </>
  );
}

// Icon, colour and source table for each total (the note becomes a tooltip).
const statMeta: Record<string, { icon: IconName; tone: string; note: string }> = {
  "Total lost reports": { icon: "question", tone: "bg-lost-soft text-lost", note: "LOST_REPORT rows" },
  "Total found reports": { icon: "box", tone: "bg-brand-soft text-brand", note: "FOUND_REPORT rows" },
  "Total claims": { icon: "clipboard", tone: "bg-claim-soft text-claim", note: "CLAIM rows" },
  "Total handovers": { icon: "gift", tone: "bg-accent-soft text-accent-ink", note: "HANDOVER rows" },
};

export default async function CampusSummaryPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const days = (await searchParams)?.days === "90" ? 90 : 30;
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

  // Every read below uses adminQuery: the read-only lf_admin_web login, which
  // can see only the admin_* objects (db/admin_reports.sql) and report views.
  let counts: { label: string; value: string }[] = [];
  let error: string | null = null;
  try {
    // Independent counts (scalar subqueries) avoid multiplying one-to-many joins.
    const totals = (await adminQuery<{ lost: string; found: string; claims: string; handovers: string }>(
      `SELECT lost_reports::text AS lost, found_reports::text AS found, claims::text AS claims, handovers::text AS handovers
       FROM public.admin_campus_totals`)).rows[0];
    counts = [
      { label: "Total lost reports", value: totals.lost },
      { label: "Total found reports", value: totals.found },
      { label: "Total claims", value: totals.claims },
      { label: "Total handovers", value: totals.handovers },
    ];
  } catch {
    error = "Unable to load campus totals. Please try again.";
  }

  let categories: ReportGroup[] = [];
  let locations: ReportGroup[] = [];
  let recent: RecentReport[] = [];
  let insightsError: string | null = null;
  try {
    // The category/location views group a UNION ALL CTE (one row per report),
    // so the two report tables are never joined to each other.
    const [categoryResult, locationResult, recentResult] = await Promise.all([
      adminQuery<ReportGroup>(`SELECT id, label, building, lost::text AS lost, found::text AS found, total::text AS total
      FROM public.admin_reports_by_category
      ORDER BY total DESC, label NULLS LAST, id`),
      adminQuery<ReportGroup>(`SELECT id, label, building, lost::text AS lost, found::text AS found, total::text AS total
      FROM public.admin_reports_by_location
      ORDER BY total DESC, label NULLS LAST, id`),
      adminQuery<RecentReport>(`WITH reports AS (
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

  let daily: DailyRow[] = [];
  let hotspots: Hotspot[] = [];
  let contested: Contested[] = [];
  let analyticsError: string | null = null;
  try {
    const [dailyResult, hotspotResult, contestedResult] = await Promise.all([
      // Recursive CTE: a continuous calendar of the last `days` days, quiet days included.
      adminQuery<DailyRow>(`SELECT day::text AS day, lost_reports::int AS lost, found_reports::int AS found,
               claims::int AS claims, handovers::int AS handovers
        FROM public.admin_daily_activity($1)`, [days]),
      // HAVING with a nested subquery: locations above the campus average.
      adminQuery<Hotspot>(`SELECT id, label, building, lost::text AS lost, found::text AS found, total::text AS total,
               campus_average::text AS campus_average
        FROM public.admin_location_hotspots ORDER BY total DESC, label NULLS LAST, id`),
      // HAVING COUNT(DISTINCT claimant) >= 2: items with competing claims, open ones first.
      adminQuery<Contested>(`SELECT id, item, location, building, claims::text AS claims, claimants::text AS claimants,
               first_claim::text AS first_claim, latest_claim::text AS latest_claim, resolved
        FROM public.admin_contested_items ORDER BY resolved, claimants DESC, latest_claim DESC NULLS LAST, id`),
    ]);
    daily = dailyResult.rows;
    hotspots = hotspotResult.rows;
    contested = contestedResult.rows;
  } catch {
    analyticsError = "Unable to load the activity timeline, hotspots and contested items. Please try again.";
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
      <section aria-labelledby="daily-heading" className="card card-pad mt-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="daily-heading" className="section-title">Daily Activity</h2>
          <nav aria-label="Timeline length" className="segmented">
            {[30, 90].map((option) => (
              <a key={option} href={`/admin/campus-summary?days=${option}`} aria-current={days === option ? "page" : undefined}
                className={`flex min-h-10 items-center justify-center rounded-[0.55rem] px-3 text-sm font-semibold ${days === option ? "bg-surface text-ink shadow-sm" : "text-ink-2"}`}>Last {option} days</a>
            ))}
          </nav>
        </div>
        {analyticsError
          ? <Notice tone="error" className="mt-5" action={<a href="/admin/campus-summary" className="btn btn-secondary btn-sm">Try again</a>}>{analyticsError}</Notice>
          : <DailyActivity rows={daily} days={days} />}
      </section>
      {!analyticsError && (
        <div className="mt-8 grid items-start gap-5 xl:grid-cols-2">
          <section aria-labelledby="hotspots-heading" className="card card-pad min-w-0">
            <h2 id="hotspots-heading" className="section-title">Location Hotspots</h2>
            <p className="mt-1 text-sm text-ink-3">Places with more lost and found reports than the campus average{hotspots[0] ? ` (${Number(hotspots[0].campus_average).toLocaleString("en-US")} per location)` : ""}.</p>
            {hotspots.length === 0 ? <p className="mt-5 text-ink-2">No location is above the campus average.</p> : (
              <table aria-label="Location Hotspots" className="data-table mt-5 table-fixed">
                <thead><tr><th scope="col" className="w-[52%]">Location</th><th scope="col" className="num">Lost</th><th scope="col" className="num">Found</th><th scope="col" className="num">Total</th></tr></thead>
                <tbody>{hotspots.map((spot) => (
                  <tr key={spot.id} data-hotspot-id={spot.id}>
                    <th scope="row" className="text-left font-semibold">{spot.label ?? "Unnamed location"}{spot.building && <span className="block text-meta font-normal text-ink-3">{spot.building}</span>}</th>
                    <td className="num text-lost-ink">{format(spot.lost)}</td>
                    <td className="num text-brand-ink">{format(spot.found)}</td>
                    <td className="num font-bold">{format(spot.total)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>
          <section aria-labelledby="contested-heading" className="card card-pad min-w-0">
            <h2 id="contested-heading" className="section-title">Contested Items</h2>
            <p className="mt-1 text-sm text-ink-3">Found items claimed by two or more people. Claimants stay private.</p>
            {contested.length === 0 ? <p className="mt-5 text-ink-2">No found item has competing claims.</p> : (
              <ul className="mt-5 grid gap-3">
                {contested.map((item) => (
                  <li key={item.id} data-contested-id={item.id} className="rounded-xl border border-line p-3">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{item.item ?? "Unnamed item"}</span>
                      {item.resolved ? <Badge tone="done" icon="gift">Handed over</Badge> : <Badge tone="claim" icon="clipboard">Open</Badge>}
                    </p>
                    <p className="mt-1 text-sm text-ink-2">
                      {format(item.claimants)} claimants · {format(item.claims)} claims · {item.location ?? "Unnamed location"}
                      {item.latest_claim && <> · latest claim <DateText value={item.latest_claim} /></>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
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
