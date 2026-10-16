"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createHandover, type HandoverState } from "@/app/actions/handover";
import { Field, FormFeedback, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";

const initialState: HandoverState = { error: null, success: null };

export default function HandoverForm({ claims, initialClaimId, selectionError = null, unavailable = false }: {
  claims: { Claim_ID: number; Item_Name: string | null }[];
  initialClaimId?: number;
  selectionError?: string | null;
  unavailable?: boolean;
}) {
  const [claimId, setClaimId] = useState(String(initialClaimId ?? ""));
  const [signature, setSignature] = useState("");
  const [state, action, pending] = useActionState(async (previous: HandoverState, data: FormData) => {
    const result = await createHandover(previous, data);
    if (result.success && !result.error) { setSignature(""); setClaimId(""); }
    return result;
  }, initialState);

  return (
    // Expected action errors also trigger React's native reset; clear only on success above.
    <form onReset={(event) => event.preventDefault()} action={action} aria-busy={pending} className="mt-6 grid gap-5">
      {selectionError && !state.success && <p role="alert" className="notice notice-warning"><Icon name="alert" size={18} className="mt-0.5" />{selectionError}</p>}
      {!unavailable && claims.length > 0 && <>
        <Field id="claimId" label="Which item did you receive?">
          <select key={initialClaimId ?? "generic"} id="claimId" name="claimId" required disabled={unavailable || claims.length === 0} value={claimId} onChange={(event) => setClaimId(event.target.value)} aria-describedby="handover-feedback" className="input">
            <option value="" disabled>Select a claim</option>
            {claims.map((claim) => (
              <option key={claim.Claim_ID} value={claim.Claim_ID}>
                {claim.Item_Name ?? "Unnamed item"} (claim {claim.Claim_ID})
              </option>
            ))}
          </select>
        </Field>
        <Field id="signature" label="Type your name to confirm" hint="This acts as your signature on the receipt (up to 100 characters)."
          counter={<span className="counter" aria-hidden="true">{signature.length}/100</span>}>
          <input id="signature" name="signature" value={signature} onChange={(event) => setSignature(event.target.value)} aria-describedby="signature-hint handover-feedback" required maxLength={100} autoComplete="name" className="input" />
        </Field>
      </>}
      <FormFeedback id="handover-feedback" error={state.error} success={state.success} />
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-2">
          <Link href="/claim" className="btn btn-secondary btn-sm"><Icon name="clipboard" size={16} />Back to My Claims</Link>
          <Link href="/" className="btn btn-ghost btn-sm">Back to Home</Link>
        </nav>
      )}
      {!unavailable && claims.length > 0 && (
        <div className="divider flex justify-end pt-5">
          <SubmitButton pending={pending} pendingLabel="Recording…"><Icon name="gift" size={17} />Yes, I received it</SubmitButton>
        </div>
      )}
    </form>
  );
}
