"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createHandover, type HandoverState } from "@/app/actions/handover";

const initialState: HandoverState = { error: null, success: null };

export default function HandoverForm({ claims }: {
  claims: { Claim_ID: number; Item_Name: string | null }[];
}) {
  const [state, action, pending] = useActionState(createHandover, initialState);
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
        <label htmlFor="signature" className="block text-sm font-medium">Signature / acknowledgement</label>
        <input id="signature" name="signature" required maxLength={100} className={fieldClass} />
      </div>
      <p role="status" aria-live="polite" className={state.error ? "text-sm text-red-700" : "text-sm text-teal-700"}>
        {state.error ?? state.success}
      </p>
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Submitting…" : "Confirm item received"}
      </button>
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-4 text-sm font-medium text-teal-700 [&_a]:underline [&_a:hover]:text-teal-800">
          <Link href="/">Back to Home</Link>
          <Link href="/claim">Claims</Link>
        </nav>
      )}
    </form>
  );
}
