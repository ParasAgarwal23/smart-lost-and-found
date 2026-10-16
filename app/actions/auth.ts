"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/next-path";
import { createSession, destroySession } from "@/lib/session";

export type LoginState = { error: string | null };

const loginSchema = z.object({
  email: z.string().trim().max(100).pipe(z.email()),
  password: z.string().min(1).max(1024),
});

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Invalid email or password" };

  try {
    // authenticateUser verifies Argon2id via the existing password helper.
    const user = await authenticateUser(parsed.data.email, parsed.data.password);
    if (!user) return { error: "Invalid email or password" };
    await createSession(user.User_ID);
  } catch {
    // Never send internal database/session errors or credentials to the browser.
    return { error: "Unable to sign in. Please try again later." };
  }

  // redirect throws internally; keep it outside the error handler.
  // Return to the page that required sign-in, but only if it is a known app path.
  redirect(safeNextPath(formData.get("next")) ?? "/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
