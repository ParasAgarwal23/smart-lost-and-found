"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createClaim, type ClaimState } from "@/app/actions/claim";

const initialState: ClaimState = { error: null, success: null };

export default function ClaimForm({ reports, initialFoundId, selectionError = null, unavailable = false }: {
  reports: { Found_ID: number; Item_Name: string | null }[];
  unavailable?: boolean;
  initialFoundId?: number;
  selectionError?: string | null;
}) {
  const [foundId, setFoundId] = useState(String(initialFoundId ?? ""));
  const [state, action, pending] = useActionState(async (previous: ClaimState, data: FormData) => {
    const result = await createClaim(previous, data);
    if (result.success && !result.error) setFoundId("");
    return result;
  }, initialState);

  return (
    // Expected action errors also trigger React's native reset; clear only on success above.
    <form onReset={(event) => event.preventDefault()} action={action} aria-busy={pending} className="mt-6 space-y-4">
      {selectionError && !state.success && <p role="alert" className="text-sm text-red-700">{selectionError}</p>}
      {!unavailable && reports.length > 0 && <div>
        <label htmlFor="foundId" className="block text-sm font-medium">Found report</label>
        <select id="foundId" name="foundId" required disabled={unavailable || reports.length === 0} value={foundId} onChange={(event) => setFoundId(event.target.value)} aria-describedby="claim-feedback" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700">
          <option value="" disabled>Select a found report</option>
          {reports.map((report) => (
            <option key={report.Found_ID} value={report.Found_ID}>
              {report.Found_ID} — {report.Item_Name ?? "Unnamed item"}
            </option>
          ))}
        </select>
      </div>}
      <p id="claim-feedback" role="status" aria-live="polite" className={state.error ? "text-sm text-red-700" : "text-sm text-teal-700"}>
        {state.error ?? state.success}
      </p>
      {!unavailable && reports.length > 0 && <button type="submit" disabled={pending || unavailable || reports.length === 0} className="min-h-11 w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Submitting…" : "Submit claim"}
      </button>}
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-4 text-sm font-medium text-teal-700 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:underline [&_a:hover]:text-teal-800">
          <Link href="/">Back to Home</Link>
          <a href={state.claimId ? `#claim-${state.claimId}` : "#my-claims"}>View My Claim</a>
          <Link href={state.claimId ? `/claim/evidence?claimId=${state.claimId}` : "/claim/evidence"}>Add Evidence</Link>
        </nav>
      )}
    </form>
  );
}
