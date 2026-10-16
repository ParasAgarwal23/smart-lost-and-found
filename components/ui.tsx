import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// PostgreSQL DATE values arrive as 'YYYY-MM-DD' text. Format them without
// Date parsing so server and browser output never differ by time zone.
export function formatDate(iso: string | null | undefined): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) return "Date not supplied";
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

export function DateText({ value, prefix }: { value: string | null | undefined; prefix?: string }) {
  if (!value) return <span>Date not supplied</span>;
  return <time dateTime={value}>{prefix}{formatDate(value)}</time>;
}

export function placeLabel(name: string | null, building: string | null) {
  return `${name ?? "Unnamed location"}${building ? ` (${building})` : ""}`;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="link-quiet mb-4">
      <Icon name="arrowLeft" size={16} />{children}
    </Link>
  );
}

export function PageHeader({ eyebrow, icon, title, description, actions, titleId }: {
  eyebrow?: string;
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <p className="eyebrow">{icon && <Icon name={icon} size={15} />}{eyebrow}</p>}
        <h1 id={titleId} className="page-title mt-2">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export type BadgeTone = "lost" | "found" | "match" | "claim" | "done" | "neutral" | "admin";

export function Badge({ tone = "neutral", icon, children }: { tone?: BadgeTone; icon?: IconName; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{icon && <Icon name={icon} size={13} strokeWidth={2.2} />}{children}</span>;
}

export function ReportTypeBadge({ type }: { type: "Lost" | "Found" | string }) {
  return type === "Lost"
    ? <Badge tone="lost" icon="question">Lost</Badge>
    : <Badge tone="found" icon="box">Found</Badge>;
}

const noticeIcons = { error: "alert", success: "checkCircle", info: "info", warning: "alert" } as const;

// Page-level messages. Errors use role="alert" so they are announced immediately.
export function Notice({ tone = "info", title, children, className = "", action }: {
  tone?: "error" | "success" | "info" | "warning";
  title?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`notice notice-${tone} ${className}`}>
      <Icon name={noticeIcons[tone]} size={20} className="mt-0.5" />
      <div className="min-w-0">
        {title && <p className="font-bold">{title}</p>}
        <div>{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = "inbox", title, children, actions }: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <p className="text-lg font-bold">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-2">{children}</div>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function MetaItem({ icon, children, label }: { icon: IconName; children: ReactNode; label?: string }) {
  return (
    <span>
      <Icon name={icon} size={15} />
      {label && <span className="sr-only">{label}: </span>}
      <span className="min-w-0">{children}</span>
    </span>
  );
}
