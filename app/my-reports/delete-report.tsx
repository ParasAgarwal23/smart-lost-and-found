"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deleteReport, type DeleteReportState } from "@/app/actions/report-delete";
import { FormFeedback, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";

const initialState: DeleteReportState = { error: null, success: null };

// Two-step destructive action with an inline confirmation (no browser dialogs),
// following app/claim/withdraw-claim.tsx. On success the action redirects back
// to My Reports, which announces the deletion.
export default function DeleteReport({ kind, reportId, itemName }: { kind: "lost" | "found"; reportId: number; itemName: string }) {
  const [confirming, setConfirming] = useState(false);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [state, action, pending] = useActionState(deleteReport, initialState);
  const feedbackId = `delete-feedback-${kind}-${reportId}`;

  // The button that opens or closes the confirmation is replaced, so keep
  // keyboard focus in place: on the question, then back on "Delete".
  useEffect(() => {
    if (confirming) questionRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      deleteRef.current?.focus();
    }
  }, [confirming]);

  if (!confirming) {
    return (
      <div className="grid gap-2">
        <button ref={deleteRef} type="button" className="link-quiet text-danger" onClick={() => setConfirming(true)}>
          <Icon name="trash" size={15} />Delete<span className="sr-only"> {itemName}</span>
        </button>
        {state.error && <FormFeedback id={feedbackId} error={state.error} success={null} signedOut={state.signedOut} />}
      </div>
    );
  }

  return (
    <form action={action} aria-busy={pending} className="grid w-full gap-3 rounded-xl border border-danger/30 bg-danger-soft p-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="reportId" value={reportId} />
      <p ref={questionRef} tabIndex={-1} className="text-sm font-semibold text-danger">
        Delete “{itemName}”? {kind === "lost"
          ? "Its possible matches will no longer be shown."
          : "Nobody will be able to find or claim it."} This cannot be undone.
      </p>
      <FormFeedback id={feedbackId} error={state.error} success={state.success} signedOut={state.signedOut} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} pendingLabel="Deleting…" className="btn btn-danger btn-sm">Yes, delete report</SubmitButton>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { returnFocus.current = true; setConfirming(false); }} disabled={pending}>Keep report</button>
      </div>
    </form>
  );
}
