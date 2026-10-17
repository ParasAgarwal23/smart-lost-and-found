"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createHandover, type HandoverState } from "@/app/actions/handover";
import ClaimPicker, { type PickableClaim } from "@/app/claim/claim-picker";
import { Field, FormFeedback, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/ui";

const initialState: HandoverState = { error: null, success: null };

export type HandoverClaim = PickableClaim;

export default function HandoverForm({ claims, initialClaimId, selectionError = null, error = null }: {
  claims: HandoverClaim[];
  initialClaimId?: number;
  selectionError?: string | null;
  error?: string | null;
}) {
  const [claimId, setClaimId] = useState(String(initialClaimId ?? ""));
  const [signature, setSignature] = useState("");
  const [state, action, pending] = useActionState(async (previous: HandoverState, data: FormData) => {
    const result = await createHandover(previous, data);
    if (result.success && !result.error) { setSignature(""); setClaimId(""); }
    return result;
  }, initialState);
  // After a receipt is recorded, the page revalidates and the claim leaves the
  // list; show only the completed outcome rather than an empty state as well.
  const done = !!state.success && !state.error;
  const usable = !error && !done && claims.length > 0;

  return (
    <>
      {usable && (
        <Notice tone="warning" title="Before you confirm" className="mt-6">
          This can&apos;t be undone. The item is marked as returned and no one else can claim it afterwards.
        </Notice>
      )}
      <section aria-label="Record receipt" className="card card-pad report-card rail-done mt-6">
        {selectionError && !done && <p role="alert" className="notice notice-warning"><Icon name="alert" size={18} className="mt-0.5" />{selectionError}</p>}
        {error ? <Notice tone="error">{error}</Notice> : !done && claims.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="gift" size={22} /></span>
            <p className="text-lg font-bold">You have no claims waiting for confirmation.</p>
            <p className="max-w-md text-sm text-ink-2">Only claims for items that have not already been handed over can be confirmed. View My Claims for recorded receipts.</p>
          </div>
        )}
        {/* Expected action errors also trigger React's native reset; clear only on success above. */}
        <form onReset={(event) => event.preventDefault()} action={action} aria-busy={pending} className="grid gap-5">
          {usable && <>
            <ClaimPicker claims={claims} initialClaimId={initialClaimId} value={claimId} onChange={setClaimId}
              label="Which item did you receive?" switchHref="/claim/handover" describedBy="handover-feedback" />
            <Field id="signature" label="Type your name to confirm" hint="This acts as your signature on the receipt (up to 100 characters)."
              counter={<span className="counter" aria-hidden="true">{signature.length}/100</span>}>
              <input id="signature" name="signature" value={signature} onChange={(event) => setSignature(event.target.value)} aria-describedby="signature-hint handover-feedback" required maxLength={100} autoComplete="name" className="input" />
            </Field>
          </>}
          <FormFeedback id="handover-feedback" error={state.error} success={state.success} />
          {done && (
            <nav aria-label="Next steps" className="flex flex-wrap gap-2">
              <Link href="/claim" className="btn btn-primary btn-sm"><Icon name="clipboard" size={16} />Back to My Claims</Link>
            </nav>
          )}
          {usable && (
            <div className="divider flex justify-end pt-5">
              <SubmitButton pending={pending} pendingLabel="Recording…"><Icon name="gift" size={17} />Yes, I received it</SubmitButton>
            </div>
          )}
        </form>
      </section>
    </>
  );
}
