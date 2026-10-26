"use client";
import { brandOptions, brandFilterLabel } from "@/lib/inventory/brands";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { inventoryLabel, inventoryProductsHref, PRODUCT_SORT_LABELS } from "@/lib/inventory/presentation";
import type { ProductUrlState } from "@/lib/inventory/presentation";
import { ITEM_TYPES, LOCATION_LABELS, PRODUCT_STATUSES, STOCK_FILTER_LABELS } from "@/lib/inventory/types";
import type { InventoryBrand, InventoryCategoryNode } from "@/lib/inventory/types";
import { buttonClass, fieldClass, focusRing } from "./inventory-ui";
import { RequestDialog } from "./request-dialog";

const emptyLabels = { brand: "All brands", category: "All categories", subcategory: "All subcategories", status: "All statuses", itemType: "All item types", location: "All locations" };
function SearchField({ query, pending, onSearch }: { query: string; pending: boolean; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(query);
  return <form role="search" className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-zinc-300 bg-white pl-3 focus-within:border-emerald-800 focus-within:ring-2 focus-within:ring-emerald-900/10" onSubmit={event => { event.preventDefault(); onSearch(draft); }}>
    <label htmlFor="inventory-search" className="sr-only">Search products</label>
    <input id="inventory-search" type="search" inputMode="search" enterKeyHint="search" value={draft} maxLength={200} disabled={pending} placeholder="Search products" title="Search by name, code, stock ref or model"
      onChange={event => setDraft(event.target.value)} className="min-h-11 w-0 min-w-0 flex-1 bg-transparent text-base outline-none" />
    <button type="submit" disabled={pending} aria-label="Search" className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-emerald-900 hover:bg-emerald-50 disabled:opacity-60 ${focusRing}`}><Search size={18} aria-hidden="true" /></button>
  </form>;
}
export function ProductFilters({ state, brands, categories, baseHref = "/inventory/products" }: { state: ProductUrlState; brands: InventoryBrand[]; categories: InventoryCategoryNode[]; baseHref?: string }) {
  const router = useRouter(), [pending, startTransition] = useTransition(), [sheet, setSheet] = useState(false);
  const change = (patch: Partial<ProductUrlState>) => startTransition(() => router.push(inventoryProductsHref(state, { ...patch, page: 1 }, baseHref), { scroll: false }));
  const children = categories.flatMap(parent => parent.children);
  const subcategories = state.category ? categories.find(parent => parent.id === state.category)?.children ?? [] : children;
  const chips: { key: keyof ProductUrlState; label: string; patch: Partial<ProductUrlState> }[] = [];
  if (state.q) chips.push({ key: "q", label: `Search: ${state.q}`, patch: { q: "" } });
  if (state.brand) chips.push({ key: "brand", label: `Brand: ${brandFilterLabel(state.brand, brands)}`, patch: { brand: "" } });
  if (state.category) chips.push({ key: "category", label: `Category: ${categories.find(row => row.id === state.category)?.name ?? "Selected category"}`, patch: { category: "", subcategory: "" } });
  if (state.subcategory) chips.push({ key: "subcategory", label: `Subcategory: ${children.find(row => row.id === state.subcategory)?.name ?? "Selected subcategory"}`, patch: { subcategory: "" } });
  if (state.status) chips.push({ key: "status", label: `Status: ${inventoryLabel(state.status)}`, patch: { status: "" } });
  if (state.itemType) chips.push({ key: "itemType", label: `Type: ${inventoryLabel(state.itemType)}`, patch: { itemType: "" } });
  if (state.location) chips.push({ key: "location", label: `Location: ${LOCATION_LABELS[state.location as keyof typeof LOCATION_LABELS]}`, patch: { location: "" } });
  if (state.stock) chips.push({ key: "stock", label: STOCK_FILTER_LABELS[state.stock as keyof typeof STOCK_FILTER_LABELS], patch: { stock: "" } });
  const sheetCount = chips.filter(chip => chip.key !== "q").length;
  const choices = [
    { key: "brand", label: "Brand", options: brandOptions(brands) },
    { key: "category", label: "Category", options: categories.map(row => [row.id, row.name]) },
    { key: "subcategory", label: "Subcategory", options: subcategories.map(row => [row.id, row.name]) },
    { key: "status", label: "Status", options: PRODUCT_STATUSES.map(value => [value, inventoryLabel(value)]) },
    { key: "itemType", label: "Item type", options: ITEM_TYPES.map(value => [value, inventoryLabel(value)]) },
    { key: "location", label: "Location with stock", options: Object.entries(LOCATION_LABELS) },
  ] as const;
  return <section aria-label="Find inventory products" aria-busy={pending} className="min-w-0 space-y-2">
    <div className="flex min-w-0 items-center gap-2">
      <SearchField key={state.q} query={state.q} pending={pending} onSearch={q => change({ q: q.trim() })} />
      <button type="button" onClick={() => setSheet(true)} className={`${buttonClass.secondary} shrink-0 px-3`} aria-haspopup="dialog"><SlidersHorizontal size={18} aria-hidden="true" />Filters{sheetCount ? <span className="rounded-full bg-emerald-900 px-2 text-sm text-white">{sheetCount}</span> : null}</button>
    </div>
    {chips.length ? <div aria-label="Active filters" className="flex min-w-0 flex-wrap items-center gap-2">
      {chips.map(chip => <Link key={chip.key} href={inventoryProductsHref(state, { ...chip.patch, page: 1 }, baseHref)} scroll={false} aria-label={`Remove ${chip.label}`} className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 ${focusRing}`}><span className="min-w-0 break-words [overflow-wrap:anywhere]">{chip.label}</span><X size={14} aria-hidden="true" className="shrink-0" /></Link>)}
      <Link href={baseHref} className={`inline-flex min-h-11 items-center px-2 text-sm font-semibold text-zinc-800 underline underline-offset-4 ${focusRing}`}>Clear filters</Link>
    </div> : null}
    <p role="status" className="sr-only">{pending ? "Updating products…" : "Products up to date"}</p>
    {sheet ? <RequestDialog title="Filters and sort" onClose={() => setSheet(false)}>
      <div className="min-w-0 space-y-4">
        <p className="text-sm text-zinc-600">Results update as you choose. Search covers name, code, stock ref and model.</p>
        {choices.map(({ key, label, options }) => <label key={key} htmlFor={`inventory-${key}`} className="block min-w-0 text-sm font-medium text-zinc-800">{label}
          <select id={`inventory-${key}`} value={state[key]} disabled={pending} onChange={event => change(key === "category" ? { category: event.target.value, subcategory: "" } : { [key]: event.target.value })} className={fieldClass}>
            <option value="">{emptyLabels[key]}</option>
            {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
        </label>)}
        <label htmlFor="inventory-sort" className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium text-zinc-800">Sort by
          <select id="inventory-sort" value={state.sort} disabled={pending} onChange={event => change({ sort: event.target.value as ProductUrlState["sort"] })} className={`${fieldClass} mt-0 w-auto min-w-0 flex-1`}>
            {Object.entries(PRODUCT_SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Link href={baseHref} onClick={() => setSheet(false)} className={buttonClass.secondary}>Clear filters</Link>
          <button type="button" onClick={() => setSheet(false)} className={buttonClass.primary}>Show results</button>
        </div>
      </div>
    </RequestDialog> : null}
  </section>;
}
