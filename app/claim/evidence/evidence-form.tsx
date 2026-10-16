"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addClaimEvidence, type EvidenceState } from "@/app/actions/claim-evidence";
import { describedBy, Field, FormFeedback, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";

const initialState: EvidenceState = { error: null, success: null };

export default function EvidenceForm({ claims, initialClaimId }: {
  claims: { Claim_ID: number; Item_Name: string | null; Has_Handover?: boolean }[];
  initialClaimId?: number;
}) {
  const [claimId, setClaimId] = useState(String(initialClaimId ?? ""));
  const [description, setDescription] = useState("");
  const [state, action, pending] = useActionState(async (previous: EvidenceState, data: FormData) => {
    const result = await addClaimEvidence(previous, data);
    if (result.success && !result.error) setDescription("");
    return result;
  }, initialState);
  const errors = state.fieldErrors ?? {};

  return (
    // Expected action errors also trigger React's native reset; clear only on success above.
    <form onReset={(event) => event.preventDefault()} action={action} aria-busy={pending} className="mt-6 grid gap-5">
      <Field id="claimId" label="Which claim is this for?" error={errors.claimId ? "Choose one of your claims." : undefined}>
        <select key={initialClaimId ?? "generic"} id="claimId" name="claimId" required value={claimId} onChange={(event) => setClaimId(event.target.value)}
          aria-describedby={describedBy("claimId", { error: !!errors.claimId }, "evidence-feedback")} aria-invalid={!!errors.claimId} className="input">
          <option value="" disabled>Select a claim</option>
          {claims.map((claim) => (
            <option key={claim.Claim_ID} value={claim.Claim_ID}>
              {claim.Item_Name ?? "Unnamed item"} (claim {claim.Claim_ID})
            </option>
          ))}
        </select>
      </Field>
      <Field id="description" label="What proves it's yours?" error={errors.description ? "Enter 1 to 255 characters." : undefined}
        hint="One detail per entry, e.g. “Receipt no. 4521” or “Initials scratched under the lid”. You can add more later."
        counter={<span className="counter" aria-hidden="true">{description.length}/255</span>}>
        <textarea id="description" name="description" value={description} onChange={(event) => setDescription(event.target.value)}
          aria-describedby={describedBy("description", { hint: true, error: !!errors.description }, "evidence-feedback")}
          aria-invalid={!!errors.description} required maxLength={255} rows={4} className="input" />
      </Field>
      <FormFeedback id="evidence-feedback" error={state.error} success={state.success} />
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-2">
          <Link href="/claim" className="btn btn-primary btn-sm"><Icon name="clipboard" size={16} />Back to My Claims</Link>
          {state.claimId && <Link href={`/claim/evidence?claimId=${state.claimId}#evidence-${state.claimId}`} className="btn btn-secondary btn-sm">See all evidence for this claim</Link>}
        </nav>
      )}
      <div className="divider flex justify-end pt-5">
        <SubmitButton pending={pending} pendingLabel="Submitting…"><Icon name="plus" size={17} />Save evidence</SubmitButton>
      </div>
    </form>
  );
}
