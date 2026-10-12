import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { getAuthenticatedUser } from "@/lib/auth";

export default async function Home() {
  const user = await getAuthenticatedUser();
  const primary = "inline-flex min-h-11 items-center justify-center rounded-lg bg-teal-700 px-4 py-3 text-center font-medium text-white hover:bg-teal-800";
  const secondary = "inline-flex min-h-11 items-center justify-center rounded-lg border border-teal-700 px-4 py-3 text-center font-medium text-teal-700 hover:bg-teal-50";

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <section className="home-hero">
        <p className="eyebrow">CAMPUS LOST &amp; FOUND</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">A little help finding<br />what matters.</h1>
        <p className="mt-5 leading-7 text-slate-600">Lost something on campus? Search reported items, describe what is missing, and find your next step.</p>
        {!user && <p className="mt-3 text-sm text-slate-600">Anyone can search. Sign In to report an item, find potential matches, or submit a claim.</p>}
        {user && <p className="account-label">Signed in <span className="badge">{user.Role === "ADMIN" ? "ADMIN account" : "USER account"}</span><span className="block mt-2 text-sm text-slate-600">Your claims and evidence are private to your account.</span></p>}
        <nav aria-label="Main actions" className="mt-7 grid gap-3 sm:grid-cols-2">
          <Link href="/search" className={primary}>Search Lost &amp; Found</Link>
          {user ? <Link href="/claim" className={secondary}>My Claims</Link> : <Link href="/login" className={secondary}>Sign In</Link>}
          {user && <>
            <Link href="/lost-report" className={secondary}>Report Lost Item</Link>
            <Link href="/found-report" className={secondary}>Report Found Item</Link>
          </>}
        </nav>
        {user && <nav aria-label="Account and matching" className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <Link href="/potential-matches" className="inline-flex min-h-11 items-center font-medium text-teal-700 underline">Potential Matches</Link>
          {user.Role === "ADMIN" && <Link href="/admin/campus-summary" className="inline-flex min-h-11 items-center gap-2 font-medium text-teal-700 underline">Campus Summary <span className="badge">ADMIN</span></Link>}
          <form action={logout}><button type="submit" className="min-h-11 rounded-lg px-4 py-2 font-medium text-slate-600 hover:bg-slate-100">Sign Out</button></form>
        </nav>}
      </section>
      <section aria-labelledby="how-it-works" className="mt-10">
        <h2 id="how-it-works" className="text-xl font-semibold">From missing to returned</h2>
        <ol className="journey-grid">
          <li><span className="step-number">01</span><h3>Search or report</h3><p>Browse campus reports, or describe an item you lost or found.</p></li>
          <li><span className="step-number">02</span><h3>Check the details</h3><p>Compare descriptions and potential matches. Similarity is a suggestion, not proof of ownership.</p></li>
          <li><span className="step-number">03</span><h3>Claim and confirm</h3><p>Submit a claim, add your evidence, and confirm receipt only after the item is returned.</p></li>
        </ol>
      </section>
    </main>
  );
}
