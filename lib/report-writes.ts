import "server-only";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAuthenticatedUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { generateEmbedding } from "@/lib/embedding";
import { choicesExist, databaseId, isPrimaryKeyCollision, parseReportForm, type ReportKind } from "@/lib/report-input";

export type ReportState = {
  error: string | null;
  success: string | null;
  reportId?: number;
  itemName?: string;
  fieldErrors?: Record<string, string>;
};

// Table metadata. Identifiers come from this fixed map, never from user input.
const TABLES = {
  lost: { table: '"LOST_REPORT"', id: '"Lost_ID"', date: '"Date_Lost"', pkey: "LOST_REPORT_pkey", label: "lost" },
  found: { table: '"FOUND_REPORT"', id: '"Found_ID"', date: '"Date_Found"', pkey: "FOUND_REPORT_pkey", label: "found" },
} as const;

class ReportError extends Error {}

function refreshReportPages() {
  // The write is already committed: a cache refresh failure must not invite a duplicate retry.
  try {
    for (const path of ["/search", "/potential-matches", "/claim", "/my-reports"]) revalidatePath(path);
  } catch { console.error("Report saved, but page revalidation failed."); }
}

export async function createReport(kind: ReportKind, formData: FormData): Promise<ReportState> {
  const meta = TABLES[kind];
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { error: `Please sign in to create a ${meta.label} report. Your entries are still in the form.`, success: null };

    const parsed = parseReportForm(kind, formData);
    if (!parsed.ok) return { error: "Please correct the highlighted fields.", success: null, fieldErrors: parsed.fieldErrors };
    const fields = parsed.fields;

    if (!(await choicesExist(fields.categoryId, fields.locationId))) {
      return { error: "Choose an existing category and location.", success: null, fieldErrors: { categoryId: "Check the selected category.", locationId: "Check the selected location." } };
    }

    let embedding: string;
    try {
      embedding = JSON.stringify(await generateEmbedding(fields.itemName, fields.description));
    } catch {
      return { error: "Unable to process the description right now. Your entries are still in the form — please try again.", success: null };
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const reportId = randomInt(1, 2147483648);
        await query(
          `INSERT INTO public.${meta.table}
           (${meta.id}, "User_ID", "Category_ID", "Location_ID", "Item_Name", "Description", ${meta.date}, "Status", "Embedding")
           VALUES ($1, $2, $3, $4, $5, $6, $7::date, NULL, $8::public.vector(384))`,
          [reportId, user.User_ID, fields.categoryId, fields.locationId,
            fields.itemName, fields.description, fields.reportDate, embedding],
        );
        refreshReportPages();
        return {
          error: null,
          success: `${kind === "lost" ? "Lost" : "Found"} report submitted successfully.`,
          reportId,
          itemName: fields.itemName,
        };
      } catch (error) {
        // Retry only the approved randomly generated primary-key collision.
        if (!isPrimaryKeyCollision(error, meta.pkey)) throw error;
      }
    }
  } catch {
    // Includes database/foreign-key failures without exposing internal details.
  }
  return { error: "Unable to submit your report right now. Your entries are still in the form — please try again.", success: null };
}

// UPDATE workflow. Changing Item_Name or Description fires the
// invalidate_report_embedding trigger (db/triggers.sql), which sets Embedding
// to NULL; the same transaction then stores the freshly generated vector.
export async function updateReport(formData: FormData): Promise<ReportState> {
  const kindValue = formData.get("kind");
  if (kindValue !== "lost" && kindValue !== "found") return { error: "Choose a valid report.", success: null };
  const kind: ReportKind = kindValue;
  const meta = TABLES[kind];

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { error: "Please sign in to edit your report. Your edits are still in the form.", success: null };

    const id = databaseId.safeParse(formData.get("reportId"));
    if (!id.success) return { error: "Report not found or unavailable to your account.", success: null };
    const reportId = id.data;

    const parsed = parseReportForm(kind, formData);
    if (!parsed.ok) return { error: "Please correct the highlighted fields.", success: null, fieldErrors: parsed.fieldErrors };
    const fields = parsed.fields;

    if (!(await choicesExist(fields.categoryId, fields.locationId))) {
      return { error: "Choose an existing category and location.", success: null, fieldErrors: { categoryId: "Check the selected category.", locationId: "Check the selected location." } };
    }

    const current = await query<{ Item_Name: string | null; Description: string | null; Missing_Embedding: boolean }>(
      `SELECT "Item_Name", "Description", ("Embedding" IS NULL) AS "Missing_Embedding"
       FROM public.${meta.table} WHERE ${meta.id} = $1 AND "User_ID" = $2`,
      [reportId, user.User_ID],
    );
    if (current.rows.length !== 1) return { error: "Report not found or unavailable to your account.", success: null };
    const textChanged = (row: { Item_Name: string | null; Description: string | null }) =>
      row.Item_Name !== fields.itemName || row.Description !== fields.description;

    // Model inference is slow, so it runs before the transaction opens. A report
    // without a vector (e.g. seed data) also receives one when it is edited.
    let embedding: string | null = null;
    if (textChanged(current.rows[0]) || current.rows[0].Missing_Embedding) {
      try {
        embedding = JSON.stringify(await generateEmbedding(fields.itemName, fields.description));
      } catch {
        return { error: "Unable to process the description right now. Your entries are still in the form — please try again.", success: null };
      }
    }

    await withTransaction(async (client) => {
      const locked = await client.query<{ Item_Name: string | null; Description: string | null }>(
        `SELECT "Item_Name", "Description" FROM public.${meta.table}
         WHERE ${meta.id} = $1 AND "User_ID" = $2 FOR UPDATE`,
        [reportId, user.User_ID],
      );
      if (locked.rows.length !== 1) throw new ReportError("Report not found or unavailable to your account.");
      if (textChanged(locked.rows[0]) && embedding === null) {
        throw new ReportError("This report changed while you were editing. Reload the page and try again.");
      }
      if (kind === "found") {
        // A completed handover closes the record its claimants relied on.
        const handed = await client.query<{ handed_over: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM public."CLAIM" c JOIN public."HANDOVER" h ON h."Claim_ID" = c."Claim_ID"
             WHERE c."Found_ID" = $1
           ) AS handed_over`,
          [reportId],
        );
        if (handed.rows[0].handed_over) {
          throw new ReportError("This item has already been handed over, so its report can no longer be edited.");
        }
      }

      await client.query(
        `UPDATE public.${meta.table}
         SET "Item_Name" = $3, "Description" = $4, "Category_ID" = $5, "Location_ID" = $6, ${meta.date} = $7::date
         WHERE ${meta.id} = $1 AND "User_ID" = $2`,
        [reportId, user.User_ID, fields.itemName, fields.description,
          fields.categoryId, fields.locationId, fields.reportDate],
      );
      if (embedding !== null) {
        // Separate statement: the trigger has just cleared the stale vector.
        await client.query(
          `UPDATE public.${meta.table} SET "Embedding" = $2::public.vector(384) WHERE ${meta.id} = $1`,
          [reportId, embedding],
        );
      }
    });
    refreshReportPages();
    return { error: null, success: "Report updated successfully.", reportId, itemName: fields.itemName };
  } catch (error) {
    return {
      error: error instanceof ReportError ? error.message : "Unable to save your changes right now. Your edits are still in the form — please try again.",
      success: null,
    };
  }
}
