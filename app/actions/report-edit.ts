"use server";

import { updateReport, type ReportState } from "@/lib/report-writes";

// Owner-only UPDATE of a lost or found report (see lib/report-writes.ts).
export async function editReport(
  _previousState: ReportState,
  formData: FormData,
): Promise<ReportState> {
  return updateReport(formData);
}
