import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginPath, withNumericParam } from "@/lib/next-path";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { BackLink } from "@/components/ui";
import HandoverForm, { type HandoverClaim } from "./handover-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm item received" };

export default async function HandoverPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { claimId } = await searchParams;
  const user = await getAuthenticatedUser();
  if (!user) redirect(loginPath(withNumericParam("/claim/handover", "claimId", claimId)));

  let claims: HandoverClaim[] = [];
  let error: string | null = null;
  try {
    const result = await query<(typeof claims)[number]>(
      `SELECT c."Claim_ID", f."Item_Name", c."Claim_Date"::text AS "Claim_Date"
       FROM public."CLAIM" c
       JOIN public."FOUND_REPORT" f ON f."Found_ID" = c."Found_ID"
       WHERE c."User_ID" = $1
         AND NOT public.found_report_has_handover(c."Found_ID")
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
  let selectionError: string | null = null;
  if (!error && claimId !== undefined && initialClaimId === undefined) {
    selectionError = "Claim not found or unavailable to your account.";
    // The user's own claim is ineligible only because its item has a handover
    // (e.g. this page was reloaded after confirming), so say that instead.
    if (Number.isInteger(requestedId) && requestedId >= -2147483648 && requestedId <= 2147483647) {
      try {
        const own = await query<{ Own_Receipt: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM public."HANDOVER" h WHERE h."Claim_ID" = c."Claim_ID") AS "Own_Receipt"
           FROM public."CLAIM" c WHERE c."Claim_ID" = $1 AND c."User_ID" = $2`,
          [requestedId, user.User_ID],
        );
        if (own.rows[0]) {
          selectionError = own.rows[0].Own_Receipt
            ? "You have already confirmed that you received this item."
            : "This item has already been handed over to someone else, so this claim can't be confirmed.";
        }
      } catch { /* Keep the general message. */ }
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="container-page max-w-2xl py-8 sm:py-12">
      <BackLink href="/claim">Back to My Claims</BackLink>
      <h1 className="page-title">Confirm item received</h1>
      <p className="page-description">Use this once the item is back in your hands. It completes your claim.</p>
      {/* The form owns the warning, empty and success states so they never contradict each other. */}
      <HandoverForm key={JSON.stringify(claimId) ?? "generic"} claims={claims} initialClaimId={initialClaimId} selectionError={selectionError} error={error} />
    </main>
  );
}
