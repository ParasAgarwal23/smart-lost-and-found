"use client";

import { useActionState, useState } from "react";
import { withdrawClaim, type WithdrawState } from "@/app/actions/claim";
import { FormFeedback, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import { WITHDRAWN_EVENT } from "./withdraw-notice";

const initialState: WithdrawState = { error: null, success: null };

// Two-step destructive action with an inline confirmation (no browser dialogs).
export default function WithdrawClaim({ claimId, evidenceCount }: { claimId: number; evidenceCount: number }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(async (previous: WithdrawState, data: FormData) => {
    const result = await withdrawClaim(previous, data);
    // This card is removed by the refresh, so hand the confirmation to the page.
    if (result.success && !result.error) window.dispatchEvent(new CustomEvent(WITHDRAWN_EVENT, { detail: result.success }));
    return result;
  }, initialState);

  if (!confirming) {
    return (
      <div className="grid gap-2">
        <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setConfirming(true)}>
          <Icon name="trash" size={16} />Withdraw claim
        </button>
        {state.error && <FormFeedback id={`withdraw-feedback-${claimId}`} error={state.error} success={null} />}
      </div>
    );
  }

  return (
    <form action={action} aria-busy={pending} className="grid w-full gap-3 rounded-xl border border-danger/30 bg-danger-soft p-3">
      <input type="hidden" name="claimId" value={claimId} />
      <p className="text-sm font-semibold text-danger">
        Withdraw this claim{evidenceCount > 0 ? ` and its ${evidenceCount} evidence ${evidenceCount === 1 ? "entry" : "entries"}` : ""}? This cannot be undone.
      </p>
      <FormFeedback id={`withdraw-feedback-${claimId}`} error={state.error} success={state.success} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} pendingLabel="Withdrawing…" className="btn btn-danger btn-sm">Yes, withdraw</SubmitButton>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)} disabled={pending}>Keep claim</button>
      </div>
    </form>
  );
}
