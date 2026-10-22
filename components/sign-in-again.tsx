"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "@/components/icons";
import { loginPath } from "@/lib/next-path";

export const SESSION_ENDED_EVENT = "session-ended";

// Shown when an action finds no signed-in session (e.g. it expired). Sign In
// opens in a new tab so the draft in this one survives, and the header, which
// lives in the root layout and is not re-rendered here, is told to show the
// signed-out state.
export default function SignInAgain() {
  const pathname = usePathname();
  const query = useSearchParams().toString();

  useEffect(() => {
    window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
  }, []);

  return (
    <div className="mt-2 grid justify-items-start gap-1.5">
      <a href={loginPath(query ? `${pathname}?${query}` : pathname)} target="_blank" rel="noopener" className="btn btn-secondary btn-sm">
        <Icon name="logIn" size={16} />Sign in again in a new tab
      </a>
      <p className="text-sm">Then come back to this tab and submit again.</p>
    </div>
  );
}
