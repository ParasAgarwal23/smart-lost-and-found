import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/next-path";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { localToday } from "@/lib/reference-data";
import { Icon } from "@/components/icons";
import ReportForm from "@/components/report-form";
import { loadOptions, ReportPageFrame } from "@/components/report-page";
import { Notice } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit report" };

type EditableReport = { Item_Name: string | null; Description: string | null; Category_ID: number; Location_ID: number; date: string | null; Has_Handover: boolean };

export default async function EditReportPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect(loginPath("/my-reports"));
  const { type, id } = await searchParams;
  const kind = type === "found" ? "found" : "lost";
  const back = { href: "/my-reports", label: "Back to My Reports" };
  const reportId = typeof id === "string" && /^-?\d+$/.test(id) ? Number(id) : NaN;
  const validId = (type === "lost" || type === "found") && Number.isInteger(reportId) && reportId >= -2147483648 && reportId <= 2147483647;

  let report: EditableReport | undefined;
  let error: string | null = null;
  const options = await loadOptions();
  if (validId) {
    try {
      // Ownership is part of the WHERE clause, so foreign IDs simply return no row.
      const result = kind === "lost"
        ? await query<EditableReport>(
          `SELECT "Item_Name", "Description", "Category_ID", "Location_ID", "Date_Lost"::text AS date, false AS "Has_Handover"
           FROM public."LOST_REPORT" WHERE "Lost_ID" = $1 AND "User_ID" = $2`, [reportId, user.User_ID])
        : await query<EditableReport>(
          `SELECT f."Item_Name", f."Description", f."Category_ID", f."Location_ID", f."Date_Found"::text AS date,
                  EXISTS (SELECT 1 FROM public."CLAIM" c JOIN public."HANDOVER" h ON h."Claim_ID" = c."Claim_ID"
                          WHERE c."Found_ID" = f."Found_ID") AS "Has_Handover"
           FROM public."FOUND_REPORT" f WHERE f."Found_ID" = $1 AND f."User_ID" = $2`, [reportId, user.User_ID]);
      report = result.rows[0];
    } catch {
      error = "Unable to load this report. Please try again later.";
    }
  }

  const title = kind === "lost" ? "Edit lost report" : "Edit found report";
  // Changing the name or description re-prepares matching (trigger + new vector in one transaction).
  const description = "Change anything that's wrong or add details you've remembered.";

  let body;
  if (options.error || error) {
    body = <Notice tone="error">{options.error ?? error}</Notice>;
  } else if (!report) {
    body = <Notice tone="error" action={<Link href="/my-reports" className="btn btn-secondary btn-sm"><Icon name="list" size={16} />My Reports</Link>}>Report not found or unavailable to your account.</Notice>;
  } else if (report.Has_Handover) {
    body = <Notice tone="info" action={<Link href="/my-reports" className="btn btn-secondary btn-sm">Back to My Reports</Link>}>This item has already been returned to its owner, so its report can no longer be edited.</Notice>;
  } else {
    body = (
      <ReportForm key={`${kind}-${reportId}`} kind={kind} categories={options.categories} locations={options.locations} today={localToday()}
        edit={{
          reportId,
          values: {
            itemName: report.Item_Name ?? "",
            description: report.Description ?? "",
            categoryId: String(report.Category_ID),
            locationId: String(report.Location_ID),
            date: report.date ?? "",
          },
        }} />
    );
  }

  return (
    <ReportPageFrame kind={kind} title={title} description={description} back={back}>
      {body}
    </ReportPageFrame>
  );
}
