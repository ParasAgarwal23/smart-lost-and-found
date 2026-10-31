import "server-only";

import { z } from "zod";
import { loadSessionUser, query, type SessionUserRow } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

const roleSchema = z.enum(["USER", "ADMIN"]);
export type Role = z.infer<typeof roleSchema>;

export type AuthenticatedUser = {
  User_ID: number;
  Name: string | null;
  Role: Role;
};

type CredentialRow = { User_ID: number; Role: string | null; Password_Hash: string };

// Emails are stored trimmed and lower-case (USER_Email_lowercase_check), so
// sign-in and registration normalise the same way.
export const emailSchema = z.string().trim().toLowerCase().max(100).pipe(z.email());

const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});

function safeUser(row: SessionUserRow): AuthenticatedUser | null {
  const role = roleSchema.safeParse(row.Role);
  if (!role.success) return null;
  // Explicit selection prevents hashes or other internal fields escaping.
  return { User_ID: row.User_ID, Name: row.Name, Role: role.data };
}

// Verifies credentials only; the future login action creates the session.
export async function authenticateUser(
  email: unknown,
  password: unknown,
): Promise<AuthenticatedUser | null> {
  const parsed = credentialsSchema.safeParse({ email, password });
  if (!parsed.success) return null;

  // The application roles cannot read "USER"; auth_credentials returns the ID,
  // role and hash for one exact normalised email (db/security_functions.sql).
  // NULL emails cannot match. "USER_Email_key" makes emails unique; LIMIT 2
  // in the function remains a cheap defensive check against ambiguity.
  const result = await query<CredentialRow>(
    'SELECT "User_ID", "Role", "Password_Hash" FROM public.auth_credentials($1)',
    [parsed.data.email],
  );
  if (result.rows.length !== 1) return null;

  const row = result.rows[0];
  const role = roleSchema.safeParse(row.Role);
  if (!role.success || !(await verifyPassword(parsed.data.password, row.Password_Hash))) {
    return null;
  }
  return { User_ID: row.User_ID, Name: null, Role: role.data };
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  // Reload permissions each time; never authorize using a cookie/client role.
  const row = await loadSessionUser();
  return row ? safeUser(row) : null;
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
