import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import HandoverForm from "./handover-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HandoverPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
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
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/claim" className="mb-6 inline-block text-sm font-medium text-teal-700 underline hover:text-teal-800">
        ← Back to My Claims
      </Link>
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Confirm item received</h1>
        <p className="mt-2 text-sm text-slate-600">Select your claim and enter your acknowledgement to record that you have received the item.</p>
        {error ? <p role="alert" className="mt-6 text-red-700">{error}</p> : claims.length === 0 && (
          <div className="mt-6 space-y-2 text-slate-600">
            <p>You have no claims awaiting a receipt confirmation.</p>
            <p>Only claims for items that have not already been handed over can be confirmed. View My Claims for recorded receipts.</p>
          </div>
        )}
        <HandoverForm key={JSON.stringify(claimId) ?? "generic"} claims={claims} initialClaimId={initialClaimId} selectionError={selectionError} unavailable={error !== null} />
      </section>
    </main>
  );
}
