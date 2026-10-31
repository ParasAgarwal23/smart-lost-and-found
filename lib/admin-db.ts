import "server-only";

import type { QueryResult, QueryResultRow } from "pg";
import { requireRole } from "@/lib/auth";
import { withPrincipal } from "@/lib/db";

// Campus analytics only. requireRole re-reads the role from PostgreSQL before
// the admin login (lf_admin_web) is touched, even if a page forgot its own
// guard. lf_admin can read the admin_* views/function and the report-detail
// views, nothing else, and the transaction is read-only.
export async function adminQuery<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  await requireRole("ADMIN");
  return withPrincipal({ role: "lf_admin", userId: null }, (client) => client.query<Row>(text, values), true);
}
