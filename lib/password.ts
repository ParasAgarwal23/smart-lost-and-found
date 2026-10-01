import "server-only";

import { argon2id, hash, verify } from "argon2";
import { z } from "zod";

// Input size bound for hashing work, not a registration password policy.
const passwordSchema = z.string().min(1).max(1024);

export async function hashPassword(password: string): Promise<string> {
  if (!passwordSchema.safeParse(password).success) {
    throw new Error("Invalid password input.");
  }
  return hash(password, { type: argon2id });
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (
    !passwordSchema.safeParse(password).success ||
    typeof passwordHash !== "string" ||
    !passwordHash.startsWith("$argon2id$")
  ) {
    return false;
  }

  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed hashes (including demo placeholders) cannot authenticate.
    return false;
  }
}
