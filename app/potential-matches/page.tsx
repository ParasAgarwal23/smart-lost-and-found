import Link from "next/link";
import { getFoundReportContext, type FoundReportContext } from "@/lib/found-report-context";
import ClaimLink from "@/app/claim/claim-link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { getPotentialMatches, getUserLostReports, type PotentialMatch, type UserLostReport } from "@/lib/potential-matches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PotentialMatchesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const { lostId } = await searchParams;
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

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="mb-6 inline-block text-sm font-medium text-teal-700 underline hover:text-teal-800">
        ← Back to Home
      </Link>
      <h1 className="page-title">Potential Matches</h1>
      <p className="mt-2 text-sm text-slate-600">
        Potential matches based on description similarity. These results do not prove ownership.
      </p>
      {reports.length > 0 && (
        <form action="/potential-matches" method="get" className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <label htmlFor="lostId" className="block text-sm font-medium">Your lost report</label>
          <select id="lostId" name="lostId" required defaultValue={selectedReport?.Lost_ID ?? ""}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700">
            <option value="">Select a lost report</option>
            {reports.map((report) => (
              <option key={report.Lost_ID} value={report.Lost_ID}>
                {report.Lost_ID} — {report.Item_Name ?? "Unnamed item"}
              </option>
            ))}
          </select>
          <button type="submit" className="min-h-11 rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800">
            Find potential matches
          </button>
        </form>
      )}
      <nav aria-label="Other ways to find your item" className="mt-4 flex flex-wrap gap-4 text-sm font-medium text-teal-700 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:underline"><Link href="/search?type=Found">Search found items</Link><Link href="/lost-report">Report a lost item</Link></nav>
      {error ? <p role="alert" className="mt-6 text-red-700">{error}</p> : reports.length === 0 ? (
        <p className="mt-6 text-slate-600">You have no lost reports. Create a lost report to find potential matches.</p>
      ) : !selected ? (
        <p className="mt-6 text-slate-600">Select one of your lost reports to find potential matches.</p>
      ) : (
        <section aria-label="Potential matches" className="results-grid mt-8">
          {selectedReport && <h2 className="results-heading text-lg font-semibold">Suggestions for {selectedReport.Item_Name ?? "your lost item"}</h2>}
          {matches.length === 0 && <p className="text-slate-600">No potential matches found.</p>}
          {matches.map((match) => (
            <article key={match.Found_ID} className="item-card">
              <span className="badge">Potential match</span>
              <h2 className="mt-3 text-xl font-semibold">{match.Item_Name ?? "Unnamed item"}</h2>
              <p className="mt-1 text-sm text-teal-700">Found Report ID: {match.Found_ID}</p>
              <p className="mt-2 whitespace-pre-wrap break-words">{match.Description ?? "No description supplied."}</p>
              {contexts.filter((context) => context.Found_ID === match.Found_ID).map((context) => <p key={context.Found_ID} className="mt-3 text-sm text-slate-600">{context.Category_Name ?? "Unnamed category"} / {context.Location_Name ?? "Unnamed location"}{context.Building ? ` (${context.Building})` : ""} / Found {context.Date_Found ?? "date not supplied"}</p>)}
              <p className="similarity-note">Description similarity (cosine): {match.Cosine_Similarity.toFixed(3)}. Higher values indicate more similar descriptions, not verified ownership.</p>
              <ClaimLink foundId={match.Found_ID} context={contexts.find((context) => context.Found_ID === match.Found_ID)} signedIn />
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
