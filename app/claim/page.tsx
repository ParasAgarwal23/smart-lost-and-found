import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import ClaimForm from "./claim-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MyClaim = {
  Claim_ID: number;
  Found_ID: number;
  Item_Name: string | null;
  Category_Name: string | null;
  Location_Name: string | null;
  Building: string | null;
  Claim_Date: string | null;
  Evidence_Count: string;
  Handover_ID: number | null;
  Handover_Date: string | null;
  Item_Handed_Over: boolean;
};

export default async function ClaimPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  let reports: { Found_ID: number; Item_Name: string | null; Description: string | null }[] = [];
  let error: string | null = null;
  let claims: MyClaim[] = [];
  let historyError: string | null = null;
  try {
    const history = await query<MyClaim>(
      `SELECT c."Claim_ID", c."Found_ID", f."Item_Name", f."Category_Name",
              f."Location_Name", f."Building", c."Claim_Date"::text AS "Claim_Date",
              summary."Evidence_Count"::text AS "Evidence_Count", summary."Handover_ID",
              h."Handover_Date"::text AS "Handover_Date",
              EXISTS (
                SELECT 1 FROM public."CLAIM" handed_claim
                JOIN public."HANDOVER" receipt ON receipt."Claim_ID" = handed_claim."Claim_ID"
                WHERE handed_claim."Found_ID" = c."Found_ID"
              ) AS "Item_Handed_Over"
       FROM public."CLAIM" c
       JOIN public.v_found_report_details f ON f."Found_ID" = c."Found_ID"
       CROSS JOIN LATERAL public.get_claim_summary(c."Claim_ID") summary
       LEFT JOIN public."HANDOVER" h ON h."Claim_ID" = c."Claim_ID"
       WHERE c."User_ID" = $1
       ORDER BY c."Claim_Date" DESC NULLS LAST, c."Claim_ID" DESC`,
      [user.User_ID],
    );
    claims = history.rows;
  } catch {
    historyError = "Unable to load your claims. Please try again later.";
  }
  try {
    const result = await query<(typeof reports)[number]>(
      `SELECT f."Found_ID", f."Item_Name", f."Description"
       FROM public."FOUND_REPORT" f
       WHERE f."User_ID" <> $1
         AND NOT EXISTS (
           SELECT 1 FROM public."CLAIM" c
           JOIN public."HANDOVER" h ON h."Claim_ID" = c."Claim_ID"
           WHERE c."Found_ID" = f."Found_ID"
         )
         AND NOT EXISTS (
           SELECT 1 FROM public."CLAIM" c
           WHERE c."Found_ID" = f."Found_ID" AND c."User_ID" = $1
         )
       ORDER BY f."Date_Found" DESC NULLS LAST, f."Found_ID" DESC`,
      [user.User_ID],
    );
    reports = result.rows;
  } catch {
    error = "Unable to load eligible found reports. Please try again later.";
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="mb-6 inline-block text-sm font-medium text-teal-700 underline hover:text-teal-800">
        ← Back to Home
      </Link>
      <section id="my-claims" aria-labelledby="claims-title" className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 id="claims-title" className="text-2xl font-bold">My Claims</h1>
        <p className="mt-2 text-sm text-slate-600">View your claims, add supporting evidence, and record receipt after you receive an item. A claim does not confirm ownership.</p>
        {historyError ? <p role="alert" className="mt-6 text-red-700">{historyError}</p> : claims.length === 0 ? (
          <p className="mt-6 text-slate-600">You haven&apos;t submitted any claims yet. <a href="#submit-claim" className="font-medium text-teal-700 underline">Submit a Claim</a></p>
        ) : (
          <div className="mt-6 space-y-4">
            {claims.map((claim) => (
              <article id={`claim-${claim.Claim_ID}`} key={claim.Claim_ID} className="rounded-xl border border-slate-200 p-4">
                <h2 className="break-words font-semibold">{claim.Item_Name ?? "Unnamed item"}</h2>
                <dl className="mt-3 space-y-1 text-sm text-slate-600">
                  <div><dt className="inline font-medium">Claim ID: </dt><dd className="inline">{claim.Claim_ID}</dd></div>
                  <div><dt className="inline font-medium">Found Report ID: </dt><dd className="inline">{claim.Found_ID}</dd></div>
                  <div><dt className="inline font-medium">Category: </dt><dd className="inline">{claim.Category_Name ?? "Unnamed category"}</dd></div>
                  <div><dt className="inline font-medium">Location: </dt><dd className="inline">{claim.Location_Name ?? "Unnamed location"}{claim.Building ? ` (${claim.Building})` : ""}</dd></div>
                  <div><dt className="inline font-medium">Claim date: </dt><dd className="inline">{claim.Claim_Date ?? "Date not supplied"}</dd></div>
                  <div><dt className="inline font-medium">Evidence count: </dt><dd className="inline">{claim.Evidence_Count}</dd></div>
                </dl>
                <p className="mt-3 text-sm text-slate-600">
                  {claim.Handover_ID !== null
                    ? `Receipt recorded · ${claim.Handover_Date ?? "Date not supplied"}`
                    : claim.Item_Handed_Over ? "This item has already been handed over." : "No receipt recorded."}
                </p>
                <nav aria-label={`Actions for claim ${claim.Claim_ID}`} className="mt-3 flex flex-wrap gap-4 text-sm font-medium text-teal-700 [&_a]:underline [&_a:hover]:text-teal-800">
                  <Link href={`/claim/evidence?claimId=${claim.Claim_ID}#evidence-${claim.Claim_ID}`}>
                    {claim.Evidence_Count === "0" ? "Add Evidence" : "View / Add Evidence"}
                  </Link>
                  {!claim.Item_Handed_Over && claim.Handover_ID === null && (
                    <Link href={`/claim/handover?claimId=${claim.Claim_ID}`}>Confirm Item Received</Link>
                  )}
                </nav>
              </article>
            ))}
          </div>
        )}
      </section>
      <section id="submit-claim" aria-labelledby="submit-title" className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 id="submit-title" className="text-xl font-bold">Submit a Claim</h2>
        <p className="mt-2 text-sm text-slate-600">Select a found report to submit a claim.</p>
        {error ? <p role="alert" className="mt-6 text-red-700">{error}</p> : reports.length === 0 && (
          <p className="mt-6 text-slate-600">There are no found reports available for you to claim.</p>
        )}
        <ClaimForm reports={reports} unavailable={error !== null} />
        {!error && reports.length > 0 && (
          <section aria-label="Eligible found reports" className="mt-8 space-y-4">
            {reports.map((report) => (
              <article key={report.Found_ID} className="rounded-xl border border-slate-200 p-4">
                <h3 className="break-words font-semibold">{report.Item_Name ?? "Unnamed item"}</h3>
                <p className="mt-1 text-sm text-teal-700">Found Report ID: {report.Found_ID}</p>
                <p className="mt-2 whitespace-pre-wrap break-words">{report.Description ?? "No description supplied."}</p>
              </article>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}
