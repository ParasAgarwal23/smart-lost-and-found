import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath, withNumericParam } from "@/lib/next-path";
import { getFoundReportContext, type FoundReportContext } from "@/lib/found-report-context";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { Icon } from "@/components/icons";
import { DateText, EmptyState, formatDate, Notice, placeLabel } from "@/components/ui";
import ClaimForm, { type BlockedClaim, type ClaimableReport } from "./claim-form";
import WithdrawClaim from "./withdraw-claim";
import WithdrawNotice from "./withdraw-notice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Claims" };

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

type EligibleReport = ClaimableReport & { Description: string | null; Building: string | null };

type StepState = "done" | "current" | "upcoming" | "skipped" | "closed";
// Spoken after each step label, so progress never relies on bar colour alone.
const stepStatus: Record<StepState, string> = {
  done: "done", current: "next step", upcoming: "not started", skipped: "skipped", closed: "closed",
};

export default async function ClaimPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { foundId } = await searchParams;
  const user = await getAuthenticatedUser();
  if (!user) redirect(loginPath(withNumericParam("/claim", "foundId", foundId)));

  let reports: EligibleReport[] = [];
  let error: string | null = null;
  let claims: MyClaim[] = [];
  let historyError: string | null = null;
  try {
    // get_claim_summary() (db/functions.sql) supplies the evidence count and handover ID.
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
    const result = await query<EligibleReport>(
      `SELECT f."Found_ID", f."Item_Name", f."Description", f."Location_Name",
              f."Building", f."Date_Found"::text AS "Date_Found"
       FROM public.v_found_report_details f
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

  const requestedId = typeof foundId === "string" && /^-?\d+$/.test(foundId) ? Number(foundId) : NaN;
  const initialFoundId = Number.isInteger(requestedId) && reports.some((report) => report.Found_ID === requestedId)
    ? requestedId : undefined;
  // One explanation (and one next step) when the requested item can't be claimed.
  let blocked: BlockedClaim | null = null;
  let context: FoundReportContext | undefined;
  if (!error && foundId !== undefined && initialFoundId === undefined) {
    if (Number.isInteger(requestedId) && requestedId >= -2147483648 && requestedId <= 2147483647) {
      try { [context] = await getFoundReportContext([requestedId], user.User_ID); } catch { /* Fall back to the general message. */ }
    }
    const search = { href: "/search?type=Found", label: "Search found items" };
    blocked = !context ? { message: "This found report is unavailable to claim. It may have been removed, or the link is incorrect.", action: search }
      : context.Is_Own_Report ? { message: "This found report is unavailable to claim. You reported this item yourself.", action: { href: "/my-reports", label: "View My Reports" } }
      : context.Own_Claim_ID !== null ? { message: "This found report is unavailable to claim. You have already claimed this item.", action: { href: `#claim-${context.Own_Claim_ID}`, label: "View My Claim" } }
      : context.Has_Handover ? { message: "This found report is unavailable to claim. It has already been returned to its owner.", action: search }
      : { message: "This found report is unavailable to claim right now.", action: search };
  }
  // The item stays named in the heading even when it cannot be claimed, including
  // straight after this user claims it (the page then refreshes with it blocked).
  const requested = reports.find((report) => report.Found_ID === initialFoundId) ?? context;
  const arrivedToClaim = foundId !== undefined;

  // One claim form, shown first when the user arrived via "Claim this item".
  const claimSection = (
    <section id="submit-claim" aria-labelledby="submit-title" className="card card-pad">
      <h2 id="submit-title" className="section-title">{requested ? `Claim “${requested.Item_Name ?? "this item"}”` : "Claim a found item"}</h2>
      {requested && <p className="mt-1 text-sm text-ink-3">Found {formatDate(requested.Date_Found)} · {placeLabel(requested.Location_Name, requested.Building)}</p>}
      <p className="mt-2 text-sm text-ink-2">After you claim, add proof that it&apos;s yours, such as a receipt or a detail only the owner would know.</p>
      {error ? <Notice tone="error" className="mt-4">{error}</Notice> : reports.length === 0 && !blocked && (
        <p className="mt-4 text-sm text-ink-2">There are no found items you can claim right now. <Link href="/search?type=Found" className="link">Search found items</Link></p>
      )}
      <ClaimForm key={JSON.stringify(foundId) ?? "generic"} reports={reports} initialFoundId={initialFoundId} blocked={blocked} unavailable={error !== null} />
    </section>
  );

  return (
    <main id="main-content" tabIndex={-1} className="container-page max-w-3xl py-8 sm:py-12">
      <h1 id="claims-title" className="page-title">My Claims</h1>
      <p className="page-description">Items you&apos;ve asked to collect. Claim the item first, then add proof that it&apos;s yours, and confirm once you have it back.</p>

      {arrivedToClaim && <div className="mt-6">{claimSection}</div>}

      <section id="my-claims" aria-labelledby="claims-list-title" className="mt-8">
        <h2 id="claims-list-title" className="sr-only">Your claims</h2>
        <WithdrawNotice />
        {historyError ? <Notice tone="error" className="mt-4">{historyError}</Notice> : claims.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon="clipboard" title="You haven't submitted any claims yet."
              actions={<Link href="/search?type=Found" className="btn btn-primary btn-sm"><Icon name="search" size={16} />Search found items</Link>}>
              When you spot your item in search or in your possible matches, choose “Claim this item”.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-4 grid gap-4">
            {claims.map((claim) => {
              const evidenceCount = Number(claim.Evidence_Count);
              const received = claim.Handover_ID !== null;
              const closedByOther = !received && claim.Item_Handed_Over;
              const open = !received && !closedByOther;
              const evidenceHref = `/claim/evidence?claimId=${claim.Claim_ID}#evidence-${claim.Claim_ID}`;
              const handoverHref = `/claim/handover?claimId=${claim.Claim_ID}`;
              // Proof is added after claiming (CLAIM_EVIDENCE rows belong to a CLAIM).
              // A step is "done" only when its row exists; once the item has been
              // handed over, unfinished steps are shown as skipped or closed.
              const steps: { state: StepState; label: string }[] = [
                { state: "done", label: "Claim submitted" },
                evidenceCount > 0 ? { state: "done", label: `Proof added (${evidenceCount})` }
                  : open ? { state: "current", label: "Add proof" } : { state: "skipped", label: "No proof added" },
                received ? { state: "done", label: "Item received" }
                  : closedByOther ? { state: "closed", label: "Returned to someone else" }
                  : { state: evidenceCount > 0 ? "current" : "upcoming", label: "Confirm receipt" },
              ];
              return (
                <li key={claim.Claim_ID}>
                  <article id={`claim-${claim.Claim_ID}`} className={`card report-card ${received ? "rail-done" : closedByOther ? "" : "rail-claim"}`}>
                    <h3 className="text-lg font-bold">{claim.Item_Name ?? "Unnamed item"}</h3>
                    <p className="text-sm text-ink-3">
                      {claim.Category_Name ?? "Unnamed category"} · {placeLabel(claim.Location_Name, claim.Building)} · claimed {formatDate(claim.Claim_Date)}
                    </p>
                    <ol className="steps" aria-label="Claim progress">
                      {steps.map((step) => (
                        <li key={step.label} className="step" data-state={step.state} data-done={step.state === "done"}>
                          {step.label}<span className="sr-only">{` (${stepStatus[step.state]})`}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="rounded-xl bg-sunken/60 p-3 text-sm">
                      {received ? (
                        <p className="flex items-center gap-2"><Icon name="checkCircle" size={16} className="text-success" /><span>Receipt recorded · <DateText value={claim.Handover_Date} />. This claim is complete.</span></p>
                      ) : closedByOther ? (
                        <p className="flex items-center gap-2"><Icon name="lock" size={16} />This item has already been handed over. You can withdraw this claim.</p>
                      ) : evidenceCount === 0 ? (
                        <p><span className="font-semibold">Next step:</span> add proof that this item is yours.</p>
                      ) : (
                        <p><span className="font-semibold">Next step:</span> once you have the item back, confirm you received it.</p>
                      )}
                    </div>
                    {/* A completed claim without evidence has no actions, so no empty footer. */}
                    {(!received || evidenceCount > 0) && (
                      <div className="card-actions">
                        {open && evidenceCount === 0 && <Link href={evidenceHref} className="btn btn-primary btn-sm"><Icon name="file" size={16} />Add evidence</Link>}
                        {open && evidenceCount > 0 && <Link href={handoverHref} className="btn btn-primary btn-sm"><Icon name="gift" size={16} />Confirm item received</Link>}
                        {evidenceCount > 0 && (
                          <Link href={evidenceHref} className="link-quiet">
                            <Icon name="file" size={15} />{open ? "View or add evidence" : "View evidence"} <span className="text-ink-3" data-evidence-count={evidenceCount}>({evidenceCount})</span>
                          </Link>
                        )}
                        {open && evidenceCount === 0 && <Link href={handoverHref} className="link-quiet">Already received it?</Link>}
                        {!received && <span className="sm:ml-auto"><WithdrawClaim claimId={claim.Claim_ID} evidenceCount={evidenceCount} /></span>}
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!arrivedToClaim && (
        <details className="mt-8 rounded-2xl border border-line bg-surface">
          <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-5 font-bold text-brand"><Icon name="plus" size={16} />Claim another found item</summary>
          <div className="border-t border-line">{claimSection}</div>
        </details>
      )}
    </main>
  );
}
