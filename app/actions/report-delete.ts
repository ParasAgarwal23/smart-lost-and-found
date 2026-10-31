"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { databaseId } from "@/lib/report-input";

export type DeleteReportState = { error: string | null; success: string | null; signedOut?: boolean };

const deleteSchema = z.object({ kind: z.enum(["lost", "found"]), reportId: databaseId });

// DELETE workflow for one's own report, implemented by the stored procedure
// public.delete_own_report (db/procedures.sql). Ownership comes from the
// session identity inside the database, never from the submitted form. The
// report's Embedding is a column of the deleted row, so its vector goes too.
export async function deleteReport(
  _previousState: DeleteReportState,
  formData: FormData,
): Promise<DeleteReportState> {
  let kind: "lost" | "found";
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { error: "Please sign in to delete a report.", success: null, signedOut: true };

    const parsed = deleteSchema.safeParse({ kind: formData.get("kind"), reportId: formData.get("reportId") });
    if (!parsed.success) return { error: "Report not found or unavailable to your account.", success: null };
    kind = parsed.data.kind;

    await withTransaction((client) =>
      client.query("CALL public.delete_own_report($1, $2)", [parsed.data.kind, parsed.data.reportId]));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "LF404") return { error: "Report not found or unavailable to your account.", success: null };
    // LF409 from the procedure, or 23503 from the CLAIM foreign key backstop.
    if (code === "LF409" || code === "23503") {
      return { error: "Someone has claimed this item, so its report can't be deleted. Claims and handover history are kept.", success: null };
    }
    return { error: "Unable to delete the report right now. Please try again.", success: null };
  }

  try {
    for (const path of ["/my-reports", "/search", "/potential-matches", "/claim", "/"]) revalidatePath(path);
  } catch { console.error("Report deleted, but page revalidation failed."); }
  // redirect throws internally; keep it outside the error handler.
  redirect(`/my-reports?deleted=${kind}`);
}
