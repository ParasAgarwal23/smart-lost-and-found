import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import EvidenceForm from "./evidence-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ClaimEvidencePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const { claimId } = await searchParams;

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

  const requestedId = typeof claimId === "string" && /^-?\d+$/.test(claimId) ? Number(claimId) : NaN;
  const initialClaimId = Number.isInteger(requestedId) && requestedId >= -2147483648 && requestedId <= 2147483647 &&
    claims.some((claim) => claim.Claim_ID === requestedId) ? requestedId : undefined;
  const selectionError = !error && claimId !== undefined && initialClaimId === undefined
    ? "Claim not found or unavailable to your account." : null;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/claim" className="mb-6 inline-block text-sm font-medium text-teal-700 underline hover:text-teal-800">
        ← Back to My Claims
      </Link>
      <section className="form-panel">
        <h1 className="page-title">Add claim evidence</h1>
        <p className="mt-2 text-sm text-slate-600">Select one of your claims and describe information supporting your ownership of the item.</p>
        {selectionError && <p role="alert" className="mt-4 text-sm text-red-700">{selectionError}</p>}
        {error ? <p role="alert" className="mt-6 text-red-700">{error}</p> : claims.length === 0 ? (
          <p className="mt-6 text-slate-600">You have no claims to add evidence to. <Link href="/claim#submit-claim" className="font-medium text-teal-700 underline">Submit a Claim</Link> to get started.</p>
        ) : (
          <>
            <EvidenceForm key={JSON.stringify(claimId) ?? "generic"} claims={claims} initialClaimId={initialClaimId} />
            <section aria-label="Submitted evidence" className="mt-8 space-y-4">
              <h2 className="text-lg font-semibold">Submitted evidence</h2>
              {claims.map((claim) => {
                const claimEvidence = evidence.filter((entry) => entry.Claim_ID === claim.Claim_ID);
                return (
                  <article id={`evidence-${claim.Claim_ID}`} key={claim.Claim_ID} className="rounded-xl border border-slate-200 p-3 sm:p-4">
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
