import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/next-path";
import { getAuthenticatedUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { Icon } from "@/components/icons";
import { EmptyState, formatDate, Notice, placeLabel } from "@/components/ui";
import DeleteReport from "./delete-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Reports" };

type BaseReport = { id: number; Item_Name: string | null; Location_Name: string | null; Building: string | null; date: string | null; Has_Embedding: boolean };
type MyFoundReport = BaseReport & { Claim_Count: string; Has_Handover: boolean };

function EditLink({ type, id }: { type: "lost" | "found"; id: number }) {
  return <Link href={`/my-reports/edit?type=${type}&id=${id}`} className="link-quiet"><Icon name="edit" size={15} />Edit</Link>;
}

export default async function MyReportsPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const deleted = (await searchParams)?.deleted;
  const user = await getAuthenticatedUser();
  if (!user) redirect(loginPath("/my-reports"));

  let lost: BaseReport[] = [];
  let found: MyFoundReport[] = [];
  let error: string | null = null;
  try {
    const [lostResult, foundResult] = await Promise.all([
      query<BaseReport>(
        `SELECT v."Lost_ID" AS id, v."Item_Name", v."Location_Name", v."Building",
                v."Date_Lost"::text AS date, (l."Embedding" IS NOT NULL) AS "Has_Embedding"
         FROM public.v_lost_report_details v
         JOIN public."LOST_REPORT" l ON l."Lost_ID" = v."Lost_ID"
         WHERE v."User_ID" = $1
         ORDER BY v."Date_Lost" DESC NULLS LAST, v."Lost_ID" DESC`,
        [user.User_ID],
      ),
      // Other users' claims are private (RLS), so the claim count and handover
      // flag come from narrow helpers: the count is answered only for the
      // report's owner, and claimant identities are never returned.
      query<MyFoundReport>(
        `SELECT v."Found_ID" AS id, v."Item_Name", v."Location_Name", v."Building",
                v."Date_Found"::text AS date, (f."Embedding" IS NOT NULL) AS "Has_Embedding",
                COALESCE(public.found_report_claim_count(v."Found_ID"), 0)::text AS "Claim_Count",
                public.found_report_has_handover(v."Found_ID") AS "Has_Handover"
         FROM public.v_found_report_details v
         JOIN public."FOUND_REPORT" f ON f."Found_ID" = v."Found_ID"
         WHERE v."User_ID" = $1
         ORDER BY v."Date_Found" DESC NULLS LAST, v."Found_ID" DESC`,
        [user.User_ID],
      ),
    ]);
    lost = lostResult.rows;
    found = foundResult.rows;
  } catch {
    error = "Unable to load your reports. Please try again later.";
  }

  return (
    <main id="main-content" tabIndex={-1} className="container-page max-w-4xl py-8 sm:py-12">
      <h1 className="page-title">My Reports</h1>
      <p className="page-description">Items you have reported. Check possible matches for things you lost, or edit a report if you remember more.</p>
      {(deleted === "lost" || deleted === "found") && (
        <Notice tone="success" className="mt-6">
          Your {deleted} report was deleted{deleted === "lost" ? ", together with its possible-match records" : ""}. Its stored description and search vector were removed with it.
        </Notice>
      )}
      {error ? <Notice tone="error" className="mt-8" action={<a href="/my-reports" className="btn btn-secondary btn-sm">Try again</a>}>{error}</Notice> : (
        <div className="mt-8 grid gap-10">
          <section aria-labelledby="lost-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="lost-heading" className="section-title">Things I lost <span className="font-normal text-ink-3">({lost.length})</span></h2>
              <Link href="/lost-report" className="link text-sm">Report a lost item</Link>
            </div>
            {lost.length === 0 ? (
              <div className="mt-4"><EmptyState icon="question" title="No lost reports" actions={<Link href="/lost-report" className="btn btn-primary btn-sm">Report a lost item</Link>}>Report something you lost to see possible matches.</EmptyState></div>
            ) : (
              <ul className="mt-4 grid gap-3">
                {lost.map((report) => (
                  <li key={report.id} className="card report-card rail-lost flex-row flex-wrap items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <h3 className="font-bold">{report.Item_Name ?? "Unnamed item"}</h3>
                      <p className="text-sm text-ink-3">Lost {formatDate(report.date)} · {placeLabel(report.Location_Name, report.Building)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <DeleteReport kind="lost" reportId={report.id} itemName={report.Item_Name ?? "Unnamed item"} />
                      <EditLink type="lost" id={report.id} />
                      {report.Has_Embedding
                        ? <Link href={`/potential-matches?lostId=${report.id}`} className="btn btn-primary btn-sm"><Icon name="sparkles" size={16} />See matches</Link>
                        : <Link href={`/potential-matches?lostId=${report.id}`} className="link-quiet"><Icon name="info" size={15} />Matches not ready</Link>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="found-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="found-heading" className="section-title">Things I found <span className="font-normal text-ink-3">({found.length})</span></h2>
              <Link href="/found-report" className="link text-sm">Report a found item</Link>
            </div>
            {found.length === 0 ? (
              <div className="mt-4"><EmptyState icon="box" title="No found reports" actions={<Link href="/found-report" className="btn btn-primary btn-sm">Report a found item</Link>}>Found something on campus? Report it so the owner can claim it.</EmptyState></div>
            ) : (
              <ul className="mt-4 grid gap-3">
                {found.map((report) => {
                  const claims = Number(report.Claim_Count);
                  return (
                    <li key={report.id} className={`card report-card ${report.Has_Handover ? "rail-done" : "rail-found"} flex-row flex-wrap items-center justify-between gap-3 py-4`}>
                      <div className="min-w-0">
                        <h3 className="font-bold">{report.Item_Name ?? "Unnamed item"}</h3>
                        <p className="text-sm text-ink-3">Found {formatDate(report.date)} · {placeLabel(report.Location_Name, report.Building)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        {report.Has_Handover
                          ? <span className="flex items-center gap-1.5 font-semibold text-success"><Icon name="gift" size={16} />Returned to owner</span>
                          : <>
                            <span className="text-ink-2">{claims === 0 ? "No claims yet" : `${claims} ${claims === 1 ? "claim" : "claims"}`}</span>
                            <EditLink type="found" id={report.id} />
                          </>}
                        {claims === 0
                          ? <DeleteReport kind="found" reportId={report.id} itemName={report.Item_Name ?? "Unnamed item"} />
                          : <span className="flex items-center gap-1.5 text-ink-3">
                            <button type="button" disabled aria-describedby={`no-delete-${report.id}`} className="link-quiet cursor-not-allowed opacity-60"><Icon name="trash" size={15} />Delete</button>
                            <span id={`no-delete-${report.id}`} className="text-meta">Kept: claimed items can&apos;t be deleted</span>
                          </span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
