"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { inventoryLabel, inventoryProductsHref, PRODUCT_SORT_LABELS } from "@/lib/inventory/presentation";
import type { ProductUrlState } from "@/lib/inventory/presentation";
import { ITEM_TYPES, LOCATION_LABELS, PRODUCT_STATUSES, STOCK_FILTER_LABELS } from "@/lib/inventory/types";
import type { InventoryBrand, InventoryCategoryNode } from "@/lib/inventory/types";

const selectClass = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-base text-zinc-800 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const emptyLabels = { brand: "All brands", category: "All categories", subcategory: "All subcategories", status: "All statuses", itemType: "All item types", location: "All locations" };
function SearchField({ query, pending, onSearch }: { query: string; pending: boolean; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(query);
  return <div>
    <label htmlFor="inventory-search" className="text-sm font-semibold text-zinc-700">Search products</label>
    <div className="mt-1 flex min-w-0 gap-2">
      <input id="inventory-search" type="search" value={draft} maxLength={200} disabled={pending} placeholder="Name, code, stock ref or model"
        onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onSearch(draft); } }}
        className="min-h-11 w-0 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-base outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10" />
      <button type="button" disabled={pending} onClick={() => onSearch(draft)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"><Search size={16} aria-hidden="true" />Search</button>
    </div>
  </div>;
}
export function ProductFilters({ state, brands, categories, baseHref = "/inventory/products" }: { state: ProductUrlState; brands: InventoryBrand[]; categories: InventoryCategoryNode[]; baseHref?: string }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const change = (patch: Partial<ProductUrlState>) => startTransition(() => router.push(inventoryProductsHref(state, { ...patch, page: 1 }, baseHref), { scroll: false }));
  const children = categories.flatMap(parent => parent.children);
  const subcategories = state.category ? categories.find(parent => parent.id === state.category)?.children ?? [] : children;
  const chips: { key: keyof ProductUrlState; label: string; patch: Partial<ProductUrlState> }[] = [];
  if (state.q) chips.push({ key: "q", label: `Search: ${state.q}`, patch: { q: "" } });
  if (state.brand) chips.push({ key: "brand", label: `Brand: ${brands.find(row => row.id === state.brand)?.name ?? "Selected brand"}`, patch: { brand: "" } });
  if (state.category) chips.push({ key: "category", label: `Category: ${categories.find(row => row.id === state.category)?.name ?? "Selected category"}`, patch: { category: "", subcategory: "" } });
  if (state.subcategory) chips.push({ key: "subcategory", label: `Subcategory: ${children.find(row => row.id === state.subcategory)?.name ?? "Selected subcategory"}`, patch: { subcategory: "" } });
  if (state.status) chips.push({ key: "status", label: `Status: ${inventoryLabel(state.status)}`, patch: { status: "" } });
  if (state.itemType) chips.push({ key: "itemType", label: `Type: ${inventoryLabel(state.itemType)}`, patch: { itemType: "" } });
  if (state.location) chips.push({ key: "location", label: `Location: ${LOCATION_LABELS[state.location as keyof typeof LOCATION_LABELS]}`, patch: { location: "" } });
  if (state.stock) chips.push({ key: "stock", label: STOCK_FILTER_LABELS[state.stock as keyof typeof STOCK_FILTER_LABELS], patch: { stock: "" } });
  const choices = [
    { key: "brand", label: "Brand", options: brands.map(row => [row.id, row.name]) },
    { key: "category", label: "Category", options: categories.map(row => [row.id, row.name]) },
    { key: "subcategory", label: "Subcategory", options: subcategories.map(row => [row.id, row.name]) },
    { key: "status", label: "Status", options: PRODUCT_STATUSES.map(value => [value, inventoryLabel(value)]) },
    { key: "itemType", label: "Item type", options: ITEM_TYPES.map(value => [value, inventoryLabel(value)]) },
    { key: "location", label: "Location with stock", options: Object.entries(LOCATION_LABELS) },
  ] as const;
  return <section aria-label="Find inventory products" aria-busy={pending} className="min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
    <SearchField key={state.q} query={state.q} pending={pending} onSearch={q => change({ q: q.trim() })} />
    <details className="rounded-md border border-zinc-200">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-zinc-800">Filters{chips.length ? ` (${chips.length})` : ""}<ChevronDown size={18} aria-hidden="true" /></summary>
      <div className="grid min-w-0 gap-4 border-t border-zinc-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {choices.map(({ key, label, options }) => <label key={key} htmlFor={`inventory-${key}`} className="min-w-0 text-sm font-medium text-zinc-700">{label}
          <select id={`inventory-${key}`} value={state[key]} disabled={pending} onChange={event => change(key === "category" ? { category: event.target.value, subcategory: "" } : { [key]: event.target.value })} className={selectClass}>
            <option value="">{emptyLabels[key]}</option>
            {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
        </label>)}
      </div>
    </details>
    <label htmlFor="inventory-sort" className="block text-sm font-medium text-zinc-700">Sort by
      <select id="inventory-sort" value={state.sort} disabled={pending} onChange={event => change({ sort: event.target.value as ProductUrlState["sort"] })} className={selectClass}>
        {Object.entries(PRODUCT_SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {chips.length ? <div aria-label="Active filters" className="flex min-w-0 flex-wrap gap-2">
      {chips.map(chip => <Link key={chip.key} href={inventoryProductsHref(state, { ...chip.patch, page: 1 }, baseHref)} scroll={false} aria-label={`Remove ${chip.label}`} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900"><span className="min-w-0 break-words [overflow-wrap:anywhere]">{chip.label}</span><X size={15} className="shrink-0" aria-hidden="true" /></Link>)}
      <Link href={baseHref} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-zinc-700 underline">Clear filters</Link>
    </div> : null}
    <p role="status" className="sr-only">{pending ? "Updating products…" : "Products up to date"}</p>
  </section>;
}
