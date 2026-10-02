"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createClaim, type ClaimState } from "@/app/actions/claim";

const initialState: ClaimState = { error: null, success: null };

export default function ClaimForm({ reports }: {
  reports: { Found_ID: number; Item_Name: string | null }[];
}) {
  const [state, action, pending] = useActionState(createClaim, initialState);

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="foundId" className="block text-sm font-medium">Found report</label>
        <select id="foundId" name="foundId" required defaultValue="" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700">
          <option value="" disabled>Select a found report</option>
          {reports.map((report) => (
            <option key={report.Found_ID} value={report.Found_ID}>
              {report.Found_ID} — {report.Item_Name ?? "Unnamed item"}
            </option>
          ))}
        </select>
      </div>
      <p role="status" aria-live="polite" className={state.error ? "text-sm text-red-700" : "text-sm text-teal-700"}>
        {state.error ?? state.success}
      </p>
      <button type="submit" disabled={pending} className="w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Submitting…" : "Submit claim"}
      </button>
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-4 text-sm font-medium text-teal-700 [&_a]:underline [&_a:hover]:text-teal-800">
          <Link href="/">Back to Home</Link>
          <Link href="/claim/evidence">Add Evidence</Link>
        </nav>
      )}
    </form>
  );
}
