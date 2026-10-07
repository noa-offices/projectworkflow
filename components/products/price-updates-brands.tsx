import Link from "next/link";
import { supplierFamilyStatusLabels, type SupplierFamilyPriceStatusKey } from "@/lib/products/supplier-family-status";
import { supplierBrandStateLabels, type PriceUpdatesBrandView, type PriceUpdatesFamilyStatus, type PriceUpdatesSourceGroup, type PriceUpdatesSummary } from "@/lib/products/supplier-price-updates-view";

// Presentation only. Labels come from the shared resolver labels; no status is decided here.
const card = "rounded-lg border border-zinc-200 bg-white shadow-sm";
const badgeTone: Record<SupplierFamilyPriceStatusKey, string> = {
  price_checked: "border-emerald-200 bg-emerald-50 text-emerald-900",
  partially_checked: "border-amber-200 bg-amber-50 text-amber-900",
  update_available: "border-amber-200 bg-amber-50 text-amber-900",
  in_review: "border-sky-200 bg-sky-50 text-sky-900",
  ready_to_complete: "border-sky-200 bg-sky-50 text-sky-900",
  needs_attention: "border-red-200 bg-red-50 text-red-900",
  no_price_list: "border-zinc-200 bg-zinc-50 text-zinc-700",
  legacy_manual: "border-zinc-200 bg-zinc-50 text-zinc-700",
};
const brandTone: Record<PriceUpdatesBrandView["state"], string> = {
  current: "border-emerald-200 bg-emerald-50 text-emerald-900", partially_checked: "border-amber-200 bg-amber-50 text-amber-900", update_available: "border-amber-200 bg-amber-50 text-amber-900",
  needs_attention: "border-red-200 bg-red-50 text-red-900", in_review: "border-sky-200 bg-sky-50 text-sky-900", ready_to_complete: "border-sky-200 bg-sky-50 text-sky-900", legacy_manual: "border-zinc-200 bg-zinc-50 text-zinc-700",
};
const badge = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";
const button = "inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50";

export type FamilyActionLink = { label: string; href: string };
export type PriceUpdatesHrefs = {
  /** Where a Family's primary action goes: the exact source review, or the Supplier source when there is no list. */
  familyAction: (status: PriceUpdatesFamilyStatus, brandId: string) => FamilyActionLink;
  /** Where a source group opens. */
  sourceHref: (brandId: string, group: PriceUpdatesSourceGroup) => string;
};

export function PriceUpdatesSummaryCards({ summary }: { summary: PriceUpdatesSummary }) {
  const items: Array<[string, number, string]> = [
    ["Brands current", summary.brandsCurrent, "border-emerald-200 bg-emerald-50 text-emerald-950"],
    ["Updates available", summary.updatesAvailable, "border-amber-200 bg-amber-50 text-amber-950"],
    ["Partially checked", summary.partiallyChecked, "border-amber-200 bg-white text-zinc-950"],
    ["Needs attention", summary.needsAttention, summary.needsAttention ? "border-red-200 bg-red-50 text-red-950" : "border-zinc-200 bg-white text-zinc-950"],
  ];
  return <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Price update summary">{items.map(([label, value, tone]) =>
    <div key={label} className={`rounded-lg border p-3 shadow-sm ${tone}`}><dt className="text-xs font-semibold">{label}</dt><dd className="text-2xl font-semibold tabular-nums">{value}</dd></div>)}</dl>;
}

function FamilyRow({ status, brandId, hrefs }: { status: PriceUpdatesFamilyStatus; brandId: string; hrefs: PriceUpdatesHrefs }) {
  const action = hrefs.familyAction(status, brandId);
  return <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="min-w-0 space-y-1">
      <p className="font-semibold text-zinc-950">{status.familyName}</p>
      <p className="text-xs text-zinc-600">{status.detail}</p>
      {status.progress && (status.status === "partially_checked" || status.status === "needs_attention" || status.status === "in_review" || status.status === "ready_to_complete") ? <p className="text-xs text-zinc-600">{status.progress.checked} of {status.progress.total} pricing targets checked{status.progress.excluded ? ` · ${status.progress.excluded} excluded from Supplier source` : ""}{status.progress.unresolved ? ` · ${status.progress.unresolved} need a decision` : ""}</p> : null}
      {status.upcoming ? <p className="text-xs text-zinc-500">New price list effective {status.upcoming.effectiveFrom}</p> : null}
    </div>
    <div className="flex items-center gap-2 sm:justify-end"><span className={`${badge} ${badgeTone[status.status]}`}>{supplierFamilyStatusLabels[status.status]}</span>
      {status.status === "legacy_manual" ? null : <Link href={action.href} className={button}>{action.label}</Link>}</div>
  </li>;
}

function SourceGroup({ group, brandId, hrefs }: { group: PriceUpdatesSourceGroup; brandId: string; hrefs: PriceUpdatesHrefs }) {
  return <section className="space-y-1 border-t border-zinc-100 pt-3 first:border-t-0 first:pt-0" aria-label={`Source ${group.definitionName}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div><h4 className="text-sm font-semibold text-zinc-950">{group.definitionName}</h4>
        <p className="text-xs text-zinc-600">{group.current ? `Current price list: ${group.current.title}${group.current.effectiveFrom ? ` · effective ${group.current.effectiveFrom}` : ""}` : "No current price list"}</p>
        {group.upcoming ? <p className="text-xs text-zinc-500">Upcoming: {group.upcoming.title} · effective {group.upcoming.effectiveFrom}</p> : null}</div>
      <Link href={hrefs.sourceHref(brandId, group)} className={button}>Open source</Link>
    </div>
    <ul className="divide-y divide-zinc-100">{group.families.map((status) => <FamilyRow key={status.familyId} status={status} brandId={brandId} hrefs={hrefs} />)}</ul>
  </section>;
}

export function PriceUpdatesBrandCard({ view, hrefs }: { view: PriceUpdatesBrandView; hrefs: PriceUpdatesHrefs }) {
  const p = view.progress;
  const applicable = p.applicableFamilies;
  return <details className={`${card} group p-4`}>
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-base font-semibold text-zinc-950">{view.brandName}</p>
        <p className="text-xs text-zinc-600">{applicable ? `${p.checkedFamilies} / ${applicable} Families checked` : "No Supplier-managed Families"}{p.noPriceListFamilies ? ` · ${p.noPriceListFamilies} without a current list` : ""}{p.legacyFamilies ? ` · ${p.legacyFamilies} manual` : ""}</p></div>
      <div className="flex flex-wrap items-center gap-2"><span className={`${badge} ${brandTone[view.state]}`}>{view.stateLabel}</span>
        <span className="text-xs font-semibold text-zinc-500 group-open:hidden">Open Brand</span><span className="hidden text-xs font-semibold text-zinc-500 group-open:inline">Close</span></div>
    </summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-zinc-600">{[p.updateAvailableFamilies && `${p.updateAvailableFamilies} update available`, p.needsAttentionFamilies && `${p.needsAttentionFamilies} needs attention`, p.inReviewFamilies && `${p.inReviewFamilies} in review`, p.partiallyCheckedFamilies && `${p.partiallyCheckedFamilies} partially checked`].filter(Boolean).join(" · ") || "Nothing waiting"}</p>
      {view.sources.map((group) => <SourceGroup key={group.definitionId} group={group} brandId={view.brandId} hrefs={hrefs} />)}
      {view.sources.length === 0 ? <p className="text-sm text-zinc-600">No Supplier price list is set up for this Brand yet.</p> : null}
    </div>
  </details>;
}

export function PriceUpdatesStatusLegend() {
  return <p className="text-xs text-zinc-500">Brand states: {Object.values(supplierBrandStateLabels).join(" · ")}</p>;
}

export type PriceUpdatesBrandSummary = { view: PriceUpdatesBrandView; priceLists: number; reviewsInProgress: number; href: string };
/** Brand-level card for the landing page: counts and one state only. Family rows live in the Brand workspace. */
export function PriceUpdatesBrandSummaryCard({ summary }: { summary: PriceUpdatesBrandSummary }) {
  const { view } = summary, p = view.progress;
  const managed = p.applicableFamilies + p.noPriceListFamilies;
  const needReview = p.updateAvailableFamilies + p.needsAttentionFamilies + p.inReviewFamilies + p.partiallyCheckedFamilies + p.readyToCompleteFamilies;
  const lines = [
    managed ? `${managed} Supplier-managed ${managed === 1 ? "Family" : "Families"}` : "No Supplier-managed Families",
    `${summary.priceLists} ${summary.priceLists === 1 ? "price list" : "price lists"}`,
    summary.reviewsInProgress ? `${summary.reviewsInProgress} ${summary.reviewsInProgress === 1 ? "review" : "reviews"} in progress` : null,
    p.applicableFamilies ? `${p.checkedFamilies} / ${p.applicableFamilies} Families checked` : null,
    needReview ? `${needReview} need review` : null,
    p.upcomingCount ? `${p.upcomingCount} upcoming ${p.upcomingCount === 1 ? "price list" : "price lists"}` : null,
  ].filter((line): line is string => Boolean(line));
  return <li className={`${card} flex flex-col gap-3 p-4`}>
    <div className="flex items-start justify-between gap-2"><h3 className="text-base font-semibold text-zinc-950">{view.brandName}</h3><span className={`${badge} shrink-0 ${brandTone[view.state]}`}>{view.stateLabel}</span></div>
    <ul className="space-y-0.5 text-sm text-zinc-700">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
    <Link href={summary.href} className="mt-auto inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">Open Brand</Link>
  </li>;
}
