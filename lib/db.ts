import "server-only";

import { cache } from "react";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { readSession } from "@/lib/session";

// Two least-privilege logins (db/roles.sql). Neither is a superuser:
//   web   DATABASE_URL        lf_web: may become only lf_anon or lf_user
//   admin ADMIN_DATABASE_URL  lf_admin_web: may become only lf_admin (read-only)
// MAINTENANCE_DATABASE_URL (the table owner) is for scripts and tests, never the app.
type PoolName = "web" | "admin";
const POOL_URLS: Record<PoolName, string> = { web: "DATABASE_URL", admin: "ADMIN_DATABASE_URL" };
// Stay below each login's CONNECTION LIMIT (db/roles.sql): extra queries queue.
const POOL_MAX: Record<PoolName, number> = { web: 10, admin: 4 };

const globalForDb = globalThis as typeof globalThis & {
  postgresPools?: Partial<Record<PoolName, Pool>>;
};

const pools: Partial<Record<PoolName, Pool>> = globalForDb.postgresPools ?? {};
// Preserve the pools across Next.js development module reloads.
if (process.env.NODE_ENV !== "production") globalForDb.postgresPools = pools;

function getPool(name: PoolName): Pool {
  const existingPool = pools[name];
  if (existingPool) return existingPool;

  const connectionString = process.env[POOL_URLS[name]];
  if (!connectionString) {
    throw new Error(`${POOL_URLS[name]} must be configured for database queries.`);
  }

  const pool = new Pool({ connectionString, max: POOL_MAX[name] });
  pool.on("error", () => {
    // Handle idle-client errors without logging credentials or query contents.
    console.error("An idle PostgreSQL pool connection encountered an error.");
  });
  pools[name] = pool;
  return pool;
}

// The only database roles the application may assume, and the login each needs.
export type DbRole = "lf_anon" | "lf_user" | "lf_admin";
const ROLE_POOL: Record<DbRole, PoolName> = { lf_anon: "web", lf_user: "web", lf_admin: "admin" };
export type DbPrincipal = { role: DbRole; userId: number | null };

// Runs operation inside one transaction as the given principal. Both settings
// are transaction-local (third argument true), so COMMIT/ROLLBACK clears them
// and a pooled connection never carries one request's identity into the next.
// The login roles are NOINHERIT: a query that skipped this wrapper would have
// no table privileges at all.
export async function withPrincipal<T>(
  principal: DbPrincipal,
  operation: (client: PoolClient) => Promise<T>,
  readOnly = false,
): Promise<T> {
  const poolName = Object.hasOwn(ROLE_POOL, principal.role) ? ROLE_POOL[principal.role] : undefined;
  if (!poolName) throw new Error("Unknown database role.");
  if (principal.userId !== null && !Number.isInteger(principal.userId)) throw new Error("Invalid database user.");

  const client = await getPool(poolName).connect();
  let discardClient = false;
  try {
    await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await client.query("SELECT set_config('role', $1, true), set_config('app.user_id', $2, true)",
      [principal.role, principal.userId === null ? "" : String(principal.userId)]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export type SessionUserRow = { User_ID: number; Name: string | null; Role: string | null };

// The signed-in user's own record, read once per request. The sealed session
// cookie supplies only User_ID; role and name always come from PostgreSQL via
// auth_session_user(), which returns nothing but the row for app.user_id.
export const loadSessionUser = cache(async (): Promise<SessionUserRow | null> => {
  const session = await readSession();
  if (!session) return null;
  const result = await withPrincipal({ role: "lf_anon", userId: session.User_ID },
    (client) => client.query<SessionUserRow>('SELECT "User_ID", "Name", "Role" FROM public.auth_session_user()'), true);
  return result.rows.length === 1 ? result.rows[0] : null;
});

// Every signed-in account, ADMIN included, uses lf_user for ordinary work;
// lf_admin is reachable only through lib/admin-db.ts.
async function currentPrincipal(): Promise<DbPrincipal> {
  const user = await loadSessionUser();
  return user && (user.Role === "USER" || user.Role === "ADMIN")
    ? { role: "lf_user", userId: user.User_ID }
    : { role: "lf_anon", userId: null };
}

// Supply values separately: query('SELECT $1::text AS message', ['hello']).
// Anonymous requests run read-only. Use from Node.js server code, not the Edge runtime.
export async function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  const principal = await currentPrincipal();
  return withPrincipal(principal, (client) => client.query<Row>(text, values), principal.role === "lf_anon");
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withPrincipal(await currentPrincipal(), operation);
}
