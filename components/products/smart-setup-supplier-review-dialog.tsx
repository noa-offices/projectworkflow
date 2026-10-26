"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { SmartSetupSupplierSourceOption } from "@/lib/products/smart-setup-supplier-sources";
import { buildReviewRows, countReviewStatuses, DEFAULT_REVIEW_STATUSES, filterReviewRows, REVIEW_STATUS_CHIPS, reviewRowsToCsv, reviewSortLabels, reviewStatusLabels, sortReviewRows, toggleReviewStatus, type ReviewRow, type ReviewSort, type ReviewStatus } from "@/lib/products/smart-setup-supplier-review";
import { evidenceText, importedPriceText, reasonLabels, referencePriceText } from "@/lib/products/smart-setup-supplier-verification";
import type { SupplierCheckedResult } from "@/components/products/smart-setup-supplier-verification";

const ROW_HEIGHT = 60;
const WINDOW_ABOVE = 300; // beyond this many shown rows only the visible slice is rendered
const OVERSCAN = 8;
const chipTone: Record<ReviewStatus, { on: string; off: string }> = {
  NEEDS_REVIEW: { on: "border-amber-500 bg-amber-100 text-amber-950", off: "border-zinc-300 bg-white text-zinc-700" },
  MISMATCH: { on: "border-red-500 bg-red-100 text-red-950", off: "border-zinc-300 bg-white text-zinc-700" },
  NOT_FOUND: { on: "border-zinc-500 bg-zinc-200 text-zinc-900", off: "border-zinc-300 bg-white text-zinc-700" },
  MATCHED: { on: "border-emerald-600 bg-emerald-100 text-emerald-950", off: "border-zinc-300 bg-white text-zinc-700" },
};
const pillTone: Record<ReviewStatus, string> = { MATCHED: "border-emerald-300 bg-emerald-50 text-emerald-900", MISMATCH: "border-red-300 bg-red-50 text-red-900", NOT_FOUND: "border-zinc-300 bg-zinc-100 text-zinc-700", NEEDS_REVIEW: "border-amber-300 bg-amber-50 text-amber-900" };
const amountFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 4, signDisplay: "exceptZero" });
const percentFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2, signDisplay: "exceptZero" });
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function downloadCsv(rows: ReviewRow[], title: string) {
  const url = URL.createObjectURL(new Blob([reviewRowsToCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `supplier-price-review-${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "export"}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

export type SupplierReviewDialogProps = { fresh: SupplierCheckedResult | null; stale: boolean; selected: SmartSetupSupplierSourceOption | null; onClose: () => void; initialStatuses?: ReviewStatus[]; initialQuery?: string };
/** Large read-only view of the check result held by the verification panel. It owns only its own view state (filters, search, sort) and never touches the draft. */
export function SupplierReviewDialog({ fresh, stale, selected, onClose, initialStatuses = DEFAULT_REVIEW_STATUSES, initialQuery = "" }: SupplierReviewDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [statuses, setStatuses] = useState<ReadonlySet<ReviewStatus>>(() => new Set(initialStatuses));
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<ReviewSort>("status");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(800);

  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const measure = () => setViewport(el.clientHeight || 800); measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [fresh]);

  const allRows = fresh ? buildReviewRows(fresh.output.results, fresh.cells) : [];
  const counts = countReviewStatuses(allRows);
  const shown = sortReviewRows(filterReviewRows(allRows, statuses, query), sort);
  const windowed = shown.length > WINDOW_ABOVE;
  const first = windowed ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const last = windowed ? Math.min(shown.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN) : shown.length;
  const backToTop = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; setScrollTop(0); };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0); // keeps focus inside the dialog
    if (!items.length) { event.preventDefault(); return; }
    const firstItem = items[0], lastItem = items[items.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === firstItem || active === panelRef.current)) { event.preventDefault(); lastItem.focus(); }
    else if (!event.shiftKey && active === lastItem) { event.preventDefault(); firstItem.focus(); }
  };

  const controls = fresh ? <>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Show rows with these statuses" className="flex flex-wrap gap-2">
              {REVIEW_STATUS_CHIPS.map((s) => {
                const on = statuses.has(s);
                return <button key={s} type="button" aria-pressed={on} onClick={() => { setStatuses((current) => toggleReviewStatus(current, s)); backToTop(); }} className={`h-9 rounded-full border px-3 text-sm font-semibold ${on ? chipTone[s].on : chipTone[s].off}`}>{reviewStatusLabels[s]} <span className="font-normal">{counts[s]}</span></button>;
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-48 flex-1 text-sm font-medium text-zinc-700">Search
              <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); backToTop(); }} placeholder="Model, code, category or price field" className="mt-1 block h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm" />
            </label>
            <label className="text-sm font-medium text-zinc-700">Sort by
              <select value={sort} onChange={(e) => { setSort(e.target.value as ReviewSort); backToTop(); }} className="mt-1 block h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm">
                {(Object.keys(reviewSortLabels) as ReviewSort[]).map((k) => <option key={k} value={k}>{reviewSortLabels[k]}</option>)}
              </select>
            </label>
            <button type="button" disabled={!shown.length} onClick={() => downloadCsv(shown, fresh.output.source.title)} className="h-9 rounded-md border border-emerald-700 bg-white px-3 text-sm font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50">Export CSV</button>
          </div>
          <p className="text-sm text-zinc-600" aria-live="polite">Showing {shown.length} of {allRows.length} rows</p>
  </> : null;

  return <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/55 p-[2.5vw]">
    <div ref={panelRef} tabIndex={-1} onKeyDown={onKeyDown} className="flex h-[95dvh] w-[95vw] min-w-0 flex-col overflow-hidden rounded-xl bg-white text-zinc-900 shadow-2xl outline-none">
      <header className="shrink-0 space-y-3 border-b border-zinc-200 bg-zinc-50 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">Supplier price review</h2>
            {fresh ? <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-sm text-zinc-700">
              <div className="flex gap-1"><dt className="text-zinc-500">Price list</dt><dd className="font-semibold">{fresh.output.source.title}</dd></div>
              <div className="flex gap-1"><dt className="text-zinc-500">Currency</dt><dd className="font-semibold">{fresh.output.source.currency}</dd></div>
              <div className="flex gap-1"><dt className="text-zinc-500">Price basis</dt><dd className="font-semibold">{fresh.output.source.basis}</dd></div>
              {selected?.effectiveFrom ? <div className="flex gap-1"><dt className="text-zinc-500">Effective</dt><dd className="font-semibold">{selected.effectiveFrom}</dd></div> : null}
            </dl> : null}
          </div>
          <button type="button" onClick={onClose} className="h-9 shrink-0 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-100">Close</button>
        </div>
        {controls ? <div className="hidden space-y-3 sm:block">{controls}</div> : null}
      </header>
      {!fresh ? <div className="p-4 text-sm">
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">{stale ? "The draft or selection changed after the last check, so this result is out of date and is no longer shown. Close this window and run Check Supplier Prices again." : "There is no supplier price check to show. Close this window and run Check Supplier Prices first."}</p>
      </div> : <div ref={scrollRef} tabIndex={0} role="region" aria-label="Supplier price rows" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-auto">
        {/* On narrow screens the filters live in the scroll area so they scroll away; the table header stays sticky. */}
        <div className="space-y-3 border-b border-zinc-200 bg-zinc-50 p-3 sm:hidden">{controls}</div>
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 shadow-[0_1px_0_#d4d4d8]">
            <tr><th scope="col" className="px-3 py-2">Model / code</th><th scope="col" className="px-3 py-2">Price field / category</th><th scope="col" className="px-3 py-2 text-right">Imported price</th><th scope="col" className="px-3 py-2 text-right">Supplier price</th><th scope="col" className="px-3 py-2 text-right">Difference</th><th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2">Reason / evidence</th></tr>
          </thead>
          <tbody>
            {first > 0 ? <tr aria-hidden="true" style={{ height: first * ROW_HEIGHT }}><td colSpan={7} className="p-0" /></tr> : null}
            {shown.slice(first, last).map((row) => <ReviewTableRow key={row.result.locator} row={row} />)}
            {last < shown.length ? <tr aria-hidden="true" style={{ height: (shown.length - last) * ROW_HEIGHT }}><td colSpan={7} className="p-0" /></tr> : null}
          </tbody>
        </table>
        {!shown.length ? <p className="p-4 text-sm text-zinc-600">{allRows.length ? "No rows match the selected statuses and search." : "The check returned no rows."}</p> : null}
      </div>}
    </div>
  </div>;
}

function ReviewTableRow({ row }: { row: ReviewRow }) {
  const { result: r, difference } = row;
  const evidence = evidenceText(r);
  const tone = !difference || difference.amount === 0 ? "text-zinc-700" : difference.amount > 0 ? "text-red-700" : "text-blue-700";
  const direction = !difference || difference.amount === 0 ? "" : difference.amount > 0 ? "Imported price is higher than the supplier price" : "Imported price is lower than the supplier price";
  return <tr style={{ height: ROW_HEIGHT }} className="border-b border-zinc-200 align-middle hover:bg-zinc-50">
    <td className="max-w-72 px-3"><div className="line-clamp-2 font-semibold" title={row.model}>{row.model}</div><div className="truncate text-zinc-600" title={r.code}>{r.code}</div></td>
    <td className="max-w-56 px-3"><div className="line-clamp-2" title={row.category}>{row.category}</div>{r.role !== "main_product" ? <div className="truncate text-zinc-500">{r.role.replace(/_/g, " ")}</div> : null}</td>
    <td className="whitespace-nowrap px-3 text-right tabular-nums">{importedPriceText(r)}</td>
    <td className="whitespace-nowrap px-3 text-right tabular-nums">{referencePriceText(r)}</td>
    <td className={`whitespace-nowrap px-3 text-right tabular-nums font-semibold ${tone}`} title={direction || undefined}>{difference ? <>{amountFormat.format(difference.amount)}{difference.percent !== null ? <span className="block text-xs font-normal">{percentFormat.format(difference.percent)}%</span> : null}</> : <span className="font-normal text-zinc-400">—</span>}</td>
    <td className="px-3"><span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${pillTone[r.status]}`}>{reviewStatusLabels[r.status]}</span></td>
    <td className="max-w-md px-3 text-zinc-700"><div className="line-clamp-2" title={reasonLabels[r.reason]}>{reasonLabels[r.reason]}</div>{evidence ? <div className="truncate text-xs text-zinc-500">{evidence}</div> : null}</td>
  </tr>;
}
