import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/site-header";
import { Icon, type IconName } from "@/components/icons";
import { nextPurpose, safeNextPath } from "@/lib/next-path";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "Sign In" };

const benefits: { icon: IconName; text: string }[] = [
  { icon: "file", text: "Report things you've lost or found" },
  { icon: "sparkles", text: "See found items that look like yours" },
  { icon: "clipboard", text: "Claim an item and track its return" },
];

export default async function LoginPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNextPath((await searchParams)?.next);
  const purpose = nextPurpose(next);

  return (
    <main id="main-content" tabIndex={-1} className="container-page py-10 sm:py-16">
      <div className="mx-auto grid max-w-4xl overflow-hidden rounded-3xl border border-line bg-surface shadow-xl shadow-ink/5 lg:grid-cols-2">
        <section aria-label="Why sign in" className="relative hidden overflow-hidden bg-brand p-10 text-white lg:block">
          <div aria-hidden="true" className="absolute -right-20 -top-20 size-72 rounded-full bg-accent/25 blur-2xl" />
          <BrandMark size={48} />
          <p className="font-display mt-8 text-4xl font-semibold leading-tight">Welcome back.</p>
          <ul className="mt-8 grid gap-4">
            {benefits.map((benefit) => (
              <li key={benefit.text} className="flex items-center gap-3 text-white/90">
                <span className="grid size-9 place-items-center rounded-lg bg-white/10"><Icon name={benefit.icon} size={17} /></span>
                {benefit.text}
              </li>
            ))}
          </ul>
        </section>
        <section className="p-6 sm:p-10">
          <h1 className="page-title">Sign In</h1>
          <p className="mt-2 text-ink-2">Anyone can search. You need an account to report, claim or track items.</p>
          {purpose && <p className="notice notice-info mt-5"><Icon name="info" size={18} className="mt-0.5" />{purpose}</p>}
          <LoginForm next={next} />
          <p className="mt-6 text-sm text-ink-3">No account? Accounts are created by the campus administrator.</p>
          <Link href="/" className="link-quiet mt-1"><Icon name="arrowLeft" size={16} />Back to Home</Link>
        </section>
      </div>
    </main>
  );
}
