import type { Metadata } from "next";
import CreateReportPage from "@/components/report-page";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Report a found item" };

export default async function FoundReportPage() {
  return CreateReportPage({ kind: "found" });
}
