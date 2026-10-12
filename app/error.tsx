"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
        <h1 className="text-2xl font-bold">We couldn&apos;t load this page</h1>
        <p role="alert" className="mt-3 text-slate-600">Please try again. If the problem continues, return Home and try later.</p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button onClick={reset} className="min-h-11 rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800">Try again</button>
          <Link href="/" className="inline-flex min-h-11 items-center font-medium text-teal-700 underline">Back to Home</Link>
        </div>
      </section>
    </main>
  );
}
