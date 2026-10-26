import { deletedProductMessage } from "@/lib/inventory/delete-product";
import { canManageInventory } from "@/lib/inventory/access";
import { redirect } from "next/navigation";
import { ProductsBrowser } from "@/components/inventory/products-browser";
import { inventoryProductsHref, parseInventoryProductParams } from "@/lib/inventory/presentation";
import type { InventorySearchParams } from "@/lib/inventory/presentation";
import { getProductTypeCounts, listActiveBrands, listCategories, listProducts } from "@/lib/inventory/queries";
import { InventoryPageRangeError } from "@/lib/inventory/page-range-error";
import { requireInventoryUser } from '@/lib/auth';

export default async function InventoryProductsPage({ searchParams }: { searchParams: Promise<InventorySearchParams> }) {
  const { profile } = await requireInventoryUser();
  const params=await searchParams;
  const { state, filters, page } = parseInventoryProductParams(params);
  const cleanup=typeof params.photoCleanup==="string" && /^[1-9][0-9]{0,5}$/.test(params.photoCleanup) ? Number(params.photoCleanup) : 0;
  const deleted=canManageInventory(profile?.role) && params.deleted==="1";
  const products = listProducts(filters, page).catch(error => {
    if (page > 1 && error instanceof InventoryPageRangeError) redirect(inventoryProductsHref(state, { page: 1 }));
    throw error;
  });
  const [result, counts, brands, categories] = await Promise.all([products, getProductTypeCounts(filters), listActiveBrands(), listCategories()]);
  if (page > Math.max(1, result.page_count)) redirect(inventoryProductsHref(state, { page: Math.max(1, result.page_count) }));
  return <>{deleted && <p role="status" className={`mb-4 rounded-lg border p-3 text-sm ${cleanup ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{deletedProductMessage(cleanup)}</p>}<ProductsBrowser result={result} counts={counts} state={state} brands={brands} categories={categories} role={profile?.role ?? null} /></>;
}
