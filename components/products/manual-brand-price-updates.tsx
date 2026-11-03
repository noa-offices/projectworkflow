"use client";

import { useMemo, useState } from "react";
import { ManualPriceLinesButton } from "@/components/quotations/manual-price-lines-button";
import { filterManualRows, manualBadgeClass, manualCategories, manualProgressText, manualStatusCounts, manualStatusFromLabel, sortManualRows, type ManualProductRow, type ManualStatusFilter } from "@/lib/products/manual-brand-products";
import { ManualPriceCheckPanel, type ManualReleaseRow } from "./manual-price-check-panel";

const dateText = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const field = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800";
const statusOptions: Array<{ value: ManualStatusFilter; label: string }> = [{ value: "all", label: "All" }, { value: "due", label: "Due" }, { value: "checked", label: "Checked" }, { value: "edited", label: "Edited since check" }];

/**
 * Price Updates screen of a manual price check Brand: the release panel, the progress line and the product table.
 * "Update prices" opens the same grid window as the Product Library; its result updates the row and the counts in place.
 */
export function ManualBrandPriceUpdates({ brandId, brandName, initialRows, releases, latest, canManage, today, truncated, limit }: {
  brandId: string; brandName: string; initialRows: ManualProductRow[]; releases: ManualReleaseRow[]; latest: { effectiveFrom: string; note: string } | null; canManage: boolean; today: string; truncated: boolean; limit: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [category, setCategory] = useState(""), [status, setStatus] = useState<ManualStatusFilter>("all"), [search, setSearch] = useState("");
  const counts = useMemo(() => manualStatusCounts(rows), [rows]);
  const shown = useMemo(() => sortManualRows(filterManualRows(rows, { category, status, search })), [rows, category, status, search]);
  const categories = useMemo(() => manualCategories(rows), [rows]);
  const onStatus = (templateId: string, presentation: { label: string; tone: ManualProductRow["tone"]; detail: string } | null) => {
    const key = presentation ? manualStatusFromLabel(presentation.label) : null;
    if (!presentation || !key) return;
    setRows((current) => current.map((row) => row.id === templateId ? { ...row, status: key, label: presentation.label, tone: presentation.tone, detail: presentation.detail } : row));
  };
  return <div className="space-y-4">
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" aria-label="Manual price check">
      <h2 className="text-base font-semibold text-zinc-950">Manual price check</h2>
      <p className="mt-1 text-sm text-zinc-700">{latest ? `Latest: price list released ${dateText(latest.effectiveFrom)}${latest.note ? ` - ${latest.note}` : ""}` : "No price list released yet. Click New price list released."}</p>
      <div className="mt-2"><ManualPriceCheckPanel brandId={brandId} brandName={brandName} manual releases={releases} canManage={canManage} today={today} /></div>
      <p className="mt-3 text-sm font-semibold text-zinc-900" data-testid="manual-progress">{manualProgressText(counts, Boolean(latest))}</p>
    </section>
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold text-zinc-700">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className={field}><option value="">All categories</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold text-zinc-700">Status<select value={status} onChange={(event) => setStatus(event.target.value as ManualStatusFilter)} className={field}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold text-zinc-700">Product name<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className={`${field} w-56`} /></label>
        <p className="pb-2 text-xs text-zinc-500">{shown.length} of {rows.length} products</p>
      </div>
      {truncated ? <p className="mt-2 text-xs text-amber-800">Only the first {limit} products are shown.</p> : null}
      <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-zinc-100 text-xs font-semibold text-zinc-700"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Prices</th></tr></thead>
          <tbody>
            {shown.length === 0 ? <tr><td colSpan={4} className="px-3 py-4 text-sm text-zinc-600">No products match.</td></tr> : shown.map((row) => <tr key={row.id} className="border-t border-zinc-100 align-top">
              <td className="px-3 py-2 font-semibold text-zinc-900">{row.name}</td>
              <td className="px-3 py-2 text-zinc-600">{row.category || "—"}</td>
              <td className="px-3 py-2"><span className={manualBadgeClass(row.tone)}>{row.label}</span>{row.detail ? <span className="mt-1 block text-xs text-zinc-500">{row.detail}</span> : null}</td>
              <td className="px-3 py-2 [&_button]:mt-0"><ManualPriceLinesButton templateId={row.id} templateName={row.name} onSupplierStatus={onStatus} /></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
