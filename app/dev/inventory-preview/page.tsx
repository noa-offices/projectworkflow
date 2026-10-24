import Link from "next/link";
import { notFound } from "next/navigation";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { InventorySkeleton } from "@/components/inventory/inventory-skeleton";
import { Banner } from "@/components/inventory/inventory-ui";
import { ErrorState } from "@/components/inventory/inventory-ui-client";
import { NETWORK_MESSAGE } from "@/lib/inventory/save-errors";
import { ReportsView } from "@/components/inventory/reports-view";
import { CardComparison } from "@/components/inventory/card-comparison";
import { InventoryFrame } from "@/components/inventory/inventory-frame";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { InventoryOverviewView } from "@/components/inventory/overview-view";
import { ProductsBrowser } from "@/components/inventory/products-browser";
import { ProductDetailView } from "@/components/inventory/product-detail-view";
import { ProductRequestActions } from "@/components/inventory/movement-request-form";
import { ProductRequestForm } from "@/components/inventory/product-request-form";
import { ProductEditForm } from "@/components/inventory/product-edit-form";
import { ProductPhotoManager } from "@/components/inventory/product-photo-manager";
import { MoveStockForm } from "@/components/inventory/move-stock-form";
import { MovementsView } from "@/components/inventory/movements-view";
import { CategoryManager } from "@/components/inventory/category-manager";
import { parseMovementParams } from "@/lib/inventory/movement-history";
import { RequestsView } from "@/components/inventory/requests-view";
import { redirectWarehouseStaff } from "@/lib/auth";
import { parseInventoryProductParams } from "@/lib/inventory/presentation";
import type { InventorySearchParams } from "@/lib/inventory/presentation";
import { previewCategoryOverview, previewMovementHistory, previewPickerProducts, previewBrands, previewCategories, previewOverview, previewProduct, previewProducts } from "@/lib/inventory/preview-data";
import type { ProductTypeCounts } from "@/lib/inventory/types";
import { LOCATION_QUANTITY_COLUMNS } from "@/lib/inventory/types";
import { parseRequestParams } from "@/lib/inventory/request-presentation";
import { canManageInventory, canViewInventory } from "@/lib/inventory/access";
import { previewMovementRequests, previewProductRequests, previewRequestUserId } from "@/lib/inventory/request-preview-data";

const stockMatches = (product: typeof previewProducts[number], stock?: string) => !stock || (stock === "live" ? product.quantity > 0 : product.reserved_quantity > 0);
export const dynamic = "force-dynamic";
export default async function InventoryPreviewPage({ searchParams }: { searchParams: Promise<InventorySearchParams> }) {
  await redirectWarehouseStaff();
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams, first = (key: string) => Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  const view = ['overview','products','detail','new-product','take-move','hold-book','requests','edit','photos','remove','move','movements','categories','states','cards','reports'].includes(first('view') ?? '') ? first('view')! : 'overview';
  const role = canViewInventory(first('role')) ? first('role')! : 'warehouse_staff';
  const frameQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) frameQuery.append(key, entry);
  }
  frameQuery.set('view', view); frameQuery.set('frame', '1'); frameQuery.set('role', role);
  if (first("frame") !== "1") return <main className="min-w-0 bg-zinc-100 p-4">
    <div className="mx-auto mb-5 max-w-4xl rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">Development preview · sample data</p><h1 className="mt-2 text-xl font-semibold text-zinc-950">Inventory on a phone</h1><p className="mt-2 text-sm text-zinc-700">Sample screens in a 390 px frame. Forms simulate success; nothing is saved.</p><nav aria-label="Preview screens" className="mt-3 flex flex-wrap gap-2">{['overview','products','detail','new-product','take-move','hold-book','requests'].map(screen => <Link key={screen} href={`/dev/inventory-preview?view=${screen}&role=${role}`} className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${view === screen ? "border-emerald-900 bg-emerald-900 text-white" : "border-zinc-200 bg-white text-zinc-700"}`}>{screen === 'new-product' ? 'Add-item form' : screen === 'hold-book' ? 'Hold / Book' : screen === 'take-move' ? 'Take / Move' : screen === 'detail' ? 'Product detail' : screen[0].toUpperCase() + screen.slice(1)}</Link>)}</nav></div>
    <iframe title={`Phone inventory ${view} preview`} src={`/dev/inventory-preview?${frameQuery}`} className="mx-auto block h-[1900px] w-full max-w-[390px] rounded-lg border border-zinc-200 bg-white shadow-sm" />
  </main>;
  const { state, filters } = parseInventoryProductParams(params);
  const matchingProducts = previewProducts.filter(product => (!filters.search || [product.item_name, product.item_code, product.stock_ref, product.model_name].some(value => value?.toLowerCase().includes(filters.search!.toLowerCase()) ?? false))
    && (!filters.brand_id || product.brand_id === filters.brand_id) && (!filters.category_id || product.category_id === filters.category_id)
    && (!filters.subcategory_id || product.subcategory_id === filters.subcategory_id) && (!filters.status || product.status === filters.status)
    && stockMatches(product, filters.stock) && (filters.active === "all" || product.is_active === (filters.active ?? true)) && (!filters.location || product[LOCATION_QUANTITY_COLUMNS[filters.location]] > 0));
  const counts: ProductTypeCounts = { all: matchingProducts.length, product: 0, accessory: 0, temporary: 0 };
  for (const product of matchingProducts) counts[product.item_type]++;
  const products = matchingProducts.filter(product => !filters.item_type || product.item_type === filters.item_type);
  products.sort((a, b) => state.sort === "quantity_asc" ? a.quantity - b.quantity : state.sort === "quantity_desc" ? b.quantity - a.quantity : state.sort === "newest" ? b.created_at.localeCompare(a.created_at) : state.sort === "oldest" ? a.created_at.localeCompare(b.created_at) : state.sort === "name_desc" ? b.item_name.localeCompare(a.item_name) : a.item_name.localeCompare(b.item_name));
  const selected = previewProducts.find(product => product.id === first("id")) ?? previewProduct;
  const product = { ...previewProduct, ...selected, images: selected.main_image_url ? previewProduct.images : [], ...(first("removed") === "1" ? { is_active: false, removal_reason: "This display model has been retired." } : {}) };
  if (first("costs") === "off" || !canManageInventory(role)) delete product.costs;
  const requests = parseRequestParams(params,canManageInventory(role));
  const needle = requests.q.toLowerCase(), textMatches = (request: typeof previewMovementRequests[number] | typeof previewProductRequests[number]) => !needle || ('item_name' in request ? [request.item_name, request.item_code, request.model_name] : [request.product?.item_name, request.product?.stock_ref, request.product?.item_code, request.product?.model_name, ...(canManageInventory(role) ? [request.submitter_display_name] : [])]).some(value => value?.toLowerCase().includes(needle));
  const matches = (request: typeof previewMovementRequests[number] | typeof previewProductRequests[number]) => textMatches(request) && (requests.status === 'all' || request.request_status === requests.status) && (!requests.mine || request.submitted_by === previewRequestUserId);
  const requestProducts = previewProductRequests.filter(matches), requestMovements = previewMovementRequests.filter(matches);
  return <ErpAppShell compactHeader title="Inventory" description="Stock, products and warehouse inventory." role="warehouse_staff" userRole="warehouse_staff">
    <InventoryFrame><InventoryNav previewRole={role} showMovements={canManageInventory(role)} active={view === 'movements' ? 'movements' : view === 'requests' || view === 'new-product' ? 'requests' : view === 'overview' ? 'overview' : 'products'} preview />
      {view === 'reports' ? <ReportsView brands={previewBrands} categories={previewCategories} role={role} preview previewCatalog={previewPickerProducts} defaultRange={{ from: '2026-09-26', to: '2026-10-25' }} previewState={first('state') === 'busy' ? 'busy' : first('state') === 'error' ? 'error' : 'idle'} /> : view === 'cards' ? <CardComparison /> : view === 'states' ? (first('state') === 'loading' ? <InventorySkeleton /> : <div className="space-y-4"><ErrorState title="Inventory did not load" text="Check your internet connection, then try again." /><Banner tone="error">{NETWORK_MESSAGE}</Banner><Banner tone="success">Movement saved.</Banner></div>) : view === 'move' ? <MoveStockForm role={role} preview previewCatalog={previewPickerProducts} movementsHref={`/dev/inventory-preview?view=movements&frame=1&role=${role}`} initialProduct={first('id') ? previewPickerProducts.find(row => row.id === first('id')) ?? null : null} initialAction={first('action') === 'adjustment' ? 'adjustment' : 'internal_transfer'} initialQuantity={first('qty') ?? ''} /> : view === 'movements' ? (() => { const parsed = parseMovementParams(params); const items = previewMovementHistory.filter(row => (!parsed.state.product || row.product_id === parsed.state.product) && (!parsed.state.action || row.action_type === parsed.state.action) && (!parsed.state.q || [row.product?.item_name, row.product?.stock_ref, row.product?.item_code].some(value => value?.toLowerCase().includes(parsed.state.q.toLowerCase())))); return <MovementsView role={role} state={parsed.state} result={{ items, total: items.length, page: 1, page_count: 1, page_size: 24 }} baseHref={`/dev/inventory-preview?view=movements&frame=1&role=${role}`} detailHrefPrefix={`/dev/inventory-preview?view=detail&frame=1&role=${role}&id=`} productName={previewProducts.find(row => row.id === parsed.state.product)?.item_name} />; })() : view === 'categories' ? <CategoryManager categories={previewCategoryOverview} role={role} preview initialDialog={first('dialog') === 'add' ? 'add' : null} /> : view === 'edit' ? <ProductEditForm product={product} brands={previewBrands} categories={previewCategories} role={role} productHref={`/dev/inventory-preview?view=detail&frame=1&role=${role}&id=${product.id}`} preview /> : view === 'photos' ? <ProductPhotoManager productId={product.id} productName={product.item_name} images={product.images} role={role} productHref={`/dev/inventory-preview?view=detail&frame=1&role=${role}&id=${product.id}`} preview /> : view === 'new-product' ? <ProductRequestForm brands={previewBrands} categories={previewCategories} role={role} preview /> : view === 'hold-book' ? <ProductRequestActions product={product} role={role} preview initialKind="book" /> : view === 'take-move' ? <ProductRequestActions product={product} role={role} preview initialKind="take" /> : view === 'requests' ? <RequestsView brands={previewBrands} categories={previewCategories} products={requestProducts} movements={requestMovements} {...requests} q={requests.q} userId={previewRequestUserId} role={role} pageCount={1} total={requests.tab === 'products' ? requestProducts.length : requestMovements.length} preview previewImages={previewProduct.images} /> : view === "overview" ? <InventoryOverviewView role={role} overview={previewOverview} productsHref="/dev/inventory-preview?view=products&frame=1" moveHref={`/dev/inventory-preview?view=move&frame=1&role=${role}`} categoriesHref={`/dev/inventory-preview?view=categories&frame=1&role=${role}`} reportsHref={`/dev/inventory-preview?view=reports&frame=1&role=${role}`} /> : view === "products" ? <ProductsBrowser counts={counts} role={role} state={{ ...state, page: 1 }} result={{ items: products, total: products.length, page: 1, page_count: products.length ? 1 : 0, page_size: 24 }} brands={previewBrands} categories={previewCategories} baseHref={`/dev/inventory-preview?view=products&frame=1&role=${role}`} detailHrefPrefix={`/dev/inventory-preview?view=detail&frame=1&role=${role}&id=`} moveHref={`/dev/inventory-preview?view=move&frame=1&role=${role}`} categoriesHref={`/dev/inventory-preview?view=categories&frame=1&role=${role}`} reportsHref={`/dev/inventory-preview?view=reports&frame=1&role=${role}`} /> : <><ProductRequestActions product={product} role={role} preview initialRemove={view === 'remove'} /><ProductDetailView product={product} role={role} userId={previewRequestUserId} preview productsHref="/dev/inventory-preview?view=products&frame=1" /></>}
    </InventoryFrame>
  </ErpAppShell>;
}
