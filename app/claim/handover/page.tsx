import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import HandoverForm from "./handover-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HandoverPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  let claims: { Claim_ID: number; Item_Name: string | null }[] = [];
  let error: string | null = null;
  try {
    const result = await query<(typeof claims)[number]>(
      `SELECT c."Claim_ID", f."Item_Name"
       FROM public."CLAIM" c
       JOIN public."FOUND_REPORT" f ON f."Found_ID" = c."Found_ID"
       WHERE c."User_ID" = $1
         AND NOT EXISTS (
           SELECT 1 FROM public."HANDOVER" h WHERE h."Claim_ID" = c."Claim_ID"
         )
       ORDER BY c."Claim_Date" DESC NULLS LAST, c."Claim_ID" DESC`,
      [user.User_ID],
    );
    claims = result.rows;
  } catch {
    error = "Unable to load your claims. Please try again later.";
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Confirm item received</h1>
        <p className="mt-2 text-sm text-slate-600">Select your claim and enter your acknowledgement to record that you have received the item.</p>
        {error ? <p role="alert" className="mt-6 text-red-700">{error}</p> : claims.length === 0 ? (
          <p className="mt-6 text-slate-600">You have no claims awaiting a receipt confirmation.</p>
        ) : <HandoverForm claims={claims} />}
      </section>
    </main>
  );
}
