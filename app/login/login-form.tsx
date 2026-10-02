"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";

const initialState: LoginState = { error: null };

export default function LoginForm() {
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
          type="email"
          autoComplete="username"
          required
          maxLength={100}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-teal-700"
        />
      </div>
      <p role="status" aria-live="polite" className="text-sm text-red-700">
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
