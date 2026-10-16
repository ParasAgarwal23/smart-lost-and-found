import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { loginPath } from "@/lib/next-path";
import { getAuthenticatedUser } from "@/lib/auth";
import { getReportOptions, localToday, type CategoryOption, type LocationOption } from "@/lib/reference-data";
import { Icon } from "@/components/icons";
import ReportForm from "@/components/report-form";
import { BackLink, Notice } from "@/components/ui";

const copy = {
  lost: {
    title: "Report a lost item",
    description: "Tell us what you lost. We'll show you found items that look similar.",
  },
  found: {
    title: "Report a found item",
    description: "Describe what you found so the owner can recognise it and claim it.",
  },
};

export function ReportPageFrame({ kind, title, description, back, children }: {
  kind: "lost" | "found";
  title?: string;
  description?: string;
  back: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="container-page max-w-2xl py-8 sm:py-12">
      <BackLink href={back.href}>{back.label}</BackLink>
      <h1 className="page-title">{title ?? copy[kind].title}</h1>
      <p className="page-description">{description ?? copy[kind].description}</p>
      <section className={`card card-pad report-card mt-6 ${kind === "lost" ? "rail-lost" : "rail-found"}`} aria-label={title ?? copy[kind].title}>
        {children}
      </section>
      <p className="mt-4 flex items-start gap-2 text-sm text-ink-3">
        <Icon name="lock" size={15} className="mt-0.5" />Reports are visible to everyone. Your name and contact details are never shown.
      </p>
    </main>
  );
}

export async function loadOptions(): Promise<{ categories: CategoryOption[]; locations: LocationOption[]; error: string | null }> {
  try {
    return { ...(await getReportOptions()), error: null };
  } catch {
    return { categories: [], locations: [], error: "Unable to load categories and locations. Please reload this page to try again." };
  }
}

export default async function CreateReportPage({ kind }: { kind: "lost" | "found" }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect(loginPath(`/${kind}-report`));
  const options = await loadOptions();

  return (
    <ReportPageFrame kind={kind} back={{ href: "/", label: "Back to Home" }}>
      {options.error
        ? <Notice tone="error" action={<a href={`/${kind}-report`} className="btn btn-secondary btn-sm"><Icon name="refresh" size={16} />Reload page</a>}>{options.error}</Notice>
        : <ReportForm kind={kind} categories={options.categories} locations={options.locations} today={localToday()} />}
    </ReportPageFrame>
  );
}
