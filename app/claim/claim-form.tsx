"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createClaim, type ClaimState } from "@/app/actions/claim";
import { Field, FormFeedback, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import { formatDate } from "@/components/ui";

const initialState: ClaimState = { error: null, success: null };

export type ClaimableReport = { Found_ID: number; Item_Name: string | null; Location_Name: string | null; Date_Found: string | null };

export default function ClaimForm({ reports, initialFoundId, selectionError = null, unavailable = false }: {
  reports: ClaimableReport[];
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
    <form onReset={(event) => event.preventDefault()} action={action} aria-busy={pending} className="mt-4 grid gap-4">
      {selectionError && !state.success && <p role="alert" className="notice notice-warning"><Icon name="alert" size={18} className="mt-0.5" />{selectionError}</p>}
      {!unavailable && reports.length > 0 && (
        <Field id="foundId" label="Item you are claiming" hint="Only items you can claim are listed (not your own reports, items you already claimed, or items already returned).">
          <select id="foundId" name="foundId" required disabled={unavailable || reports.length === 0} value={foundId} onChange={(event) => setFoundId(event.target.value)} aria-describedby="foundId-hint claim-feedback" className="input">
            <option value="" disabled>Choose a found item</option>
            {reports.map((report) => (
              <option key={report.Found_ID} value={report.Found_ID}>
                {report.Item_Name ?? "Unnamed item"}{report.Location_Name ? ` — ${report.Location_Name}` : ""}{report.Date_Found ? `, found ${formatDate(report.Date_Found)}` : ""}
              </option>
            ))}
          </select>
        </Field>
      )}
      <FormFeedback id="claim-feedback" error={state.error} success={state.success}>
        {state.success && !state.error && <p className="mt-1">Next, add proof that it&apos;s yours.</p>}
      </FormFeedback>
      {state.success && !state.error && (
        <nav aria-label="Next steps" className="flex flex-wrap gap-2">
          <Link href={state.claimId ? `/claim/evidence?claimId=${state.claimId}` : "/claim/evidence"} className="btn btn-primary btn-sm"><Icon name="file" size={16} />Add evidence now</Link>
          <a href={state.claimId ? `#claim-${state.claimId}` : "#my-claims"} className="btn btn-secondary btn-sm">View My Claim</a>
        </nav>
      )}
      {!unavailable && reports.length > 0 && (
        <SubmitButton pending={pending} pendingLabel="Submitting…" className="btn btn-primary w-full">
          <Icon name="clipboard" size={17} />Claim this item
        </SubmitButton>
      )}
    </form>
  );
}
