"use client";

import { useActionState } from "react";
import { addClaimEvidence, type EvidenceState } from "@/app/actions/claim-evidence";

const initialState: EvidenceState = { error: null, success: null };

export default function EvidenceForm({ claims }: {
  claims: { Claim_ID: number; Item_Name: string | null }[];
}) {
  const [state, action, pending] = useActionState(addClaimEvidence, initialState);
  const fieldClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700";

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="claimId" className="block text-sm font-medium">Your claim</label>
        <select id="claimId" name="claimId" required defaultValue="" className={fieldClass}>
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
        <textarea id="description" name="description" required maxLength={255} rows={4} className={fieldClass} />
      </div>
      <p role="status" aria-live="polite" className={state.error ? "text-sm text-red-700" : "text-sm text-teal-700"}>
        {state.error ?? state.success}
      </p>
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Submitting…" : "Add evidence"}
      </button>
    </form>
  );
}
