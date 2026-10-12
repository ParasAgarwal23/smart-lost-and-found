"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createHandover, type HandoverState } from "@/app/actions/handover";

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
  const fieldClass = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700";

  return (
    // Expected action errors also trigger React's native reset; clear only on success above.
    <form onReset={(event) => event.preventDefault()} action={action} aria-busy={pending} className="mt-6 space-y-4">
      {selectionError && !state.success && <p role="alert" className="text-sm text-red-700">{selectionError}</p>}
      {!unavailable && claims.length > 0 && <>
      <div>
        <label htmlFor="claimId" className="block text-sm font-medium">Your claim</label>
        <select key={initialClaimId ?? "generic"} id="claimId" name="claimId" required disabled={unavailable || claims.length === 0} value={claimId} onChange={(event) => setClaimId(event.target.value)} aria-describedby="handover-feedback" className={fieldClass}>
          <option value="" disabled>Select a claim</option>
          {claims.map((claim) => (
            <option key={claim.Claim_ID} value={claim.Claim_ID}>
              {claim.Claim_ID} — {claim.Item_Name ?? "Unnamed item"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="signature" className="block text-sm font-medium">Signature / acknowledgement</label>
        <p id="signature-hint" className="mt-1 text-sm text-slate-600">Required: enter your name or acknowledgement, up to 100 characters. Confirm only after receiving the item.</p>
        <input id="signature" name="signature" value={signature} onChange={(event) => setSignature(event.target.value)} aria-describedby="signature-hint handover-feedback" required maxLength={100} className={fieldClass} />
      </div>
      </>}
      <p id="handover-feedback" role="status" aria-live="polite" className={state.error ? "text-sm text-red-700" : "text-sm text-teal-700"}>
        {state.error ?? state.success}
      </p>
      {!unavailable && claims.length > 0 && <button type="submit" disabled={pending} className="min-h-11 w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Submitting…" : "Confirm item received"}
      </button>}
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-4 text-sm font-medium text-teal-700 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:underline [&_a:hover]:text-teal-800">
          <Link href="/">Back to Home</Link>
          <Link href="/claim">Back to My Claims</Link>
        </nav>
      )}
    </form>
  );
}
