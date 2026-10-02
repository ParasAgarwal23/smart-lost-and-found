import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import ClaimForm from "./claim-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ClaimPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  let reports: { Found_ID: number; Item_Name: string | null; Description: string | null }[] = [];
  let error: string | null = null;
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
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Claim a found item</h1>
        <p className="mt-2 text-sm text-slate-600">Select a found report to submit a claim. Submitting a claim does not confirm ownership.</p>
        <Link href="/claim/evidence" className="mt-4 inline-block text-sm font-medium text-teal-700 underline hover:text-teal-800">
          Add evidence to your claims
        </Link>
        <Link href="/claim/handover" className="mt-4 ml-4 inline-block text-sm font-medium text-teal-700 underline hover:text-teal-800">
          Confirm item received
        </Link>
        {error ? <p role="alert" className="mt-6 text-red-700">{error}</p> : reports.length === 0 ? (
          <p className="mt-6 text-slate-600">There are no found reports available for you to claim.</p>
        ) : (
          <>
            <ClaimForm reports={reports} />
            <section aria-label="Eligible found reports" className="mt-8 space-y-4">
              {reports.map((report) => (
                <article key={report.Found_ID} className="rounded-xl border border-slate-200 p-4">
                  <h2 className="font-semibold">{report.Item_Name ?? "Unnamed item"}</h2>
                  <p className="mt-1 text-sm text-teal-700">Found Report ID: {report.Found_ID}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words">{report.Description ?? "No description supplied."}</p>
                </article>
              ))}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
