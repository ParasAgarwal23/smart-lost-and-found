"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { register, type RegisterState } from "@/app/actions/register";
import { describedBy, Field, FormFeedback, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";

const initialState: RegisterState = { error: null };

// Controlled fields keep what was typed when the server rejects the form
// (passwords excepted). There is deliberately no role field: every public
// registration creates a USER account.
export default function RegisterForm() {
  const [values, setValues] = useState({ name: "", email: "", phone: "" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: RegisterState, data: FormData) => {
    const result = await register(previous, data);
    setPassword("");
    setConfirmPassword("");
    return result;
  }, initialState);
  const errors = state.fieldErrors ?? {};
  // Shown as soon as the second password is typed; the server checks it again.
  const mismatch = confirmPassword !== "" && password !== confirmPassword;
  const confirmError = errors.confirmPassword ?? (mismatch ? "The passwords do not match." : undefined);
  const set = (key: keyof typeof values) => (event: ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form action={formAction} aria-busy={pending} noValidate className="mt-7 grid gap-5">
      <Field id="name" label="Full name" error={errors.name}>
        <input id="name" name="name" value={values.name} onChange={set("name")} autoComplete="name" required maxLength={100}
          aria-invalid={!!errors.name} aria-describedby={describedBy("name", { error: !!errors.name })} className="input" />
      </Field>
      <Field id="email" label="Email" error={errors.email}>
        <input id="email" name="email" type="email" value={values.email} onChange={set("email")} autoComplete="email" required maxLength={100}
          placeholder="you@example.edu" aria-invalid={!!errors.email} aria-describedby={describedBy("email", { error: !!errors.email })} className="input" />
      </Field>
      <Field id="phone" label="Phone number" hint="7 to 15 digits; spaces, hyphens and a leading + are fine." error={errors.phone}>
        <input id="phone" name="phone" type="tel" value={values.phone} onChange={set("phone")} autoComplete="tel" required maxLength={15}
          placeholder="+91 98765 43210" aria-invalid={!!errors.phone} aria-describedby={describedBy("phone", { hint: true, error: !!errors.phone })} className="input" />
      </Field>
      <Field id="password" label="Password" hint="10 to 128 characters. A longer passphrase is stronger." error={errors.password}>
        <div className="relative">
          <input id="password" name="password" type={showPassword ? "text" : "password"} value={password}
            onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={10} maxLength={128}
            aria-invalid={!!errors.password} aria-describedby={describedBy("password", { hint: true, error: !!errors.password })} className="input pr-12" />
          <button type="button" onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide passwords" : "Show passwords"} aria-pressed={showPassword}
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink">
            <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
          </button>
        </div>
      </Field>
      <Field id="confirmPassword" label="Confirm password" error={confirmError}>
        <input id="confirmPassword" name="confirmPassword" type={showPassword ? "text" : "password"} value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required maxLength={128}
          aria-invalid={!!confirmError} aria-describedby={describedBy("confirmPassword", { error: !!confirmError })} className="input" />
      </Field>
      <FormFeedback id="register-feedback" error={state.error} success={null} />
      <SubmitButton pending={pending} pendingLabel="Creating account…" className="btn btn-primary btn-lg w-full">
        <Icon name="user" size={18} />Create account
      </SubmitButton>
    </form>
  );
}
