import { redirect } from "next/navigation";
import { ProductsBrowser } from "@/components/inventory/products-browser";
import { inventoryProductsHref, parseInventoryProductParams } from "@/lib/inventory/presentation";
import type { InventorySearchParams } from "@/lib/inventory/presentation";
import { getProductTypeCounts, listActiveBrands, listCategories, listProducts } from "@/lib/inventory/queries";
import { InventoryPageRangeError } from "@/lib/inventory/page-range-error";
import { requireInventoryUser } from '@/lib/auth';

export default async function InventoryProductsPage({ searchParams }: { searchParams: Promise<InventorySearchParams> }) {
  const { profile } = await requireInventoryUser();
  const { state, filters, page } = parseInventoryProductParams(await searchParams);
  const products = listProducts(filters, page).catch(error => {
    if (page > 1 && error instanceof InventoryPageRangeError) redirect(inventoryProductsHref(state, { page: 1 }));
    throw error;
  });
  const [result, counts, brands, categories] = await Promise.all([products, getProductTypeCounts(filters), listActiveBrands(), listCategories()]);
  if (page > Math.max(1, result.page_count)) redirect(inventoryProductsHref(state, { page: Math.max(1, result.page_count) }));
  return <ProductsBrowser result={result} counts={counts} state={state} brands={brands} categories={categories} role={profile?.role ?? null} />;
}
