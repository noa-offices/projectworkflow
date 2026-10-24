import { ProductFilters } from "./product-filters";
import { ProductListView } from "./product-list-view";
import { formatInventoryNumber, hasInventoryFilters, inventoryProductsHref } from "@/lib/inventory/presentation";
import type { ProductUrlState } from "@/lib/inventory/presentation";
import type { InventoryBrand, InventoryCategoryNode, InventoryPage, InventoryProduct } from "@/lib/inventory/types";
import { InventoryActions } from "./inventory-actions";
import { Pager } from "./inventory-ui";
import { ProductTypeTabs } from './product-type-tabs';
import type { ProductTypeCounts } from '@/lib/inventory/types';

export function ProductsBrowser({ result, counts, state, brands, categories, baseHref = "/inventory/products", detailHrefPrefix, role, moveHref, categoriesHref, reportsHref }: { moveHref?: string; categoriesHref?: string; reportsHref?: string; result: InventoryPage<InventoryProduct>; counts: ProductTypeCounts; state: ProductUrlState; brands: InventoryBrand[]; categories: InventoryCategoryNode[]; baseHref?: string; detailHrefPrefix?: string; role?: string | null }) {
  const pages = Math.max(1, result.page_count);
  return <div className="min-w-0 space-y-3">
    <InventoryActions role={role} moveHref={moveHref} categoriesHref={categoriesHref} reportsHref={reportsHref} />
    <ProductTypeTabs state={state} counts={counts} baseHref={baseHref} />
    <ProductFilters state={state} brands={brands} categories={categories} baseHref={baseHref} />
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-zinc-950">Products</h2><p className="text-sm text-zinc-600">{formatInventoryNumber(result.total)} {result.total === 1 ? "product" : "products"}</p></div>
    <ProductListView products={result.items} filtered={hasInventoryFilters(state)} clearHref={baseHref} detailHrefPrefix={detailHrefPrefix} />
    {pages > 1 ? <Pager label="Product pages" page={result.page} pageCount={pages} previousHref={result.page > 1 ? inventoryProductsHref(state, { page: result.page - 1 }, baseHref) : null} nextHref={result.page < pages ? inventoryProductsHref(state, { page: result.page + 1 }, baseHref) : null} /> : null}
  </div>;
}
