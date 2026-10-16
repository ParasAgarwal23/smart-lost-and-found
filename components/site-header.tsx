import Link from "next/link";
import { getAuthenticatedUser } from "@/lib/auth";
import SiteNav, { type NavUser } from "@/components/site-nav";

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 40 40" className="shrink-0">
      <rect width="40" height="40" rx="11" fill="#0f5c48" />
      {/* A luggage tag: the universal lost-property symbol. */}
      <path d="M14 11h9.5a2 2 0 0 1 1.4.6l4.5 4.5a2 2 0 0 1 0 2.8L21 27.4a2 2 0 0 1-2.8 0l-4.6-4.6a2 2 0 0 1-.6-1.4V13a2 2 0 0 1 2-2Z" fill="#f0b13f" />
      <circle cx="17.5" cy="15.5" r="1.9" fill="#0f5c48" />
      <path d="M17.5 15.5 11 9" stroke="#fcf0d6" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default async function SiteHeader() {
  let user: NavUser = null;
  try {
    const authenticated = await getAuthenticatedUser();
    if (authenticated) user = { name: authenticated.Name, role: authenticated.Role };
  } catch {
    // Treat an unavailable session/database as signed out; pages show their own errors.
  }

  return (
    <header className="site-header">
      <div className="container-page relative flex min-h-16 items-center gap-3 py-2 sm:gap-4">
        <Link href="/" className="flex items-center gap-3 rounded-lg pr-2" aria-label="Campus Lost & Found home">
          <BrandMark />
          <span className="leading-tight">
            <span className="font-display block whitespace-nowrap text-base font-semibold tracking-tight sm:text-lg">Campus Lost &amp; Found</span>
            <span className="hidden whitespace-nowrap text-xs text-ink-3 sm:block">Find it. Claim it. Bring it home.</span>
          </span>
        </Link>
        <SiteNav user={user} />
      </div>
    </header>
  );
}
