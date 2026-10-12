"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addClaimEvidence, type EvidenceState } from "@/app/actions/claim-evidence";

const initialState: EvidenceState = { error: null, success: null };

export default function EvidenceForm({ claims, initialClaimId }: {
  claims: { Claim_ID: number; Item_Name: string | null }[];
  initialClaimId?: number;
}) {
  const [claimId, setClaimId] = useState(String(initialClaimId ?? ""));
  const [description, setDescription] = useState("");
  const [state, action, pending] = useActionState(async (previous: EvidenceState, data: FormData) => {
    const result = await addClaimEvidence(previous, data);
    if (result.success && !result.error) setDescription("");
    return result;
  }, initialState);
  const fieldClass = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700";

  return (
    // Expected action errors also trigger React's native reset; clear only on success above.
    <form onReset={(event) => event.preventDefault()} action={action} aria-busy={pending} className="mt-6 space-y-4">
      <div>
        <label htmlFor="claimId" className="block text-sm font-medium">Your claim</label>
        <select key={initialClaimId ?? "generic"} id="claimId" name="claimId" required value={claimId} onChange={(event) => setClaimId(event.target.value)} aria-describedby="evidence-feedback" aria-invalid={!!state.fieldErrors?.claimId} className={fieldClass}>
          <option value="" disabled>Select a claim</option>
          {claims.map((claim) => (
            <option key={claim.Claim_ID} value={claim.Claim_ID}>
              {claim.Claim_ID} — {claim.Item_Name ?? "Unnamed item"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="description" className="block text-sm font-medium">Evidence description</label>
        <p id="evidence-hint" className="mt-1 text-sm text-slate-600">Required: describe a distinctive detail or proof of ownership (up to 255 characters). Only your account can view this evidence here.</p>
        <textarea id="description" name="description" value={description} onChange={(event) => setDescription(event.target.value)} aria-describedby="evidence-hint evidence-feedback" aria-invalid={!!state.fieldErrors?.description} required maxLength={255} rows={4} className={fieldClass} />
      </div>
      <p id="evidence-feedback" role="status" aria-live="polite" className={state.error ? "text-sm text-red-700" : "text-sm text-teal-700"}>
        {state.error ?? state.success}
      </p>
      <button type="submit" disabled={pending} className="min-h-11 w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Submitting…" : "Add evidence"}
      </button>
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-4 text-sm font-medium text-teal-700 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:underline [&_a:hover]:text-teal-800">
          <Link href="/claim">Back to My Claims</Link>
          {state.claimId && <Link href={`/claim/evidence?claimId=${state.claimId}#evidence-${state.claimId}`}>View Evidence</Link>}
          <a href="#claimId">Add Another Evidence</a>
        </nav>
      )}
    </form>
  );
}
