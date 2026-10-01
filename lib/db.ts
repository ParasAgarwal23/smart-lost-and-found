import "server-only";

import { Pool, type QueryResult, type QueryResultRow } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  postgresPool?: Pool;
};

let pool: Pool | undefined;

function getPool(): Pool {
  const existingPool = pool ?? globalForDb.postgresPool;
  if (existingPool) return existingPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be configured for database queries.");
  }

  pool = new Pool({ connectionString });
  pool.on("error", () => {
    // Handle idle-client errors without logging credentials or query contents.
    console.error("An idle PostgreSQL pool connection encountered an error.");
  });

  // Preserve the pool across Next.js development module reloads.
  if (process.env.NODE_ENV !== "production") {
    globalForDb.postgresPool = pool;
  }

  return pool;
}

// Supply values separately: query('SELECT $1::text AS message', ['hello']).
// This helper is for individual queries; transactions need one checked-out client.
// Use from Node.js server code, not the Edge runtime.
export async function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return getPool().query<Row>(text, values);
}
