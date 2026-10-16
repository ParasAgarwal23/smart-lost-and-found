// Where to send someone after they sign in. Only known in-app pages are
// accepted, so a crafted ?next= value can never redirect to another site.
const ALLOWED = /^\/(lost-report|found-report|my-reports(\/edit)?|potential-matches|claim(\/evidence|\/handover)?|admin\/campus-summary)(\?[\w=&%.-]*)?$/;

export function safeNextPath(value: unknown): string | null {
  return typeof value === "string" && value.length <= 200 && ALLOWED.test(value) ? value : null;
}

export function loginPath(next: string): string {
  const safe = safeNextPath(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

// Plain-language reason shown on the sign-in page.
export function nextPurpose(next: string | null): string | null {
  if (!next) return null;
  if (next.startsWith("/lost-report")) return "Sign in to report a lost item.";
  if (next.startsWith("/found-report")) return "Sign in to report a found item.";
  if (next.startsWith("/claim")) return "Sign in to view and manage your claims.";
  if (next.startsWith("/my-reports")) return "Sign in to see your reports.";
  if (next.startsWith("/potential-matches")) return "Sign in to see possible matches for your lost items.";
  return "Sign in to continue.";
}
