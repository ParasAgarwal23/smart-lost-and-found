import "server-only";

import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { z } from "zod";

const userIdSchema = z.number().int().min(-2147483648).max(2147483647);
const sessionSchema = z.strictObject({ User_ID: userIdSchema });
type SessionData = z.infer<typeof sessionSchema>;

function sessionOptions(): SessionOptions {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
  }

  return {
    password: secret,
    cookieName: "smart_lost_found_session",
    ttl: 60 * 60 * 8,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

// Call only after successful authentication, from a Server Action/Route Handler.
export async function createSession(userId: number): Promise<void> {
  if (!userIdSchema.safeParse(userId).success) {
    throw new Error("Invalid session user ID.");
  }
  const session = await getSession();
  // Replace any previous payload, keeping only the authenticated database ID.
  for (const key of Object.keys(session)) {
    delete (session as unknown as Record<string, unknown>)[key];
  }
  session.User_ID = userId;
  await session.save();
}

export async function readSession(): Promise<SessionData | null> {
  const session = await getSession();
  const parsed = sessionSchema.safeParse({ ...session });
  return parsed.success ? parsed.data : null;
}

// Cookie mutations require a Server Action/Route Handler, not a render.
export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
