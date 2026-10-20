"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { useProductManagementFilters } from "@/components/products/product-management-template-results";

type ProductManagementFilterBarProps = {
  addBrandHref: string;
  addTemplateHref: string;
  brandOptions: Array<{ id: string; name: string }>;
  markVisibleAction: (formData: FormData) => void | Promise<void>;
};

const selectClassName = "h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const chipClassName = "rounded-full border px-3 py-1 text-xs font-semibold";

// Instant filter card: every control reads/writes the shared filters, so the grid below updates while typing (no server round trip).
export function ProductManagementFilterBar({ addBrandHref, addTemplateHref, brandOptions, markVisibleAction }: ProductManagementFilterBarProps) {
  const context = useProductManagementFilters();
  if (!context) return null;
  const { filteredRows, filters, mainOptions, resetFilters, setBrand, setMain, setPriceStatus, setSearch, setSub, subOptions, summary } = context;

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          aria-label="Search products"
          name="q"
          value={filters.q}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search all products, codes, brands, categories..."
          className="h-11 w-full rounded-lg border border-zinc-200 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <select aria-label="Brand" name="brand" value={filters.brand} onChange={(event) => setBrand(event.target.value)} className={selectClassName}>
          <option value="">All brands</option>
          {brandOptions.map((brand) => (
            <option key={brand.id} value={brand.id}>{brand.name}</option>
          ))}
        </select>
        <select aria-label="Main category" name="main" value={filters.main} onChange={(event) => setMain(event.target.value)} className={selectClassName}>
          <option value="">All main categories</option>
          {mainOptions.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <select aria-label="Sub category" name="sub" value={filters.sub} onChange={(event) => setSub(event.target.value)} className={selectClassName}>
          <option value="">All sub categories</option>
          {subOptions.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <select aria-label="Price status" name="priceStatus" value={filters.priceStatus} onChange={(event) => setPriceStatus(event.target.value)} className={selectClassName}>
          <option value="">All price statuses</option>
          <option value="current">Price current</option>
          <option value="needs_check">Needs price check</option>
          <option value="due">Price check due</option>
          <option value="no_price_list_date">No price list date</option>
          <option value="scheduled">New price list scheduled</option>
          <option value="checked">Price checked</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <span className={`${chipClassName} border-zinc-200 bg-zinc-50 text-zinc-700`}>Total: {summary.total}</span>
          <span className={`${chipClassName} border-emerald-200 bg-emerald-50 text-emerald-900`}>Current: {summary.current}</span>
          <span className={`${chipClassName} border-orange-200 bg-orange-50 text-orange-900`}>Needs check: {summary.needs_check}</span>
          <span className={`${chipClassName} border-amber-200 bg-amber-50 text-amber-900`}>Due: {summary.due}</span>
          <span className={`${chipClassName} border-zinc-200 bg-zinc-50 text-zinc-700`}>No price list date: {summary.no_price_list_date}</span>
          {summary.scheduled > 0 ? <span className={`${chipClassName} border-sky-200 bg-sky-50 text-sky-900`}>Scheduled: {summary.scheduled}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filteredRows.length ? (
            <form action={markVisibleAction}>
              {filteredRows.map((row) => (
                <input key={row.id} type="hidden" name="template_id[]" value={row.id} />
              ))}
              <ConfirmSubmitButton
                message="Mark all visible templates as price checked now?"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-emerald-200 bg-white px-4 text-sm font-semibold text-emerald-900 transition hover:border-emerald-700"
                pendingLabel="Marking checked..."
              >
                Mark visible templates checked now
              </ConfirmSubmitButton>
            </form>
          ) : null}
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Reset filters
          </button>
          <Link
            href={addBrandHref}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            + Add Brand
          </Link>
          <Link
            href={addTemplateHref}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            + Add Product Template
          </Link>
        </div>
      </div>
    </div>
  );
}
