import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/next-path";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { Icon } from "@/components/icons";
import { BackLink, Notice } from "@/components/ui";
import HandoverForm from "./handover-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm item received" };

export default async function HandoverPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect(loginPath("/claim/handover"));
  const { claimId } = await searchParams;

  let claims: { Claim_ID: number; Item_Name: string | null }[] = [];
  let error: string | null = null;
  try {
    const result = await query<(typeof claims)[number]>(
      `SELECT c."Claim_ID", f."Item_Name"
       FROM public."CLAIM" c
       JOIN public."FOUND_REPORT" f ON f."Found_ID" = c."Found_ID"
       WHERE c."User_ID" = $1
         AND NOT EXISTS (
           SELECT 1 FROM public."HANDOVER" h
           JOIN public."CLAIM" handed_claim ON handed_claim."Claim_ID" = h."Claim_ID"
           WHERE handed_claim."Found_ID" = c."Found_ID"
         )
       ORDER BY c."Claim_Date" DESC NULLS LAST, c."Claim_ID" DESC`,
      [user.User_ID],
    );
    claims = result.rows;
  } catch {
    error = "Unable to load your claims. Please try again later.";
  }

  const requestedId = typeof claimId === "string" && /^-?\d+$/.test(claimId) ? Number(claimId) : NaN;
  const initialClaimId = Number.isInteger(requestedId) && requestedId >= -2147483648 && requestedId <= 2147483647 &&
    claims.some((claim) => claim.Claim_ID === requestedId) ? requestedId : undefined;
  const selectionError = !error && claimId !== undefined && initialClaimId === undefined
    ? "Claim not found or unavailable to your account." : null;

  return (
    <main id="main-content" tabIndex={-1} className="container-page max-w-2xl py-8 sm:py-12">
      <BackLink href="/claim">Back to My Claims</BackLink>
      <h1 className="page-title">Confirm item received</h1>
      <p className="page-description">Use this once the item is back in your hands. It completes your claim.</p>
      {!error && claims.length > 0 && (
        <Notice tone="warning" title="Before you confirm" className="mt-6">
          This can&apos;t be undone. The item is marked as returned and no one else can claim it afterwards.
        </Notice>
      )}
      <section aria-label="Record receipt" className="card card-pad report-card rail-done mt-6">
        {error ? <Notice tone="error">{error}</Notice> : claims.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="gift" size={22} /></span>
            <p className="text-lg font-bold">You have no claims waiting for confirmation.</p>
            <p className="max-w-md text-sm text-ink-2">Only claims for items that have not already been handed over can be confirmed. View My Claims for recorded receipts.</p>
          </div>
        )}
        <HandoverForm key={JSON.stringify(claimId) ?? "generic"} claims={claims} initialClaimId={initialClaimId} selectionError={selectionError} unavailable={error !== null} />
      </section>
    </main>
  );
}
