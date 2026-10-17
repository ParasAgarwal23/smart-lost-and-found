import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath, withNumericParam } from "@/lib/next-path";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { Icon } from "@/components/icons";
import { BackLink, EmptyState, Notice } from "@/components/ui";
import EvidenceForm from "./evidence-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Claim evidence" };

export default async function ClaimEvidencePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { claimId } = await searchParams;
  const user = await getAuthenticatedUser();
  if (!user) redirect(loginPath(withNumericParam("/claim/evidence", "claimId", claimId)));

  let claims: { Claim_ID: number; Item_Name: string | null; Claim_Date: string | null; Has_Handover: boolean }[] = [];
  let evidence: { Claim_ID: number; Evidence_No: number; Evidence_Description: string | null }[] = [];
  let error: string | null = null;
  try {
    const result = await query<(typeof claims)[number]>(
      `SELECT c."Claim_ID", f."Item_Name", c."Claim_Date"::text AS "Claim_Date",
              EXISTS (SELECT 1 FROM public."CLAIM" other JOIN public."HANDOVER" h ON h."Claim_ID" = other."Claim_ID"
                      WHERE other."Found_ID" = c."Found_ID") AS "Has_Handover"
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
  const selected = claims.find((claim) => claim.Claim_ID === initialClaimId);
  const selectedEvidence = evidence.filter((entry) => entry.Claim_ID === initialClaimId);
  // Once an item has been handed over (to this user or someone else) the claim
  // is finished, so its evidence is shown for reference without the form, and
  // the picker offers only claims that are still open.
  const openClaims = claims.filter((claim) => !claim.Has_Handover);
  const closed = selected?.Has_Handover ?? false;

  return (
    <main id="main-content" tabIndex={-1} className="container-page max-w-2xl py-8 sm:py-12">
      <BackLink href="/claim">Back to My Claims</BackLink>
      <h1 className="page-title">{closed ? "Claim evidence" : "Add evidence"}</h1>
      <p className="page-description">
        {closed
          ? "The details you added to support this claim. Only you can see your evidence."
          : "Help show the item is yours: a receipt number, a scratch or sticker, or what was inside. Only you can see your evidence."}
      </p>

      {closed ? (
        <Notice tone="info" className="mt-6">This item has already been handed over, so this claim is closed. Your evidence is kept here for reference.</Notice>
      ) : (
        <section aria-label="Add evidence" className="card card-pad report-card rail-claim mt-6">
          {selectionError && <Notice tone="warning">{selectionError}</Notice>}
          {error ? <Notice tone="error">{error}</Notice> : openClaims.length === 0 ? (
            <EmptyState icon="clipboard" title={claims.length === 0 ? "You have no claims to add evidence to." : "None of your claims are waiting for evidence."}
              actions={claims.length === 0
                ? <Link href="/search?type=Found" className="btn btn-primary btn-sm">Search found items</Link>
                : <Link href="/claim" className="btn btn-primary btn-sm">Back to My Claims</Link>}>
              {claims.length === 0
                ? "Claim a found item first, then add your evidence here."
                : "Evidence can be added to a claim until its item is handed over."}
            </EmptyState>
          ) : (
            <EvidenceForm key={JSON.stringify(claimId) ?? "generic"} claims={openClaims} initialClaimId={initialClaimId} />
          )}
        </section>
      )}

      {selected && (
        <section id={`evidence-${selected.Claim_ID}`} aria-labelledby="submitted-evidence" className="mt-8">
          <h2 id="submitted-evidence" className="section-title">Evidence for {selected.Item_Name ?? "this claim"}</h2>
          {selectedEvidence.length === 0 ? (
            <p className="mt-2 text-sm text-ink-3">No evidence has been added to this claim yet.</p>
          ) : (
            <ol className="mt-3 grid gap-2">
              {selectedEvidence.map((entry) => (
                <li key={entry.Evidence_No} className="flex gap-3 rounded-lg border border-line bg-surface p-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-claim-soft text-xs font-bold text-claim-ink">
                    <span aria-hidden="true">{entry.Evidence_No}</span><span className="sr-only">Evidence number: {entry.Evidence_No}</span>
                  </span>
                  <p className="min-w-0 whitespace-pre-wrap text-sm">{entry.Evidence_Description ?? "No description supplied."}</p>
                </li>
              ))}
            </ol>
          )}
          {!selected.Has_Handover && selectedEvidence.length > 0 && (
            <p className="mt-4 text-sm text-ink-2">
              Got the item back? <Link href={`/claim/handover?claimId=${selected.Claim_ID}`} className="link">Confirm you received it <Icon name="arrowRight" size={14} className="inline" /></Link>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
