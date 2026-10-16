import Link from "next/link";
import type { ReplacementVerdict } from "@/lib/products/supplier-replacement";

export type ReviewUiState = { state: "idle" | "preparing" | "ready" | "failed"; batchId?: string; error?: string };
const date = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);
const link = "font-semibold underline";

/**
 * Presentation only. The import result and the product price review are separate stages: the success section depends only on the stored source
 * and the existing resolver's verdict; the review line is shown independently and can fail without undoing the import. Nothing here changes any price.
 */
export function SupplierImportResult({ verdict, existing, review, brandId, sourceId, replaceMode, onRetryReview, busy = false }: { verdict: ReplacementVerdict; existing: boolean; review: ReviewUiState; brandId: string; sourceId: string | null; replaceMode: boolean; onRetryReview: () => void; busy?: boolean }) {
  const base = `/products/price-updates/supplier-sources?brand=${brandId}`;
  if (verdict.status === "not_imported") return <div role="status" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Import not finished</p><p>{verdict.message}</p></div>;
  const details = verdict.details;
  const title = existing ? "No new version was created: this file was already imported with the same settings." : replaceMode && verdict.status === "current" ? "Price list replaced." : "Price List Imported Successfully";
  return <div role="status" aria-label="Import result" className={`space-y-2 rounded-md border p-3 text-sm ${verdict.status === "current" ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
    <p className="font-semibold">{title}</p>
    {details ? <div><p className="font-semibold">{details.title}</p>
      <p className="text-xs">{details.definitionName ? `${details.definitionName} · ` : ""}{details.rows.toLocaleString("en-US")} rows imported · {details.identities.toLocaleString("en-US")} supplier identities · {details.effectiveFrom ? `Effective ${date(details.effectiveFrom)}` : "Effective immediately"}</p></div> : null}
    <p>{verdict.message}</p>
    <p className="text-xs">Earlier versions remain in History. Existing product and quotation prices are unchanged.</p>
    {!replaceMode && review.state !== "idle" ? <div className="rounded border border-white/60 bg-white/60 p-2 text-xs" aria-label="Product price review">
      {review.state === "preparing" ? <p>Preparing product price review…</p> : null}
      {review.state === "ready" ? <p>Review ready.</p> : null}
      {review.state === "failed" ? <p role="alert">Review preparation failed{review.error ? `: ${review.error}` : ""}. The price list import is complete. <button type="button" disabled={busy} onClick={onRetryReview} className={link}>Retry review</button></p> : null}</div> : null}
    <p className="flex flex-wrap gap-3 text-xs">
      {!replaceMode && review.state === "ready" && review.batchId && sourceId ? <Link className={link} href={`${base}&source=${sourceId}&batch=${review.batchId}&view=family`}>Start Price Review</Link> : null}
      <Link className={link} href={`${base}&tab=current`}>{replaceMode ? "Return to Current Price List" : "Go to Current Price List"}</Link>
      <Link className={link} href={`${base}&tab=history`}>Manage Previous Versions</Link></p>
  </div>;
}
