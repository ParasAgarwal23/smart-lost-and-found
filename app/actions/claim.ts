"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export type ClaimState = { error: string | null; success: string | null; claimId?: number; signedOut?: boolean };

const databaseId = z.string().regex(/^-?\d+$/).transform(Number)
  .pipe(z.number().int().min(-2147483648).max(2147483647));
const claimSchema = z.object({ foundId: databaseId });
const withdrawSchema = z.object({ claimId: databaseId });

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
    if (!user) return { error: "Please sign in to submit a claim.", success: null, signedOut: true };

    const parsed = claimSchema.safeParse({ foundId: formData.get("foundId") });
    if (!parsed.success) return { error: "Choose a valid found report.", success: null };
    const { foundId } = parsed.data;

    const claimId = await withTransaction(async (client) => {
      // Serialize submissions for this report before checking existing claims.
      const report = await client.query<{ User_ID: number }>(
        `SELECT "User_ID" FROM public."FOUND_REPORT" WHERE "Found_ID" = $1 FOR UPDATE`,
        [foundId],
      );
      if (report.rows.length !== 1) throw new ClaimError("Found report is unavailable.");
      if (report.rows[0].User_ID === user.User_ID) {
        throw new ClaimError("You cannot claim your own found report.");
      }

      // Other users' claims are invisible under RLS; found_report_has_handover
      // answers the one cross-user question this check needs.
      const eligibility = await client.query<{ has_handover: boolean; already_claimed: boolean }>(
        `SELECT public.found_report_has_handover($1) AS has_handover,
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
          const insertedClaimId = randomInt(1, 2147483648);
          // Claim_Date comes from its DEFAULT CURRENT_DATE; Status stays NULL.
          await client.query(
            `INSERT INTO public."CLAIM" ("Claim_ID", "User_ID", "Found_ID")
             VALUES ($1, $2, $3)`,
            [insertedClaimId, user.User_ID, foundId],
          );
          await client.query("RELEASE SAVEPOINT claim_insert");
          return insertedClaimId;
        } catch (error) {
          // Database backstop for the eligibility check above (UNIQUE (User_ID, Found_ID)).
          if (typeof error === "object" && error !== null && "constraint" in error && error.constraint === "CLAIM_User_ID_Found_ID_key") {
            throw new ClaimError("You have already claimed this found report.");
          }
          if (!isPrimaryKeyCollision(error)) throw error;
          await client.query("ROLLBACK TO SAVEPOINT claim_insert");
          await client.query("RELEASE SAVEPOINT claim_insert");
        }
      }
      throw new ClaimError("Unable to submit your claim. Please try again.");
    });
    revalidatePath("/claim");
    revalidatePath("/claim/evidence");
    revalidatePath("/claim/handover");
    return { error: null, success: "Claim submitted successfully.", claimId };
  } catch (error) {
    return {
      error: error instanceof ClaimError ? error.message : "Unable to submit your claim. Please try again.",
      success: null,
    };
  }
}

export type WithdrawState = { error: string | null; success: string | null; signedOut?: boolean };

// DELETE workflow, implemented by the stored procedure public.withdraw_claim
// (db/procedures.sql): it checks ownership from the session identity, locks
// FOUND_REPORT then CLAIM (the same order as createHandover, so a concurrent
// handover and withdrawal cannot deadlock), refuses after a handover, and
// deletes the evidence rows before the claim, all inside this transaction.
export async function withdrawClaim(
  _previousState: WithdrawState,
  formData: FormData,
): Promise<WithdrawState> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { error: "Please sign in to withdraw a claim.", success: null, signedOut: true };

    const parsed = withdrawSchema.safeParse({ claimId: formData.get("claimId") });
    if (!parsed.success) return { error: "Claim not found or unavailable to your account.", success: null };
    const { claimId } = parsed.data;

    let removedEvidence: number;
    try {
      const result = await withTransaction((client) =>
        client.query<{ p_removed_evidence: number }>("CALL public.withdraw_claim($1, NULL)", [claimId]));
      removedEvidence = result.rows[0]?.p_removed_evidence ?? 0;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "LF404") throw new ClaimError("Claim not found or unavailable to your account.");
      if (code === "LF409") throw new ClaimError("This claim has a recorded handover and cannot be withdrawn.");
      throw error;
    }
    for (const path of ["/claim", "/claim/evidence", "/claim/handover", "/search", "/potential-matches", "/my-reports"]) {
      revalidatePath(path);
    }
    return {
      error: null,
      success: `Claim withdrawn.${removedEvidence > 0 ? ` ${removedEvidence} evidence ${removedEvidence === 1 ? "entry was" : "entries were"} removed with it.` : ""}`,
    };
  } catch (error) {
    return {
      error: error instanceof ClaimError ? error.message : "Unable to withdraw your claim. Please try again.",
      success: null,
    };
  }
}
