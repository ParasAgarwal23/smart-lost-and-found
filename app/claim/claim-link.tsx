import Link from "next/link";
import type { FoundReportContext } from "@/lib/found-report-context";

export default function ClaimLink({ foundId, context, signedIn }: {
  foundId: number;
  context?: FoundReportContext;
  signedIn: boolean;
}) {
  const linkClass = "inline-flex min-h-11 items-center font-medium text-teal-700 underline hover:text-teal-800";
  if (context?.Has_Handover) return <p className="mt-3 text-sm text-slate-600">This item has already been handed over.</p>;
  if (!signedIn) return <Link href="/login" className={linkClass}>Sign In to claim an item</Link>;
  if (!context) return <p className="mt-3 text-sm text-slate-600">Claim availability could not be checked. <Link href="/claim" className={linkClass}>Open My Claims</Link></p>;
  if (context.Is_Own_Report) return <p className="mt-3 text-sm text-slate-600">You reported this item. You cannot claim your own found report.</p>;
  if (context.Own_Claim_ID !== null) return <p className="mt-3 text-sm text-slate-600">You have already claimed this item. <Link href={`/claim#claim-${context.Own_Claim_ID}`} className={linkClass}>View My Claim</Link></p>;
  return <Link href={`/claim?foundId=${foundId}#submit-claim`} className={linkClass}>Claim this item</Link>;
}
