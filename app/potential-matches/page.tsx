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

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-bold">Potential Matches</h1>
      <p className="mt-2 text-sm text-slate-600">
        Potential matches based on description similarity. These results do not prove ownership.
      </p>
      {reports.length > 0 && (
        <form action="/potential-matches" method="get" className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <label htmlFor="lostId" className="block text-sm font-medium">Your lost report</label>
          <select id="lostId" name="lostId" required defaultValue={typeof lostId === "string" ? lostId : ""}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700">
            <option value="">Select a lost report</option>
            {reports.map((report) => (
              <option key={report.Lost_ID} value={report.Lost_ID}>
                {report.Lost_ID} — {report.Item_Name ?? "Unnamed item"}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800">
            Find potential matches
          </button>
        </form>
      )}
      {error ? <p role="alert" className="mt-6 text-red-700">{error}</p> : reports.length === 0 ? (
        <p className="mt-6 text-slate-600">You have no lost reports. Create a lost report to find potential matches.</p>
      ) : !selected ? (
        <p className="mt-6 text-slate-600">Select one of your lost reports to find potential matches.</p>
      ) : (
        <section aria-label="Potential matches" className="mt-8 space-y-4">
          {matches.length === 0 && <p className="text-slate-600">No candidate matches are available for this lost report.</p>}
          {matches.map((match) => (
            <article key={match.Found_ID} className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold">{match.Item_Name ?? "Unnamed item"}</h2>
              <p className="mt-1 text-sm text-teal-700">Found Report ID: {match.Found_ID}</p>
              <p className="mt-2 whitespace-pre-wrap break-words">{match.Description ?? "No description supplied."}</p>
              <p className="mt-3 text-sm text-slate-600">Cosine Similarity: {match.Cosine_Similarity.toFixed(4)}</p>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
