"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getAuthenticatedUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export type EvidenceState = { error: string | null; success: string | null; claimId?: number; fieldErrors?: Record<string, string>; signedOut?: boolean };

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
    if (!user) return { error: "Please sign in to add claim evidence.", success: null, signedOut: true };

    const parsed = evidenceSchema.safeParse({
      claimId: formData.get("claimId"),
      description: formData.get("description"),
    });
    if (!parsed.success) {
      return { error: "Choose a valid claim and enter an evidence description of 1 to 255 characters.", success: null, fieldErrors: Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), "Check this field."])) };
    }
    const { claimId, description } = parsed.data;

    await withTransaction(async (client) => {
      // Lock the shared found report first (the same order as handover and
      // withdrawal, so they cannot deadlock), then the owned claim itself.
      const report = await client.query(
        `SELECT f."Found_ID" FROM public."FOUND_REPORT" AS f
         JOIN public."CLAIM" AS c ON c."Found_ID" = f."Found_ID"
         WHERE c."Claim_ID" = $1 AND c."User_ID" = $2 FOR UPDATE OF f`,
        [claimId, user.User_ID],
      );
      if (report.rows.length !== 1) {
        throw new EvidenceError("Claim not found or unavailable to your account.");
      }

      // Lock the parent, including when it has no evidence, before allocating its partial key.
      const claim = await client.query<{ handed_over: boolean }>(
        `SELECT public.found_report_has_handover(c."Found_ID") AS handed_over
         FROM public."CLAIM" AS c
         WHERE c."Claim_ID" = $1 AND c."User_ID" = $2 FOR UPDATE`,
        [claimId, user.User_ID],
      );
      if (claim.rows.length !== 1) {
        throw new EvidenceError("Claim not found or unavailable to your account.");
      }
      // A handover (to this claimant or another) closes every claim on the item,
      // so a form left open in another tab cannot add evidence afterwards.
      if (claim.rows[0].handed_over) {
        throw new EvidenceError("This item has already been handed over, so this claim is closed and no more evidence can be added.");
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
    revalidatePath("/claim");
    revalidatePath("/claim/evidence");
    return { error: null, success: "Claim evidence added successfully.", claimId };
  } catch (error) {
    return {
      error: error instanceof EvidenceError ? error.message : "Unable to add claim evidence. Please try again.",
      success: null,
    };
  }
}
