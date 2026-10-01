import "server-only";

import { z } from "zod";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { readSession } from "@/lib/session";

const roleSchema = z.enum(["USER", "ADMIN"]);
export type Role = z.infer<typeof roleSchema>;

export type AuthenticatedUser = {
  User_ID: number;
  Name: string | null;
  Email: string | null;
  Phone: string | null;
  Role: Role;
};

type UserRow = Omit<AuthenticatedUser, "Role"> & { Role: string | null };
type CredentialRow = UserRow & { Password_Hash: string };

const credentialsSchema = z.object({
  email: z.string().trim().max(100).pipe(z.email()),
  password: z.string().min(1).max(1024),
});

function safeUser(row: UserRow): AuthenticatedUser | null {
  const role = roleSchema.safeParse(row.Role);
  if (!role.success) return null;
  // Explicit selection prevents hashes or other internal fields escaping.
  return {
    User_ID: row.User_ID,
    Name: row.Name,
    Email: row.Email,
    Phone: row.Phone,
    Role: role.data,
  };
}

// Verifies credentials only; the future login action creates the session.
export async function authenticateUser(
  email: unknown,
  password: unknown,
): Promise<AuthenticatedUser | null> {
  const parsed = credentialsSchema.safeParse({ email, password });
  if (!parsed.success) return null;

  // Exact, case-sensitive email lookup; no unapproved normalization policy.
  // NULL emails cannot match. LIMIT 2 detects ambiguity without assuming UNIQUE.
  const result = await query<CredentialRow>(
    `SELECT "User_ID", "Name", "Email", "Phone", "Role", "Password_Hash"
     FROM public."USER" WHERE "Email" = $1 LIMIT 2`,
    [parsed.data.email],
  );
  if (result.rows.length !== 1) return null;

  const row = result.rows[0];
  const user = safeUser(row);
  if (!user || !(await verifyPassword(parsed.data.password, row.Password_Hash))) {
    return null;
  }
  return user;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const session = await readSession();
  if (!session) return null;

  // Reload permissions each time; never authorize using a cookie/client role.
  const result = await query<UserRow>(
    `SELECT "User_ID", "Name", "Email", "Phone", "Role"
     FROM public."USER" WHERE "User_ID" = $1`,
    [session.User_ID],
  );
  return result.rows.length === 1 ? safeUser(result.rows[0]) : null;
}

export class AuthorizationError extends Error {
  constructor(public readonly status: 401 | 403) {
    super(status === 401 ? "Authentication required." : "Access denied.");
    this.name = "AuthorizationError";
  }
}

// Pass a role chosen by server code. USER requires USER; ADMIN requires ADMIN.
// An ADMIN does not implicitly receive USER-only permissions.
export async function requireRole(requiredRole: Role): Promise<AuthenticatedUser> {
  const role = roleSchema.safeParse(requiredRole);
  if (!role.success) throw new AuthorizationError(403);

  const user = await getAuthenticatedUser();
  if (!user) throw new AuthorizationError(401);
  if (user.Role !== role.data) throw new AuthorizationError(403);
  return user;
}
