"use server";

import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export type EvidenceState = { error: string | null; success: string | null };

const evidenceSchema = z.object({
  claimId: z.string().regex(/^-?\d+$/).transform(Number)
    .pipe(z.number().int().min(-2147483648).max(2147483647)),
  description: z.string().trim().min(1).max(255),
});

class EvidenceError extends Error {}

export async function addClaimEvidence(
  _previousState: EvidenceState,
  formData: FormData,
): Promise<EvidenceState> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { error: "Please sign in to add claim evidence.", success: null };

    const parsed = evidenceSchema.safeParse({
      claimId: formData.get("claimId"),
      description: formData.get("description"),
    });
    if (!parsed.success) {
      return { error: "Choose a valid claim and enter an evidence description of 1 to 255 characters.", success: null };
    }
    const { claimId, description } = parsed.data;

    await withTransaction(async (client) => {
      // Lock the parent, including when it has no evidence, before allocating its partial key.
      const claim = await client.query<{ Claim_ID: number }>(
        `SELECT "Claim_ID" FROM public."CLAIM"
         WHERE "Claim_ID" = $1 AND "User_ID" = $2 FOR UPDATE`,
        [claimId, user.User_ID],
      );
      if (claim.rows.length !== 1) {
        throw new EvidenceError("Claim not found or unavailable to your account.");
      }

      const next = await client.query<{ evidence_no: string }>(
        `SELECT COALESCE(MAX("Evidence_No")::bigint, 0) + 1 AS evidence_no
         FROM public."CLAIM_EVIDENCE" WHERE "Claim_ID" = $1`,
        [claimId],
      );
      const evidenceNo = Number(next.rows[0].evidence_no);
      if (evidenceNo > 2147483647) {
        throw new EvidenceError("Unable to add more evidence to this claim.");
      }

      await client.query(
        `INSERT INTO public."CLAIM_EVIDENCE"
         ("Claim_ID", "Evidence_No", "Evidence_Description", "File_Path")
         VALUES ($1, $2, $3, NULL)`,
        [claimId, evidenceNo, description],
      );
    });
    return { error: null, success: "Claim evidence added successfully." };
  } catch (error) {
    return {
      error: error instanceof EvidenceError ? error.message : "Unable to add claim evidence. Please try again.",
      success: null,
    };
  }
}
