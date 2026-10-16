"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";

// Error boundary for unexpected failures; no internal details are shown.
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" tabIndex={-1} className="container-page py-16">
      <section className="card card-pad mx-auto grid max-w-xl justify-items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-danger-soft text-danger"><Icon name="alert" size={24} /></span>
        <h1 className="font-display text-2xl font-semibold">We couldn&apos;t load this page</h1>
        <p role="alert" className="text-ink-2">Please try again. If the problem continues, return Home and try later.</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className="btn btn-primary"><Icon name="refresh" size={17} />Try again</button>
          <Link href="/" className="btn btn-secondary"><Icon name="home" size={17} />Back to Home</Link>
        </div>
      </section>
    </main>
  );
}
