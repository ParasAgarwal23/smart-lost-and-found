"use server";

import { createReport, type ReportState } from "@/lib/report-writes";

export type FoundReportState = ReportState;

// INSERT into FOUND_REPORT with a 384-dimensional embedding (see lib/report-writes.ts).
export async function createFoundReport(
  _previousState: FoundReportState,
  formData: FormData,
): Promise<FoundReportState> {
  return createReport("found", formData);
}
