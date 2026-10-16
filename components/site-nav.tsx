"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/actions/auth";
import { Icon, type IconName } from "@/components/icons";

export type NavUser = { name: string | null; role: "USER" | "ADMIN" } | null;

type NavItem = { href: string; label: string; icon: IconName; match?: string[] };

// Organised around tasks. Possible matches live under My Reports and evidence /
// handover live under My Claims, so they are highlighted with their parent.
function navItems(user: NavUser): NavItem[] {
  const items: NavItem[] = [{ href: "/search", label: "Search", icon: "search" }];
  if (!user) return items;
  items.push(
    { href: "/my-reports", label: "My Reports", icon: "list", match: ["/my-reports", "/potential-matches"] },
    { href: "/claim", label: "My Claims", icon: "clipboard" },
  );
  if (user.role === "ADMIN") items.push({ href: "/admin/campus-summary", label: "Campus Summary", icon: "chart" });
  return items;
}

const reportLinks: { href: string; label: string; hint: string; icon: IconName }[] = [
  { href: "/lost-report", label: "I lost something", hint: "Report a lost item", icon: "question" },
  { href: "/found-report", label: "I found something", hint: "Report a found item", icon: "box" },
];

function isActive(pathname: string | null, item: NavItem) {
  if (!pathname) return false;
  return (item.match ?? [item.href]).some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

function SignOutButton({ className }: { className: string }) {
  return (
    <form action={logout}>
      <button type="submit" className={className}><Icon name="logOut" size={16} />Sign Out</button>
    </form>
  );
}

// Disclosure menu for the two report forms. Visitors following these links are
// asked to sign in first and are then returned to the form.
function ReportMenu() {
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenedOn(null); };
    const onClick = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpenedOn(null); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn btn-accent btn-sm" aria-expanded={open} aria-controls="report-menu"
        onClick={() => setOpenedOn(open ? null : pathname)}>
        <Icon name="plus" size={16} />Report an item
      </button>
      <div id="report-menu" hidden={!open} className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-lg">
        {reportLinks.map((link) => (
          <Link key={link.href} href={link.href} className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-sunken">
            <Icon name={link.icon} size={18} className={link.href === "/lost-report" ? "text-lost" : "text-brand"} />
            <span><span className="block font-semibold">{link.label}</span><span className="block text-xs text-ink-3">{link.hint}</span></span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// The role shown here is display-only; every protected page and action
// re-reads the user from PostgreSQL before authorizing anything.
export default function SiteNav({ user }: { user: NavUser }) {
  const pathname = usePathname();
  // The compact menu (windows narrower than 1280px, including zoomed desktop
  // browsers) remembers the path it was opened on, so navigating closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const items = navItems(user);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenedOn(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <nav aria-label="Primary" className="hidden flex-1 items-center gap-0.5 xl:flex">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="nav-link" aria-current={isActive(pathname, item) ? "page" : undefined}>
            <Icon name={item.icon} size={16} />{item.label}
          </Link>
        ))}
      </nav>
      <div className="hidden items-center gap-2 xl:flex">
        <ReportMenu />
        {user ? (
          <>
            <span className="flex items-center gap-2 pl-1 text-sm" title={user.name ?? "Signed in"}>
              <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-brand-ink"><Icon name="user" size={16} /></span>
              <span className="sr-only">Signed in as {user.name ?? "your account"}</span>
              {user.role === "ADMIN" && <span className="badge badge-admin">ADMIN</span>}
            </span>
            <SignOutButton className="btn btn-ghost btn-sm" />
          </>
        ) : (
          <Link href="/login" className="btn btn-primary btn-sm"><Icon name="logIn" size={16} />Sign In</Link>
        )}
      </div>

      <button type="button" className="btn btn-secondary btn-sm ml-auto xl:hidden" aria-expanded={open} aria-controls="compact-menu"
        onClick={() => setOpenedOn(open ? null : pathname)}>
        <Icon name={open ? "close" : "menu"} size={18} />
        <span className="max-[359px]:sr-only">Menu</span>
      </button>
      <div id="compact-menu" hidden={!open} className="absolute inset-x-0 top-full border-b border-line bg-surface shadow-lg xl:hidden">
        <nav aria-label="Menu" className="container-page grid gap-1 py-3">
          {reportLinks.map((link) => (
            <Link key={link.href} href={link.href} className="nav-link min-h-11 text-base">
              <Icon name={link.icon} size={18} />{link.hint}
            </Link>
          ))}
          <div className="divider my-1" />
          {items.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link min-h-11 text-base" aria-current={isActive(pathname, item) ? "page" : undefined}>
              <Icon name={item.icon} size={18} />{item.label}
            </Link>
          ))}
          <div className="divider mt-2 flex flex-wrap items-center justify-between gap-3 pt-3">
            {user ? (
              <>
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <Icon name="user" size={16} /><span className="truncate">{user.name ?? "Signed in"}</span>
                  {user.role === "ADMIN" && <span className="badge badge-admin">ADMIN</span>}
                </span>
                <SignOutButton className="btn btn-secondary btn-sm" />
              </>
            ) : (
              <Link href="/login" className="btn btn-primary btn-sm w-full"><Icon name="logIn" size={16} />Sign In</Link>
            )}
          </div>
        </nav>
      </div>
    </>
  );
}
