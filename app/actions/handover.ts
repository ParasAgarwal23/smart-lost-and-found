"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export type HandoverState = { error: string | null; success: string | null; signedOut?: boolean };

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
    if (!user) return { error: "Please sign in to confirm receipt.", success: null, signedOut: true };

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

      // This claim's own receipt is visible to its owner; another claimant's
      // receipt is not (RLS), so the helper answers for the item as a whole.
      const existing = await client.query<{ own_receipt: boolean; item_handed_over: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM public."HANDOVER" AS h WHERE h."Claim_ID" = $1) AS own_receipt,
                public.found_report_has_handover($2) AS item_handed_over`,
        [claimId, foundId],
      );
      if (existing.rows[0].own_receipt) {
        throw new HandoverError(duplicateMessage);
      }
      if (existing.rows[0].item_handed_over) {
        throw new HandoverError("This item has already been handed over.");
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        // Recover from a random ID collision while retaining the parent claim lock.
        await client.query("SAVEPOINT handover_insert");
        try {
          // Handover_Date comes from its DEFAULT CURRENT_DATE.
          await client.query(
            `INSERT INTO public."HANDOVER" ("Handover_ID", "Claim_ID", "Signature")
             VALUES ($1, $2, $3)`,
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
    revalidatePath("/claim");
    revalidatePath("/claim/handover");
    return { error: null, success: "Item receipt recorded successfully." };
  } catch (error) {
    return {
      error: error instanceof HandoverError ? error.message : "Unable to record receipt. Please try again.",
      success: null,
    };
  }
}
