import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath, withNumericParam } from "@/lib/next-path";
import { getFoundReportContext, type FoundReportContext } from "@/lib/found-report-context";
import ClaimLink from "@/app/claim/claim-link";
import { getAuthenticatedUser } from "@/lib/auth";
import { getPotentialMatches, getUserLostReports, type PotentialMatch, type UserLostReport } from "@/lib/potential-matches";
import AutoSubmit from "@/components/auto-submit";
import ExpandableText from "@/components/expandable-text";
import { Icon } from "@/components/icons";
import { BackLink, Badge, EmptyState, formatDate, Notice, placeLabel } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Possible matches" };

export default async function PotentialMatchesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lostId } = await searchParams;
  const user = await getAuthenticatedUser();
  if (!user) redirect(loginPath(withNumericParam("/potential-matches", "lostId", lostId)));

  const selected = lostId !== undefined && lostId !== "";
  let reports: UserLostReport[] = [];
  let matches: PotentialMatch[] = [];
  let error: string | null = null;
  try {
    reports = await getUserLostReports(user.User_ID);
    if (selected) {
      const result = await getPotentialMatches(user.User_ID, lostId);
      matches = result.matches;
      error = result.error;
    }
  } catch {
    error = "Unable to load your lost reports. Please try again later.";
  }

  let contexts: FoundReportContext[] = [];
  try {
    contexts = await getFoundReportContext(matches.map((match) => match.Found_ID), user.User_ID);
  } catch { /* Preserve similarity results even when extra context cannot load. */ }
  const selectedReport = typeof lostId === "string" ? reports.find((report) => String(report.Lost_ID) === lostId) : undefined;
  const pendingEmbedding = selectedReport && !selectedReport.Has_Embedding;
  // Label the highest similarity score, not merely the first row returned.
  const bestFoundId = matches.reduce<PotentialMatch | undefined>(
    (best, match) => (!best || match.Cosine_Similarity > best.Cosine_Similarity ? match : best), undefined)?.Found_ID;

  return (
    <main id="main-content" tabIndex={-1} className="container-page max-w-3xl py-8 sm:py-12">
      <BackLink href="/my-reports">Back to My Reports</BackLink>
      <h1 className="page-title">Possible matches</h1>
      <p className="page-description">Found items whose descriptions are most similar to your lost item, best match first.</p>

      {reports.length > 0 && (
        <form action="/potential-matches" method="get" className="card mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <AutoSubmit resultsId="matches" />
          <div className="field flex-1">
            <label htmlFor="lostId" className="label">Your lost item</label>
            <select id="lostId" name="lostId" required defaultValue={selectedReport?.Lost_ID ?? ""} className="input">
              <option value="" disabled>Choose one of your lost reports</option>
              {reports.map((report) => (
                <option key={report.Lost_ID} value={report.Lost_ID}>
                  {report.Item_Name ?? "Unnamed item"} — lost {formatDate(report.Date_Lost)}
                </option>
              ))}
            </select>
          </div>
          {/* Choosing a report loads its matches; the button is only needed without JavaScript. */}
          <noscript><button type="submit" className="btn btn-primary">Show matches</button></noscript>
        </form>
      )}

      <section id="matches" aria-labelledby="matches-heading" className="results-region mt-8">
        <h2 id="matches-heading" className="sr-only">{selectedReport ? `Matches for ${selectedReport.Item_Name ?? "your lost item"}` : "Matches"}</h2>
        {error ? (
          <Notice tone={pendingEmbedding ? "warning" : "error"}
            action={<div className="flex flex-wrap gap-2">
              {/* Saving the report (even unchanged) stores its description vector. */}
              {pendingEmbedding && <Link href={`/my-reports/edit?type=lost&id=${selectedReport.Lost_ID}`} className="btn btn-primary btn-sm"><Icon name="edit" size={16} />Edit and save report</Link>}
              <Link href="/search?type=Found" className="btn btn-secondary btn-sm"><Icon name="search" size={16} />Search found items instead</Link>
            </div>}>
            {error}
          </Notice>
        ) : reports.length === 0 ? (
          <EmptyState icon="question" title="You have no lost reports yet"
            actions={<Link href="/lost-report" className="btn btn-primary btn-sm"><Icon name="plus" size={16} />Report a lost item</Link>}>
            Report what you lost and we&apos;ll suggest found items that look similar.
          </EmptyState>
        ) : !selected ? (
          <EmptyState icon="sparkles" title="Choose a lost item above">
            Select one of your lost reports to see possible matches.
          </EmptyState>
        ) : matches.length === 0 ? (
          <EmptyState icon="inbox" title="No possible matches yet"
            actions={<Link href="/search?type=Found" className="btn btn-secondary btn-sm">Search found items</Link>}>
            Nothing similar has been reported as found so far. Check back later.
          </EmptyState>
        ) : (
          <>
            <p className="notice notice-info mb-4"><Icon name="info" size={18} className="mt-0.5" />
              <span>A similar description is a hint, not proof. If one looks like yours, claim it and add details only the owner would know.</span>
            </p>
            <ol className="grid gap-3" aria-label="Possible matches, best first">
              {matches.map((match) => {
                const context = contexts.find((entry) => entry.Found_ID === match.Found_ID);
                const percent = Math.round(Math.max(0, Math.min(1, match.Cosine_Similarity)) * 100);
                return (
                  <li key={match.Found_ID} className="min-w-0">
                    {/* Ranking is unchanged; items already handed over just lose the accent rail. */}
                    <article data-found-id={match.Found_ID} className={`card report-card ${context?.Has_Handover ? "" : "rail-match"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {(match.Found_ID === bestFoundId || context?.Has_Handover) && (
                            <p className="mb-1.5 flex flex-wrap gap-1.5">
                              {match.Found_ID === bestFoundId && <Badge tone="match" icon="sparkles">Best match</Badge>}
                              {context?.Has_Handover && <Badge tone="done" icon="gift">Returned</Badge>}
                            </p>
                          )}
                          <h3 className="text-lg font-bold">{match.Item_Name ?? "Unnamed item"}</h3>
                          {context && <p className="text-sm text-ink-3">Found {formatDate(context.Date_Found)} · {placeLabel(context.Location_Name, context.Building)}</p>}
                        </div>
                        <p className="shrink-0 text-right">
                          <span className="font-display block text-2xl font-semibold leading-none">{percent}%</span>
                          <span className="text-meta text-ink-3">similar</span>
                        </p>
                      </div>
                      <ExpandableText text={match.Description ?? "No description supplied."} className="text-sm text-ink-2" />
                      <div className="card-actions">
                        <ClaimLink foundId={match.Found_ID} context={context} signedIn />
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>
    </main>
  );
}
