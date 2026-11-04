"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { useProductManagementFilters } from "@/components/products/product-management-template-results";
import { toolbarControl, toolbarPrimaryButton, toolbarSecondaryButton } from "@/components/products/product-toolbar-styles";

type ProductManagementFilterBarProps = {
  addBrandHref: string;
  addTemplateHref: string;
  brandOptions: Array<{ id: string; name: string }>;
  markVisibleAction: (formData: FormData) => void | Promise<void>;
};

// Small count chips. They only show numbers; the Price status dropdown is the filter.
const chipClassName = "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold";

// Instant filter toolbar: every control reads/writes the shared filters, so the grid below updates while typing (no server round trip).
export function ProductManagementFilterBar({ addBrandHref, addTemplateHref, brandOptions, markVisibleAction }: ProductManagementFilterBarProps) {
  const context = useProductManagementFilters();
  if (!context) return null;
  const { filteredRows, filters, mainOptions, resetFilters, setBrand, setMain, setPriceStatus, setSearch, setSub, subOptions, summary } = context;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            aria-label="Search products"
            name="q"
            value={filters.q}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search all products, codes, brands, categories..."
            className={`${toolbarControl} w-full pl-9 pr-3`}
          />
        </div>
        <select aria-label="Brand" name="brand" value={filters.brand} onChange={(event) => setBrand(event.target.value)} className={toolbarControl}>
          <option value="">All brands</option>
          {brandOptions.map((brand) => (
            <option key={brand.id} value={brand.id}>{brand.name}</option>
          ))}
        </select>
        <select aria-label="Main category" name="main" value={filters.main} onChange={(event) => setMain(event.target.value)} className={toolbarControl}>
          <option value="">All main categories</option>
          {mainOptions.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <select aria-label="Sub category" name="sub" value={filters.sub} onChange={(event) => setSub(event.target.value)} className={toolbarControl}>
          <option value="">All sub categories</option>
          {subOptions.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <select aria-label="Price status" name="priceStatus" value={filters.priceStatus} onChange={(event) => setPriceStatus(event.target.value)} className={toolbarControl}>
          <option value="">All price statuses</option>
          <option value="current">Price current</option>
          <option value="needs_check">Needs price check</option>
          <option value="due">Price check due</option>
          <option value="no_price_list_date">No price list date</option>
          <option value="scheduled">New price list scheduled</option>
          <option value="checked">Price checked</option>
        </select>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {filteredRows.length ? (
            <form action={markVisibleAction}>
              {filteredRows.map((row) => (
                <input key={row.id} type="hidden" name="template_id[]" value={row.id} />
              ))}
              <ConfirmSubmitButton
                message="Mark all visible templates as price checked now?"
                className={`${toolbarSecondaryButton} border-emerald-200 text-emerald-900 hover:border-emerald-700`}
                pendingLabel="Marking checked..."
              >
                Mark visible templates checked now
              </ConfirmSubmitButton>
            </form>
          ) : null}
          <button type="button" onClick={resetFilters} className={toolbarSecondaryButton}>
            Reset filters
          </button>
          <Link href={addBrandHref} className={toolbarSecondaryButton}>
            + Add Brand
          </Link>
          <Link href={addTemplateHref} className={toolbarPrimaryButton}>
            + Add Product Template
          </Link>
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-2" aria-label="Price status counts">
        <li className={`${chipClassName} border-zinc-200 bg-zinc-50 text-zinc-700`}>Total <span className="tabular-nums">{summary.total}</span></li>
        <li className={`${chipClassName} border-emerald-200 bg-emerald-50 text-emerald-900`}>Current <span className="tabular-nums">{summary.current}</span></li>
        <li className={`${chipClassName} border-orange-200 bg-orange-50 text-orange-900`}>Needs check <span className="tabular-nums">{summary.needs_check}</span></li>
        <li className={`${chipClassName} border-amber-200 bg-amber-50 text-amber-900`}>Due <span className="tabular-nums">{summary.due}</span></li>
        <li className={`${chipClassName} border-zinc-200 bg-zinc-50 text-zinc-700`}>No price list date <span className="tabular-nums">{summary.no_price_list_date}</span></li>
        {summary.scheduled > 0 ? <li className={`${chipClassName} border-sky-200 bg-sky-50 text-sky-900`}>Scheduled <span className="tabular-nums">{summary.scheduled}</span></li> : null}
      </ul>
    </div>
  );
}
