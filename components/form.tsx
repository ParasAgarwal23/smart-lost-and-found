import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import SignInAgain from "@/components/sign-in-again";

// Labelled field wrapper. Hint and error ids are linked to the control by the
// caller through aria-describedby so screen readers announce them together.
export function Field({ id, label, hint, error, optional, counter, children }: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  counter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label">
          {label}{optional && <span className="label-optional"> (optional)</span>}
        </label>
        {counter}
      </div>
      {hint && <p id={`${id}-hint`} className="hint">{hint}</p>}
      {children}
      {error && <p id={`${id}-error`} className="field-error"><Icon name="alert" size={15} className="mt-0.5" />{error}</p>}
    </div>
  );
}

export function describedBy(id: string, { hint, error }: { hint?: boolean; error?: boolean }, ...extra: string[]) {
  return [hint && `${id}-hint`, error && `${id}-error`, ...extra].filter(Boolean).join(" ") || undefined;
}

// One polite live region per form announces both validation and success results.
// signedOut: the action found no session, so offer a way to sign in again.
export function FormFeedback({ id, error, success, signedOut = false, children }: {
  id: string;
  error: string | null;
  success: string | null;
  signedOut?: boolean;
  children?: ReactNode;
}) {
  const tone = error ? "notice-error" : success ? "notice-success" : "";
  const message = error ?? success;
  return (
    <div id={id} role="status" aria-live="polite" className={message ? `notice ${tone}` : "feedback"}>
      {message && <>
        <Icon name={error ? "alert" : "checkCircle"} size={20} className="mt-0.5" />
        <div className="min-w-0"><p className="font-semibold">{message}</p>{error && signedOut && <SignInAgain />}{children}</div>
      </>}
    </div>
  );
}

export function SubmitButton({ pending, pendingLabel, children, className = "btn btn-primary w-full sm:w-auto", disabled }: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled} className={className}>
      {pending ? <><span className="spinner" aria-hidden="true" />{pendingLabel}</> : children}
    </button>
  );
}
