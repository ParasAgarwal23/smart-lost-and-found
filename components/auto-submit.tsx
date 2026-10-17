"use client";

import { useEffect, useRef, useState } from "react";

// Placed inside a GET form: submits it as soon as a select or radio changes, so
// filters apply without an extra button press. Free-text fields still submit on
// Enter or the form's own button. While the next page loads, the element named
// by resultsId is marked busy (dimmed) so old results are not mistaken for new.
export default function AutoSubmit({ resultsId }: { resultsId?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const results = resultsId ? document.getElementById(resultsId) : null;
    const query = () => new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString();
    let lastQuery = query();
    const setBusy = (busy: boolean) => {
      setPending(busy);
      if (busy) results?.setAttribute("aria-busy", "true");
      else results?.removeAttribute("aria-busy");
    };
    const onChange = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.matches("select, input[type=radio]")) return;
      if (query() === lastQuery) return; // Nothing new to ask for.
      form.requestSubmit();
    };
    const onSubmit = () => { lastQuery = query(); setBusy(true); };
    // Returning with the Back button can restore this page from cache mid-"loading".
    const onPageShow = () => { lastQuery = query(); setBusy(false); };
    form.addEventListener("change", onChange);
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      form.removeEventListener("change", onChange);
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [resultsId]);

  return <span ref={ref} role="status" className="sr-only">{pending ? "Updating results…" : ""}</span>;
}
