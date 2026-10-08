"use server";

import { randomInt } from "node:crypto";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export type HandoverState = { error: string | null; success: string | null };

const handoverSchema = z.object({
  claimId: z.string().regex(/^-?\d+$/).transform(Number)
    .pipe(z.number().int().min(-2147483648).max(2147483647)),
  signature: z.string().trim().min(1).max(100),
});

class HandoverError extends Error {}
const duplicateMessage = "A handover has already been recorded for this claim.";

function isConstraintConflict(error: unknown, constraint: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === constraint;
}

export async function createHandover(
  _previousState: HandoverState,
  formData: FormData,
): Promise<HandoverState> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { error: "Please sign in to confirm receipt.", success: null };

    const parsed = handoverSchema.safeParse({
      claimId: formData.get("claimId"),
      signature: formData.get("signature"),
    });
    if (!parsed.success) {
      return { error: "Choose a valid claim and enter an acknowledgement of 1 to 100 characters.", success: null };
    }
    const { claimId, signature } = parsed.data;

    await withTransaction(async (client) => {
      // Lock the shared item first, as claim creation does, so competing claims
      // cannot record separate handovers or race with a new claim submission.
      const report = await client.query<{ Found_ID: number }>(
        `SELECT f."Found_ID" FROM public."FOUND_REPORT" AS f
         JOIN public."CLAIM" AS c ON c."Found_ID" = f."Found_ID"
         WHERE c."Claim_ID" = $1 AND c."User_ID" = $2 FOR UPDATE OF f`,
        [claimId, user.User_ID],
      );
      if (report.rows.length !== 1) {
        throw new HandoverError("Claim not found or unavailable to your account.");
      }
      const foundId = report.rows[0].Found_ID;

      // Retain the claim lock and recheck ownership/association after waiting.
      const claim = await client.query<{ Claim_ID: number }>(
        `SELECT c."Claim_ID" FROM public."CLAIM" AS c
         WHERE c."Claim_ID" = $1 AND c."User_ID" = $2 AND c."Found_ID" = $3 FOR UPDATE`,
        [claimId, user.User_ID, foundId],
      );
      if (claim.rows.length !== 1) {
        throw new HandoverError("Claim not found or unavailable to your account.");
      }

      const existing = await client.query<{ Claim_ID: number }>(
        `SELECT h."Claim_ID" FROM public."HANDOVER" AS h
         JOIN public."CLAIM" AS c ON c."Claim_ID" = h."Claim_ID"
         WHERE c."Found_ID" = $1`,
        [foundId],
      );
      if (existing.rows.some((handover) => handover.Claim_ID === claimId)) {
        throw new HandoverError(duplicateMessage);
      }
      if (existing.rows.length > 0) {
        throw new HandoverError("This item has already been handed over.");
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        // Recover from a random ID collision while retaining the parent claim lock.
        await client.query("SAVEPOINT handover_insert");
        try {
          await client.query(
            `INSERT INTO public."HANDOVER" ("Handover_ID", "Claim_ID", "Handover_Date", "Signature")
             VALUES ($1, $2, CURRENT_DATE, $3)`,
            [randomInt(1, 2147483648), claimId, signature],
          );
          await client.query("RELEASE SAVEPOINT handover_insert");
          return;
        } catch (error) {
          if (isConstraintConflict(error, "HANDOVER_Claim_ID_key")) {
            throw new HandoverError(duplicateMessage);
          }
          if (!isConstraintConflict(error, "HANDOVER_pkey")) throw error;
          await client.query("ROLLBACK TO SAVEPOINT handover_insert");
          await client.query("RELEASE SAVEPOINT handover_insert");
        }
      }
      throw new HandoverError("Unable to record receipt. Please try again.");
    });
    return { error: null, success: "Item receipt recorded successfully." };
  } catch (error) {
    return {
      error: error instanceof HandoverError ? error.message : "Unable to record receipt. Please try again.",
      success: null,
    };
  }
}
