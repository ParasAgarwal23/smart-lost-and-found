import Link from "next/link";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { Icon, type IconName } from "@/components/icons";
import { formatDate, placeLabel } from "@/components/ui";

export const dynamic = "force-dynamic";

type RecentFound = { Found_ID: number; Item_Name: string | null; Location_Name: string | null; Building: string | null; Date_Found: string | null; Returned: boolean };

const steps: { icon: IconName; title: string; text: string }[] = [
  { icon: "file", title: "Report it", text: "Describe what you lost or found." },
  { icon: "sparkles", title: "Find a match", text: "We suggest found items that sound like yours." },
  { icon: "gift", title: "Get it back", text: "Claim it, add proof, and confirm when it's returned." },
];

export default async function Home() {
  const user = await getAuthenticatedUser();
  let recent: RecentFound[] = [];
  try {
    // Reads the report-detail view, which joins CATEGORY and LOCATION, and flags
    // items that already have a handover so visitors know before they click.
    const result = await query<RecentFound>(
      `SELECT f."Found_ID", f."Item_Name", f."Location_Name", f."Building", f."Date_Found"::text AS "Date_Found",
              EXISTS (SELECT 1 FROM public."CLAIM" c JOIN public."HANDOVER" h ON h."Claim_ID" = c."Claim_ID"
                      WHERE c."Found_ID" = f."Found_ID") AS "Returned"
       FROM public.v_found_report_details f
       ORDER BY f."Date_Found" DESC NULLS LAST, f."Found_ID" DESC LIMIT 4`,
    );
    recent = result.rows;
  } catch { /* The homepage still works without the recent list. */ }

  return (
    <main id="main-content" tabIndex={-1}>
      <section className="relative overflow-hidden border-b border-line bg-surface">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-[28rem] rounded-full bg-accent-soft/70 blur-3xl" />
        <div className="container-page relative max-w-3xl py-12 text-center sm:py-20">
          <h1 className="font-display text-[2.3rem] font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Lost something on campus? <span className="text-brand">Let&apos;s bring it back.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-balance text-lg text-ink-2">Search everything that has been reported, or tell us what you lost or found.</p>
          <form action="/search" method="get" role="search" aria-label="Search reports" className="mx-auto mt-8 flex max-w-xl flex-col gap-2 rounded-2xl border border-field bg-surface p-2 shadow-sm sm:flex-row">
            <label htmlFor="home-search" className="sr-only">What are you looking for?</label>
            <div className="relative flex-1">
              <Icon name="search" size={19} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input id="home-search" name="text" type="search" placeholder="e.g. water bottle, student ID" className="input border-transparent pl-10 shadow-none focus:border-brand" />
            </div>
            <button type="submit" className="btn btn-primary">Search</button>
          </form>
          <nav aria-label="Main actions" className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/lost-report" className="btn btn-secondary"><Icon name="question" size={17} className="text-lost" />I lost something</Link>
            <Link href="/found-report" className="btn btn-secondary"><Icon name="box" size={17} className="text-brand" />I found something</Link>
          </nav>
          {!user && (
            <p className="mt-5 text-sm text-ink-3">
              Searching is open to everyone. Reporting and claiming need an account — <Link href="/login" className="link">Sign In</Link>.
            </p>
          )}
        </div>
      </section>

      {user && (
        <section aria-label="Your account" className="border-b border-line bg-brand-soft/50">
          <div className="container-page flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <p className="account-label text-ink-2">
              Signed in as <span className="font-semibold text-ink">{user.Name ?? "your account"}</span>{" "}
              <span className={`badge ${user.Role === "ADMIN" ? "badge-admin" : "badge-neutral"}`}>{user.Role === "ADMIN" ? "ADMIN account" : "USER account"}</span>
            </p>
            <nav aria-label="Your shortcuts" className="flex flex-wrap gap-x-5 gap-y-1">
              <Link href="/my-reports" className="link">My Reports</Link>
              <Link href="/claim" className="link">My Claims</Link>
              {user.Role === "ADMIN" && <Link href="/admin/campus-summary" className="link">Campus Summary</Link>}
            </nav>
          </div>
        </section>
      )}

      <div className="container-page grid gap-10 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="section-title">How it works</h2>
          <ol className="mt-4 grid gap-4">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white"><Icon name={step.icon} size={18} /></span>
                <span>
                  <span className="block font-bold"><span className="sr-only">Step {index + 1}: </span>{step.title}</span>
                  <span className="block text-sm text-ink-2">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm text-ink-3">A suggested match is only a hint. You confirm ownership by adding proof to your claim.</p>
        </section>

        <section aria-labelledby="recent-heading" className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="recent-heading" className="section-title">Recently found</h2>
            <Link href="/search?type=Found" className="link text-sm">See all found items</Link>
          </div>
          {recent.length === 0 ? (
            <p className="mt-4 text-sm text-ink-2">No found items have been reported yet.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-1 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {recent.map((item) => (
                <li key={item.Found_ID} className="min-w-0">
                  {/* Opens the existing search, filtered to found items with this name. */}
                  <Link href={item.Item_Name ? `/search?type=Found&text=${encodeURIComponent(item.Item_Name)}` : "/search?type=Found"}
                    className="group flex min-w-0 items-center gap-3 p-3 hover:bg-sunken/60 focus-visible:-outline-offset-2">
                    <Icon name="box" size={18} className="text-brand" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold group-hover:text-brand">{item.Item_Name ?? "Unnamed item"}</span>
                      <span className="block truncate text-meta text-ink-3">{placeLabel(item.Location_Name, item.Building)}</span>
                    </span>
                    <span className="shrink-0 text-right text-meta">
                      <span className="block text-ink-3">{formatDate(item.Date_Found)}</span>
                      {item.Returned && <span className="block font-semibold text-success">Returned</span>}
                    </span>
                    <Icon name="arrowRight" size={16} className="shrink-0 text-ink-3 group-hover:text-brand" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
