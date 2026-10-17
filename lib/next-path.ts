// Where to send someone after they sign in. Only known in-app pages are
// accepted, so a crafted ?next= value can never redirect to another site.
const ALLOWED = /^\/(lost-report|found-report|my-reports(\/edit)?|potential-matches|claim(\/evidence|\/handover)?|admin\/campus-summary)(\?[\w=&%.-]*)?$/;

export function safeNextPath(value: unknown): string | null {
  return typeof value === "string" && value.length <= 200 && ALLOWED.test(value) ? value : null;
}

// The page path plus one numeric query parameter (e.g. a claim or report ID),
// so a direct link still opens the same record after signing in.
export function withNumericParam(path: string, name: string, value: unknown): string {
  return typeof value === "string" && /^-?\d{1,10}$/.test(value) ? `${path}?${name}=${value}` : path;
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
  if (next.startsWith("/claim?foundId=")) return "Sign in to claim this item.";
  if (next.startsWith("/claim/evidence")) return "Sign in to add evidence to your claim.";
  if (next.startsWith("/claim/handover")) return "Sign in to confirm you received your item.";
  if (next.startsWith("/claim")) return "Sign in to view and manage your claims.";
  if (next.startsWith("/my-reports")) return "Sign in to see your reports.";
  if (next.startsWith("/potential-matches")) return "Sign in to see possible matches for your lost items.";
  return "Sign in to continue.";
}
