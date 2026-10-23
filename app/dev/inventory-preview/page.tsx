import Link from "next/link";
import { notFound } from "next/navigation";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { InventoryOverviewView } from "@/components/inventory/overview-view";
import { ProductsBrowser } from "@/components/inventory/products-browser";
import { ProductDetailView } from "@/components/inventory/product-detail-view";
import { redirectWarehouseStaff } from "@/lib/auth";
import { parseInventoryProductParams } from "@/lib/inventory/presentation";
import type { InventorySearchParams } from "@/lib/inventory/presentation";
import { previewBrands, previewCategories, previewOverview, previewProduct, previewProducts } from "@/lib/inventory/preview-data";
import { LOCATION_QUANTITY_COLUMNS } from "@/lib/inventory/types";

export const dynamic = "force-dynamic";
export default async function InventoryPreviewPage({ searchParams }: { searchParams: Promise<InventorySearchParams> }) {
  await redirectWarehouseStaff();
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams, first = (key: string) => Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  const view = first("view") === "products" ? "products" : first("view") === "detail" ? "detail" : "overview";
  if (first("frame") !== "1") return <main className="min-w-0 bg-zinc-100 p-4">
    <div className="mx-auto mb-5 max-w-4xl rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">Development preview · sample data</p><h1 className="mt-2 text-xl font-semibold text-zinc-950">Inventory on a phone</h1><p className="mt-2 text-sm text-zinc-700">Read-only samples in a 390 px frame.</p><nav aria-label="Preview screens" className="mt-3 flex flex-wrap gap-2">{["overview", "products", "detail"].map(screen => <Link key={screen} href={`/dev/inventory-preview?view=${screen}`} className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${view === screen ? "border-emerald-900 bg-emerald-900 text-white" : "border-zinc-200 bg-white text-zinc-700"}`}>{screen === "detail" ? "Product detail" : screen[0].toUpperCase() + screen.slice(1)}</Link>)}</nav></div>
    <iframe title={`Phone inventory ${view} preview`} src={`/dev/inventory-preview?view=${view}&frame=1`} className="mx-auto block h-[1900px] w-full max-w-[390px] rounded-lg border border-zinc-200 bg-white shadow-sm" />
  </main>;
  const { state, filters } = parseInventoryProductParams(params);
  const products = previewProducts.filter(product => (!filters.search || [product.item_name, product.item_code, product.stock_ref, product.model_name].some(value => value.toLowerCase().includes(filters.search!.toLowerCase())))
    && (!filters.brand_id || product.brand_id === filters.brand_id) && (!filters.category_id || product.category_id === filters.category_id)
    && (!filters.subcategory_id || product.subcategory_id === filters.subcategory_id) && (!filters.status || product.status === filters.status)
    && (!filters.item_type || product.item_type === filters.item_type) && (!filters.location || product[LOCATION_QUANTITY_COLUMNS[filters.location]] > 0));
  products.sort((a, b) => state.sort === "quantity_asc" ? a.quantity - b.quantity : state.sort === "quantity_desc" ? b.quantity - a.quantity : state.sort === "newest" ? b.created_at.localeCompare(a.created_at) : state.sort === "oldest" ? a.created_at.localeCompare(b.created_at) : state.sort === "name_desc" ? b.item_name.localeCompare(a.item_name) : a.item_name.localeCompare(b.item_name));
  const selected = previewProducts.find(product => product.id === first("id")) ?? previewProduct;
  const product = { ...previewProduct, ...selected, images: selected.main_image_url ? previewProduct.images : [], ...(first("removed") === "1" ? { is_active: false, removal_reason: "This display model has been retired." } : {}) };
  if (first("costs") === "off") delete product.costs;
  return <ErpAppShell title="Inventory" description="Stock, products and warehouse inventory." role="warehouse_staff" userRole="warehouse_staff">
    <div className="mx-auto min-w-0 max-w-7xl p-4 lg:p-8"><InventoryNav active={view === "overview" ? "overview" : "products"} preview />
      {view === "overview" ? <InventoryOverviewView overview={previewOverview} productsHref="/dev/inventory-preview?view=products&frame=1" /> : view === "products" ? <ProductsBrowser state={{ ...state, page: 1 }} result={{ items: products, total: products.length, page: 1, page_count: products.length ? 1 : 0, page_size: 24 }} brands={previewBrands} categories={previewCategories} baseHref="/dev/inventory-preview?view=products&frame=1" detailHrefPrefix="/dev/inventory-preview?view=detail&frame=1&id=" /> : <ProductDetailView product={product} productsHref="/dev/inventory-preview?view=products&frame=1" />}
    </div>
  </ErpAppShell>;
}
