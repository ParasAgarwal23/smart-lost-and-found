import Link from "next/link";
import { logout } from "@/app/actions/auth";

const features = [
  { href: "/lost-report", label: "Report Lost Item" },
  { href: "/found-report", label: "Report Found Item" },
  { href: "/search", label: "Search" },
  { href: "/potential-matches", label: "Potential Matches" },
  { href: "/claim", label: "Claim a Found Item" },
  { href: "/claim/evidence", label: "Add Claim Evidence" },
  { href: "/claim/handover", label: "Confirm Item Received" },
];

const buttonClass = "block w-full rounded-lg bg-teal-700 px-4 py-3 text-center font-medium text-white hover:bg-teal-800";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
        <p className="text-sm font-semibold tracking-widest text-teal-700">
          COLLEGE DBMS LEVEL 3 PROJECT
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Smart Lost and Found Management System
        </h1>
        <p className="mt-6 text-base leading-7 text-slate-600">
          A place to help lost items find their way back to their owners.
        </p>
        <p className="mt-4 text-sm leading-6 text-slate-500">
          Report lost and found items, search reports, explore potential matches,
          submit claims and evidence, and confirm item receipt.
        </p>
        <nav aria-label="Application features" className="mt-6 grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <Link key={feature.href} href={feature.href} className={buttonClass}>
              {feature.label}
            </Link>
          ))}
          <form action={logout}>
            <button type="submit" className={buttonClass}>Logout</button>
          </form>
        </nav>
      </div>
    </main>
  );
}
