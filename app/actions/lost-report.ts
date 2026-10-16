"use server";

import { createReport, type ReportState } from "@/lib/report-writes";

export type LostReportState = ReportState;

// INSERT into LOST_REPORT with a 384-dimensional embedding (see lib/report-writes.ts).
export async function createLostReport(
  _previousState: LostReportState,
  formData: FormData,
): Promise<LostReportState> {
  return createReport("lost", formData);
}
