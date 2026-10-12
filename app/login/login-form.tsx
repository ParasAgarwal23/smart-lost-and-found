"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "@/app/actions/auth";

const initialState: LoginState = { error: null };

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby="login-feedback"
          type="email"
          autoComplete="username"
          required
          maxLength={100}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          aria-describedby="login-feedback"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700"
        />
      </div>
      <p id="login-feedback" role="status" aria-live="polite" className="text-sm text-red-700">
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}
