import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import EvidenceForm from "./evidence-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ClaimEvidencePage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  let claims: { Claim_ID: number; Item_Name: string | null }[] = [];
  let evidence: { Claim_ID: number; Evidence_No: number; Evidence_Description: string | null }[] = [];
  let error: string | null = null;
  try {
    const result = await query<(typeof claims)[number]>(
      `SELECT c."Claim_ID", f."Item_Name"
       FROM public."CLAIM" c
       JOIN public."FOUND_REPORT" f ON f."Found_ID" = c."Found_ID"
       WHERE c."User_ID" = $1
       ORDER BY c."Claim_Date" DESC NULLS LAST, c."Claim_ID" DESC`,
      [user.User_ID],
    );
    claims = result.rows;
    const evidenceResult = await query<(typeof evidence)[number]>(
      `SELECT e."Claim_ID", e."Evidence_No", e."Evidence_Description"
       FROM public."CLAIM_EVIDENCE" e
       JOIN public."CLAIM" c ON c."Claim_ID" = e."Claim_ID"
       WHERE c."User_ID" = $1
       ORDER BY e."Claim_ID", e."Evidence_No"`,
      [user.User_ID],
    );
    evidence = evidenceResult.rows;
  } catch {
    error = "Unable to load your claims and evidence. Please try again later.";
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="mb-6 inline-block text-sm font-medium text-teal-700 underline hover:text-teal-800">
        ← Back to Home
      </Link>
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Add claim evidence</h1>
        <p className="mt-2 text-sm text-slate-600">Select one of your claims and describe information supporting your ownership of the item.</p>
        {error ? <p role="alert" className="mt-6 text-red-700">{error}</p> : claims.length === 0 ? (
          <p className="mt-6 text-slate-600">You have no claims to add evidence to.</p>
        ) : (
          <>
            <EvidenceForm claims={claims} />
            <section aria-label="Submitted evidence" className="mt-8 space-y-4">
              <h2 className="text-lg font-semibold">Submitted evidence</h2>
              {claims.map((claim) => {
                const claimEvidence = evidence.filter((entry) => entry.Claim_ID === claim.Claim_ID);
                return (
                  <article key={claim.Claim_ID} className="rounded-xl border border-slate-200 p-4">
                    <h3 className="font-semibold">{claim.Item_Name ?? "Unnamed item"}</h3>
                    <p className="mt-1 text-sm text-teal-700">Claim ID: {claim.Claim_ID}</p>
                    {claimEvidence.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-600">No evidence has been added to this claim.</p>
                    ) : (
                      <ul className="mt-3 space-y-3">
                        {claimEvidence.map((entry) => (
                          <li key={entry.Evidence_No}>
                            <p className="text-sm font-medium">Evidence number: {entry.Evidence_No}</p>
                            <p className="mt-1 whitespace-pre-wrap break-words">{entry.Evidence_Description ?? "No description supplied."}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
