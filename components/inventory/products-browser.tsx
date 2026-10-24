import Link from "next/link";
import { ProductFilters } from "./product-filters";
import { ProductListView } from "./product-list-view";
import { formatInventoryNumber, hasInventoryFilters, inventoryProductsHref } from "@/lib/inventory/presentation";
import type { ProductUrlState } from "@/lib/inventory/presentation";
import type { InventoryBrand, InventoryCategoryNode, InventoryPage, InventoryProduct } from "@/lib/inventory/types";
import { AddItemButton } from './add-item-button';

export function ProductsBrowser({ result, state, brands, categories, baseHref = "/inventory/products", detailHrefPrefix, role }: { result: InventoryPage<InventoryProduct>; state: ProductUrlState; brands: InventoryBrand[]; categories: InventoryCategoryNode[]; baseHref?: string; detailHrefPrefix?: string; role?: string | null }) {
  const pages = Math.max(1, result.page_count), buttonClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50";
  return <div className="min-w-0 space-y-5">
    <AddItemButton role={role} />
    <ProductFilters state={state} brands={brands} categories={categories} baseHref={baseHref} />
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-zinc-950">Products</h2><p className="text-sm text-zinc-600">{formatInventoryNumber(result.total)} {result.total === 1 ? "product" : "products"}</p></div>
    <ProductListView products={result.items} filtered={hasInventoryFilters(state)} clearHref={baseHref} detailHrefPrefix={detailHrefPrefix} />
    <nav aria-label="Product pages" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-center text-sm text-zinc-600" aria-live="polite">Page {result.page} of {pages}</p>
      <div className="grid grid-cols-2 gap-3">
        {result.page > 1 ? <Link href={inventoryProductsHref(state, { page: result.page - 1 }, baseHref)} className={buttonClass}>Previous</Link> : <span aria-disabled="true" className={`${buttonClass} opacity-45`}>Previous</span>}
        {result.page < pages ? <Link href={inventoryProductsHref(state, { page: result.page + 1 }, baseHref)} className={buttonClass}>Next</Link> : <span aria-disabled="true" className={`${buttonClass} opacity-45`}>Next</span>}
      </div>
    </nav>
  </div>;
}
