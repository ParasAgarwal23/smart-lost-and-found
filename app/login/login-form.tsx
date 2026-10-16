"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "@/app/actions/auth";
import { Field, FormFeedback, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";

const initialState: LoginState = { error: null };

export default function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} aria-busy={pending} className="mt-7 grid gap-5">
      {next && <input type="hidden" name="next" value={next} />}
      <Field id="email" label="Email">
        <input
          id="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby="login-feedback"
          aria-invalid={!!state.error}
          type="email"
          autoComplete="username"
          required
          maxLength={100}
          placeholder="you@example.edu"
          className="input"
        />
      </Field>
      <Field id="password" label="Password">
        <div className="relative">
          <input
            id="password"
            name="password"
            aria-describedby="login-feedback"
            aria-invalid={!!state.error}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={1024}
            className="input pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"
          >
            <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
          </button>
        </div>
      </Field>
      <FormFeedback id="login-feedback" error={state.error} success={null} />
      <SubmitButton pending={pending} pendingLabel="Signing in…" className="btn btn-primary btn-lg w-full">
        <Icon name="logIn" size={18} />Sign In
      </SubmitButton>
    </form>
  );
}
