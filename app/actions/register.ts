"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { emailSchema } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export type RegisterState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
};

// Shown to users in app/register/register-form.tsx; keep the two in step.
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;

// Phone: optional leading +, then digits with optional spaces or hyphens,
// 7-15 digits in total and at most 15 characters (USER."Phone" is VARCHAR(15)).
const phoneSchema = z.string().trim().max(15)
  .regex(/^\+?[0-9][0-9 -]*[0-9]$/)
  .refine((value) => { const digits = value.replace(/\D/g, "").length; return digits >= 7 && digits <= 15; });

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  phone: phoneSchema,
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX).refine((value) => value.trim() !== ""),
  confirmPassword: z.string(),
});

const messages: Record<string, string> = {
  name: "Enter your full name (1 to 100 characters).",
  email: "Enter a valid email address of up to 100 characters.",
  phone: "Enter a phone number of 7 to 15 digits; spaces, hyphens and a leading + are allowed.",
  password: `Choose a password of ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`,
};

// Public registration. Every account it creates is a USER: the form has no role
// field, no submitted value is read as a role, and the database function
// public.register_user (db/security_functions.sql) inserts the constant 'USER'.
// Only the Argon2id hash leaves this function; the password is never stored or logged.
export async function register(
  _previousState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (messages[key] && !fieldErrors[key]) fieldErrors[key] = messages[key];
    }
  } else {
    if (parsed.data.password !== parsed.data.confirmPassword) {
      fieldErrors.confirmPassword = "The passwords do not match.";
    } else if (parsed.data.password.trim().toLowerCase() === parsed.data.email) {
      fieldErrors.password = "Choose a password that is different from your email address.";
    }
  }
  if (!parsed.success || Object.keys(fieldErrors).length > 0) {
    return { error: "Please correct the highlighted fields.", fieldErrors };
  }
  const { name, email, phone, password } = parsed.data;

  try {
    const passwordHash = await hashPassword(password);
    await withTransaction((client) =>
      client.query('SELECT "User_ID" FROM public.register_user($1, $2, $3, $4)', [name, email, phone, passwordHash]));
  } catch (error) {
    // The USER_Email_key unique constraint makes duplicate detection race-safe.
    if (typeof error === "object" && error !== null && "constraint" in error && error.constraint === "USER_Email_key") {
      return { error: "Please correct the highlighted fields.", fieldErrors: { email: "An account with this email already exists. Sign in instead." } };
    }
    return { error: "Unable to create your account right now. Please try again." };
  }

  // redirect throws internally; keep it outside the error handler.
  redirect("/login?registered=1");
}
