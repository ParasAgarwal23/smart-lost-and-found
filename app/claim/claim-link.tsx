import Link from "next/link";
import { Icon } from "@/components/icons";
import type { FoundReportContext } from "@/lib/found-report-context";

// The claim next-step for a found report. Eligibility shown here is a hint;
// app/actions/claim.ts re-checks every rule inside a locked transaction.
export default function ClaimLink({ foundId, context, signedIn }: {
  foundId: number;
  context?: FoundReportContext;
  signedIn: boolean;
}) {
  const note = "flex items-start gap-2 text-sm text-ink-2";
  if (context?.Has_Handover) return <p className={note}><Icon name="gift" size={16} className="mt-0.5 text-success" />This item has already been handed over.</p>;
  if (!signedIn) return <Link href="/login" className="btn btn-secondary btn-sm"><Icon name="logIn" size={16} />Sign In to claim an item</Link>;
  if (!context) return <p className={note}><Icon name="alert" size={16} className="mt-0.5" /><span>Claim availability could not be checked. <Link href="/claim" className="link">Open My Claims</Link></span></p>;
  if (context.Is_Own_Report) return <p className={note}><Icon name="user" size={16} className="mt-0.5" />You reported this item. You cannot claim your own found report.</p>;
  if (context.Own_Claim_ID !== null) return <p className={note}><Icon name="clipboard" size={16} className="mt-0.5 text-claim" /><span>You have already claimed this item. <Link href={`/claim#claim-${context.Own_Claim_ID}`} className="link">View My Claim</Link></span></p>;
  return <Link href={`/claim?foundId=${foundId}#submit-claim`} className="btn btn-primary btn-sm"><Icon name="clipboard" size={16} />Claim this item</Link>;
}
