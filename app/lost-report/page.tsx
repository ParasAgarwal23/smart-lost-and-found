import type { Metadata } from "next";
import CreateReportPage from "@/components/report-page";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Report a lost item" };

export default async function LostReportPage() {
  return CreateReportPage({ kind: "lost" });
}
