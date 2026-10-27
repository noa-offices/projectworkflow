"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { SmartSetupSupplierSourceOption } from "@/lib/products/smart-setup-supplier-sources";
import { countReviewStatuses, DEFAULT_REVIEW_STATUSES, filterReviewedRows, filterReviewRows, isReviewedRow, REVIEW_STATUS_CHIPS, reviewRowsToCsv, reviewSortLabels, reviewStatusLabels, sortReviewRows, toggleReviewStatus, type ReviewRow, type ReviewSort, type ReviewStatus } from "@/lib/products/smart-setup-supplier-review";
import { evidenceText, importedPriceText, reasonLabels, referencePriceText } from "@/lib/products/smart-setup-supplier-verification";
import type { SupplierCheckedResult } from "@/components/products/smart-setup-supplier-verification";
import { decisionWithDraft, decisionKey, decisionLabels, draftForRow, supplierPriceChanged, usableSupplierPrice, type DecisionMap, type ReviewDecision, type SavedReviewDecision } from "@/lib/products/supplier-review-decisions";
import { useSupplierReviewDecisions } from "./use-supplier-review-decisions";
import { ReviewDecisionControls, ReviewSaveButton } from "./supplier-review-decision-controls";

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
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function downloadCsv(rows: ReviewRow[], title: string, decisions: DecisionMap, conflicts: ReadonlySet<string>) {
  const url = URL.createObjectURL(new Blob([reviewRowsToCsv(rows, decisions, conflicts)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `supplier-price-review-${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "export"}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

export type SupplierReviewDialogProps = { fresh: SupplierCheckedResult | null; stale: boolean; selected: SmartSetupSupplierSourceOption | null; onClose: () => void; initialStatuses?: ReviewStatus[]; initialQuery?: string; canManageDecisions?: boolean; onDecisionsSaved?: (decisions: SavedReviewDecision[]) => void };
/** The check stays read-only. Managers may explicitly save separate decisions; the draft is never changed. */
export function SupplierReviewDialog({ fresh, stale, selected, onClose, initialStatuses = DEFAULT_REVIEW_STATUSES, initialQuery = "", canManageDecisions = false, onDecisionsSaved }: SupplierReviewDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [statuses, setStatuses] = useState<ReadonlySet<ReviewStatus>>(() => new Set(initialStatuses));
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<ReviewSort>("status");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(800);
  const decisions = useSupplierReviewDecisions(fresh, canManageDecisions, onDecisionsSaved);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<ReviewDecision | "">("");
  const [decisionFilter, setDecisionFilter] = useState<"" | "undecided" | "decided" | "check_later">("");
  const [showReviewed, setShowReviewed] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => { if (decisions.saving) return; if (decisions.unsavedCount) setConfirmClose(true); else onClose(); };

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

  const allRows = decisions.rows;
  const counts = countReviewStatuses(allRows);
  const effectiveDecision = (row: ReviewRow) => decisions.conflicts.has(decisionKey(row)) ? "" : decisionWithDraft(row, decisions.saved[decisionKey(row)], decisions.edits[decisionKey(row)]);
  const reviewed = (row: ReviewRow) => canManageDecisions && !decisions.conflicts.has(decisionKey(row)) && isReviewedRow(row, decisions.saved[decisionKey(row)], !!decisions.edits[decisionKey(row)]);
  const filtered = filterReviewRows(allRows, statuses, query).filter((row) => !canManageDecisions || !decisionFilter || (decisionFilter === "undecided" ? !effectiveDecision(row) : decisionFilter === "decided" ? !!effectiveDecision(row) : effectiveDecision(row) === "check_later"));
  const reviewedCount = filtered.filter(reviewed).length;
  const hideReviewed = canManageDecisions && !showReviewed && decisionFilter !== "decided";
  const reviewedHidden = hideReviewed ? reviewedCount : 0;
  const shown = sortReviewRows(canManageDecisions ? filterReviewedRows(filtered, decisions.saved, new Set(Object.keys(decisions.edits)), !hideReviewed, decisions.conflicts) : filtered, sort);
  // Manager rows hold action controls and vary in height, so they are all rendered (a check has at most 500 rows); read-only rows are windowed.
  const windowed = !canManageDecisions && shown.length > WINDOW_ABOVE;
  const first = windowed ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const last = windowed ? Math.min(shown.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN) : shown.length;
  const backToTop = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; setScrollTop(0); };
  const eligibleKeys = [...new Set(shown.filter((r) => !decisions.conflicts.has(decisionKey(r))).map(decisionKey))];
  const selectedShownKeys = new Set([...selectedKeys].filter((key) => eligibleKeys.includes(key)));
  const saveDecisions = async () => {
    const savedCount = await decisions.save();
    if (savedCount) { setSelectedKeys(new Set()); requestAnimationFrame(() => saveButtonRef.current?.focus()); }
  };
  const toggleSelected = (key: string) => setSelectedKeys((current) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });
  const actionControls = (row: ReviewRow) => {
    const key = decisionKey(row);
    return <ReviewDecisionControls row={row} draft={decisions.edits[key] ?? draftForRow(row, decisions.saved[key])} disabled={!decisions.enabled} changed={supplierPriceChanged(row, decisions.saved[key]) && !decisions.edits[key]?.confirmed} conflict={decisions.conflicts.has(key)} onChange={(draft) => decisions.updateDraft(key, draft)} />;
  };
  const selectionBox = (row: ReviewRow) => <input type="checkbox" aria-label={`Select ${row.result.code} ${row.category}`} checked={selectedShownKeys.has(decisionKey(row))} disabled={!decisions.enabled || decisions.conflicts.has(decisionKey(row))} onChange={() => toggleSelected(decisionKey(row))} className="h-5 w-5 accent-emerald-800" />;
  const bulkSupplierUnavailable = shown.some((r) => selectedShownKeys.has(decisionKey(r)) && usableSupplierPrice(r) === null);
  const applyBulk = () => {
    if (!bulkAction || !decisions.enabled || (bulkAction === "use_supplier" && bulkSupplierUnavailable)) return;
    for (const key of selectedShownKeys) {
      const row = allRows.find((r) => decisionKey(r) === key); if (!row) continue;
      const draft = decisions.edits[key] ?? draftForRow(row, decisions.saved[key]);
      decisions.updateDraft(key, { ...draft, decision: bulkAction, customPrice: bulkAction === "set_custom" ? draft.customPrice : "", confirmed: true });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); if (confirmClose) setConfirmClose(false); else requestClose(); return; }
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
            <button type="button" disabled={!shown.length || (canManageDecisions && (decisions.loading || !!decisions.loadError))} onClick={() => downloadCsv(shown, fresh.output.source.title, decisions.saved, decisions.conflicts)} className="h-9 rounded-md border border-emerald-700 bg-white px-3 text-sm font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50">Export CSV</button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600" aria-live="polite">
            <span>Showing {shown.length} of {allRows.length} rows{reviewedHidden ? ` (${reviewedHidden} reviewed hidden)` : ""}</span>
            {canManageDecisions ? <><button type="button" aria-pressed={showReviewed} onClick={() => { setShowReviewed((current) => !current); setSelectedKeys(new Set()); backToTop(); }} className="min-h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm font-medium text-zinc-800">Show reviewed ({reviewedCount})</button>{reviewedHidden ? <span>{reviewedHidden} reviewed and hidden</span> : null}</> : null}
          </div>
          {canManageDecisions ? <>
            <div role="group" aria-label="Filter decisions" className="flex flex-wrap gap-2">
              {([["undecided", "Not decided"], ["decided", "Decided"], ["check_later", "Check later"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={decisionFilter === value} onClick={() => { setDecisionFilter(decisionFilter === value ? "" : value); backToTop(); }} className={`min-h-9 rounded-full border px-3 text-sm ${decisionFilter === value ? "border-emerald-800 bg-emerald-100" : "border-zinc-300 bg-white"}`}>{label}</button>)}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={eligibleKeys.length > 0 && eligibleKeys.every((k) => selectedShownKeys.has(k))} disabled={!decisions.enabled || !eligibleKeys.length} onChange={(e) => setSelectedKeys((current) => { const next = new Set([...current].filter((key) => eligibleKeys.includes(key))); eligibleKeys.forEach((k) => e.target.checked ? next.add(k) : next.delete(k)); return next; })} className="h-5 w-5 accent-emerald-800" />Select all shown</label>
              <span>Decided {shown.filter((r) => effectiveDecision(r)).length} of {shown.length} shown</span>
            </div>
            {selectedShownKeys.size ? <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm">
              <strong>{selectedShownKeys.size} selected</strong>
              <select aria-label="Bulk action" value={bulkAction} disabled={!decisions.enabled} onChange={(e) => setBulkAction(e.target.value as ReviewDecision | "")} className="h-10 rounded-md border border-zinc-300 bg-white px-2">
                <option value="">Choose an action</option>{(Object.keys(decisionLabels) as ReviewDecision[]).map((d) => <option key={d} value={d} disabled={d === "use_supplier" && bulkSupplierUnavailable}>{decisionLabels[d]}</option>)}
              </select>
              <button type="button" disabled={!bulkAction || !decisions.enabled || (bulkAction === "use_supplier" && bulkSupplierUnavailable)} onClick={applyBulk} className="min-h-10 rounded-md bg-emerald-800 px-3 font-semibold text-white disabled:opacity-50">Apply to selected</button>
              <button type="button" onClick={() => setSelectedKeys(new Set())} className="min-h-10 px-2 underline">Clear</button>
              {bulkAction === "set_custom" ? <p className="w-full text-xs">Enter your price on each selected row before saving.</p> : null}
            </div> : null}
            {decisions.unsavedCount ? <p className="text-xs text-zinc-600">CSV includes saved decisions. Save your changes to include them.</p> : null}
          </> : null}
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
          <button type="button" onClick={requestClose} disabled={decisions.saving} className="h-9 shrink-0 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 disabled:opacity-50">Close</button>
        </div>
        {canManageDecisions && fresh ? <ReviewSaveButton count={decisions.unsavedCount} disabled={!decisions.enabled} saving={decisions.saving} onSave={() => { void saveDecisions(); }} buttonRef={saveButtonRef} /> : null}
        {decisions.loading ? <p role="status" className="text-sm text-zinc-600">Loading saved decisions…</p> : null}
        {decisions.loadError ? <p role="alert" className="text-sm text-red-800">{decisions.loadError} <button type="button" onClick={decisions.retry} className="underline">Try again</button></p> : null}
        {decisions.message ? <p role="status" className="text-sm text-emerald-900">{decisions.message}</p> : null}
        {decisions.saveError ? <p role="alert" className="text-sm text-red-800">{decisions.saveError}</p> : null}
        {confirmClose ? <div role="alertdialog" aria-modal="true" aria-label="Unsaved decisions" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
          <p>You have {decisions.unsavedCount} unsaved change{decisions.unsavedCount === 1 ? "" : "s"}. Close and discard them?</p>
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => setConfirmClose(false)} className="min-h-10 rounded border border-zinc-400 bg-white px-3 font-semibold">Keep reviewing</button><button type="button" onClick={onClose} className="min-h-10 rounded border border-red-700 px-3 font-semibold text-red-800">Discard and close</button></div>
        </div> : null}
        {controls ? <div className="hidden space-y-3 sm:block">{controls}</div> : null}
      </header>
      {!fresh ? <div className="p-4 text-sm">
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">{stale ? "The draft or selection changed after the last check, so this result is out of date and is no longer shown. Close this window and run Check Supplier Prices again." : "There is no supplier price check to show. Close this window and run Check Supplier Prices first."}</p>
      </div> : <div ref={scrollRef} tabIndex={0} role="region" aria-label="Supplier price rows" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-auto">
        {/* On narrow screens the filters live in the scroll area so they scroll away; the table header stays sticky. */}
        <div className="space-y-3 border-b border-zinc-200 bg-zinc-50 p-3 sm:hidden">{controls}</div>
        {canManageDecisions ? <div className="grid divide-y divide-zinc-200 sm:grid-cols-2 xl:hidden">{shown.slice(first, last).map((row) => <article key={row.result.locator} className="space-y-2 p-3">
          <div className="flex items-start gap-3">{selectionBox(row)}<div className="min-w-0"><h3 className="break-words font-semibold">{row.model}</h3><p className="break-words text-sm text-zinc-600">{row.result.code} · {row.category}</p></div></div>
          <div className="grid grid-cols-2 gap-2 text-sm"><p>Imported <strong className="block">{importedPriceText(row.result)}</strong></p><p>Supplier <strong className="block">{referencePriceText(row.result)}</strong></p></div>
          <div className="flex flex-wrap gap-1"><span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${pillTone[row.result.status]}`}>{reviewStatusLabels[row.result.status]}</span>{reviewed(row) ? <ReviewedTag /> : null}</div>
          <p className="text-xs text-zinc-600">{reasonLabels[row.result.reason]}</p>
          <details open className="rounded-md border border-zinc-200 bg-zinc-50 px-2"><summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold">Action</summary>{actionControls(row)}</details>
        </article>)}</div> : null}
        <table className={`w-full border-collapse text-left text-sm ${canManageDecisions ? "hidden min-w-[1250px] xl:table" : "min-w-[960px]"}`}>
          <thead className="sticky top-0 z-10 bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 shadow-[0_1px_0_#d4d4d8]">
            <tr>{canManageDecisions ? <th scope="col" className="px-3 py-2">Select</th> : null}<th scope="col" className="px-3 py-2">Model / code</th><th scope="col" className="px-3 py-2">Price field / category</th><th scope="col" className="px-3 py-2 text-right">Imported price</th><th scope="col" className="px-3 py-2 text-right">Supplier price</th><th scope="col" className="px-3 py-2 text-right">Difference</th><th scope="col" className="px-3 py-2">Status</th>{canManageDecisions ? <th scope="col" className="px-3 py-2">Action</th> : null}<th scope="col" className="px-3 py-2">Reason / evidence</th></tr>
          </thead>
          <tbody>
            {windowed && first > 0 ? <tr aria-hidden="true" style={{ height: first * ROW_HEIGHT }}><td colSpan={7} className="p-0" /></tr> : null}
            {shown.slice(first, last).map((row) => <ReviewTableRow key={row.result.locator} row={row} reviewed={reviewed(row)} selection={canManageDecisions ? selectionBox(row) : undefined} action={canManageDecisions ? actionControls(row) : undefined} />)}
            {windowed && last < shown.length ? <tr aria-hidden="true" style={{ height: (shown.length - last) * ROW_HEIGHT }}><td colSpan={7} className="p-0" /></tr> : null}
          </tbody>
        </table>
        {!shown.length ? <p className="p-4 text-sm text-zinc-600">{reviewedHidden ? "All rows in this view are reviewed. Product prices have not changed." : allRows.length ? "No rows match the selected statuses and search." : "The check returned no rows."}</p> : null}
      </div>}
      {canManageDecisions && fresh ? <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
        <span>{allRows.filter((r) => effectiveDecision(r)).length} decided · {counts.MATCHED} matched · {counts.MISMATCH} mismatch · {counts.NOT_FOUND} not found · {counts.NEEDS_REVIEW} needs review</span>
      </footer> : null}
    </div>
  </div>;
}

function ReviewedTag() { return <span className="inline-block rounded-full border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">Reviewed</span>; }

export function ReviewTableRow({ row, reviewed, selection, action }: { row: ReviewRow; reviewed: boolean; selection?: React.ReactNode; action?: React.ReactNode }) {
  const { result: r, difference } = row;
  const evidence = evidenceText(r);
  const tone = !difference || difference.amount === 0 ? "text-zinc-700" : difference.amount > 0 ? "text-red-700" : "text-blue-700";
  const direction = !difference || difference.amount === 0 ? "" : difference.amount > 0 ? "Imported price is higher than the supplier price" : "Imported price is lower than the supplier price";
  return <tr style={{ height: ROW_HEIGHT }} className="border-b border-zinc-200 align-middle hover:bg-zinc-50">
    {selection ? <td className="px-3">{selection}</td> : null}
    <td className="max-w-72 px-3"><div className="line-clamp-2 font-semibold" title={row.model}>{row.model}</div><div className="truncate text-zinc-600" title={r.code}>{r.code}</div></td>
    <td className="max-w-56 px-3"><div className="line-clamp-2" title={row.category}>{row.category}</div>{r.role !== "main_product" ? <div className="truncate text-zinc-500">{r.role.replace(/_/g, " ")}</div> : null}</td>
    <td className="whitespace-nowrap px-3 text-right tabular-nums">{importedPriceText(r)}</td>
    <td className="whitespace-nowrap px-3 text-right tabular-nums">{referencePriceText(r)}</td>
    <td className={`whitespace-nowrap px-3 text-right tabular-nums font-semibold ${tone}`} title={direction || undefined}>{difference ? <>{amountFormat.format(difference.amount)}{difference.percent !== null ? <span className="block text-xs font-normal">{percentFormat.format(difference.percent)}%</span> : null}</> : <span className="font-normal text-zinc-400">—</span>}</td>
    <td className="px-3"><div className="flex flex-wrap gap-1"><span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${pillTone[r.status]}`}>{reviewStatusLabels[r.status]}</span>{reviewed ? <ReviewedTag /> : null}</div></td>
    {action ? <td className="w-60 px-3">{action}</td> : null}
    <td className="max-w-md px-3 text-zinc-700"><div className="line-clamp-2" title={reasonLabels[r.reason]}>{reasonLabels[r.reason]}</div>{evidence ? <div className="truncate text-xs text-zinc-500">{evidence}</div> : null}</td>
  </tr>;
}
