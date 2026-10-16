"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

export const WITHDRAWN_EVENT = "claim-withdrawn";

// A withdrawn claim's card (and its form state) disappears when the page
// refreshes, so the confirmation is announced from this persistent region.
export default function WithdrawNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const show = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener(WITHDRAWN_EVENT, show);
    return () => window.removeEventListener(WITHDRAWN_EVENT, show);
  }, []);

  return (
    <div role="status" aria-live="polite" className={message ? "notice notice-success mt-4" : "feedback"}>
      {message && <>
        <Icon name="checkCircle" size={20} className="mt-0.5" />
        <p className="min-w-0 flex-1 font-semibold">{message}</p>
        <button type="button" onClick={() => setMessage(null)} className="btn btn-ghost btn-sm -my-1" aria-label="Dismiss message">
          <Icon name="close" size={16} />
        </button>
      </>}
    </div>
  );
}
