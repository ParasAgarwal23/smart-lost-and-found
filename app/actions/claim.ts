"use server";

import { randomInt } from "node:crypto";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export type ClaimState = { error: string | null; success: string | null };

const claimSchema = z.object({
  foundId: z.string().regex(/^-?\d+$/).transform(Number)
    .pipe(z.number().int().min(-2147483648).max(2147483647)),
});

class ClaimError extends Error {}

function isPrimaryKeyCollision(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "CLAIM_pkey";
}

export async function createClaim(
  _previousState: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { error: "Please sign in to submit a claim.", success: null };

    const parsed = claimSchema.safeParse({ foundId: formData.get("foundId") });
    if (!parsed.success) return { error: "Choose a valid found report.", success: null };
    const { foundId } = parsed.data;

    await withTransaction(async (client) => {
      // Serialize submissions for this report before checking existing claims.
      const report = await client.query<{ User_ID: number }>(
        `SELECT "User_ID" FROM public."FOUND_REPORT" WHERE "Found_ID" = $1 FOR UPDATE`,
        [foundId],
      );
      if (report.rows.length !== 1) throw new ClaimError("Found report is unavailable.");
      if (report.rows[0].User_ID === user.User_ID) {
        throw new ClaimError("You cannot claim your own found report.");
      }

      const eligibility = await client.query<{ has_handover: boolean; already_claimed: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM public."CLAIM" c
           JOIN public."HANDOVER" h ON h."Claim_ID" = c."Claim_ID"
           WHERE c."Found_ID" = $1
         ) AS has_handover,
         EXISTS (
           SELECT 1 FROM public."CLAIM" WHERE "Found_ID" = $1 AND "User_ID" = $2
         ) AS already_claimed`,
        [foundId, user.User_ID],
      );
      if (eligibility.rows[0].has_handover) {
        throw new ClaimError("This found report already has a handover and cannot be claimed.");
      }
      if (eligibility.rows[0].already_claimed) {
        throw new ClaimError("You have already claimed this found report.");
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        // Recover from an ID collision without aborting the transaction or losing its lock.
        await client.query("SAVEPOINT claim_insert");
        try {
          await client.query(
            `INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID", "Claim_Date", "Status")
             VALUES ($1, $2, $3, CURRENT_DATE, NULL)`,
            [randomInt(1, 2147483648), user.User_ID, foundId],
          );
          await client.query("RELEASE SAVEPOINT claim_insert");
          return;
        } catch (error) {
          if (!isPrimaryKeyCollision(error)) throw error;
          await client.query("ROLLBACK TO SAVEPOINT claim_insert");
          await client.query("RELEASE SAVEPOINT claim_insert");
        }
      }
      throw new ClaimError("Unable to submit your claim. Please try again.");
    });
    return { error: null, success: "Claim submitted successfully." };
  } catch (error) {
    return {
      error: error instanceof ClaimError ? error.message : "Unable to submit your claim. Please try again.",
      success: null,
    };
  }
}
