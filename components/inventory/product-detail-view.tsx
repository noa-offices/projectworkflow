import Link from "next/link";
import { ArrowLeft, AlertTriangle, Package } from "lucide-react";
import type { ReactNode } from "react";
import {
  dimensionLabel,
  formatInventoryDate,
  formatInventoryNumber,
  inventoryLabel,
  orderedProductImages,
} from "@/lib/inventory/presentation";
import { LOCATION_LABELS, type InventoryProductDetail } from "@/lib/inventory/types";
import { ProductReservations } from "./product-reservations";
import { ProductImageGallery } from "./product-image-gallery";
import { StockByLocation } from "./stock-by-location";

const cardClass = "min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm text-zinc-900 [overflow-wrap:anywhere]">{children || "Not specified"}</dd>
    </div>
  );
}

export function ProductDetailView({ product, productsHref = "/inventory/products", role, userId, preview = false }: { product: InventoryProductDetail; productsHref?: string; role?: string | null; userId?: string | null; preview?: boolean }) {
  const dimensions = dimensionLabel(product);
  const costs = product.costs;
  const costRows = costs ? [
    ["Price", costs.price],
    ["Freight cost", costs.freight_cost],
    ["C & F", costs.c_and_f],
    ["Transport", costs.transport],
    ["Custom duty", costs.custom_duty],
    ["Labour", costs.labour],
    ["VAT", costs.vat],
  ] as const : [];

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-4">
      <Link href={productsHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-zinc-600 hover:bg-white hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All products
      </Link>

      {!product.is_active ? (
        <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 [overflow-wrap:anywhere]">
          <p className="font-semibold">Removed from active inventory</p>
          <p className="mt-1 whitespace-pre-wrap">{product.removal_reason || "No removal reason recorded."}</p>
        </div>
      ) : null}

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ProductImageGallery images={orderedProductImages(product.images)} productName={product.item_name} />

        <section aria-labelledby="product-heading" className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Product details</p>
          <h2 id="product-heading" className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 [overflow-wrap:anywhere]">{product.item_name}</h2>
          {product.model_name ? <p className="mt-1 text-sm text-zinc-500 [overflow-wrap:anywhere]">{product.model_name}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">{inventoryLabel(product.status)}</span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700">{inventoryLabel(product.condition)}</span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700">{inventoryLabel(product.item_type)}</span>
          </div>
          <dl className="mt-5 grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 border-t border-zinc-100 pt-5">
            <DetailField label="Item code">{product.item_code}</DetailField>
            <DetailField label="Stock reference">{product.stock_ref}</DetailField>
            <DetailField label="Brand">{product.brand_name}</DetailField>
            <DetailField label="Category">{product.custom_category_name || product.category_name}</DetailField>
            <DetailField label="Subcategory">{product.subcategory_name}</DetailField>
            <DetailField label="Source">{inventoryLabel(product.source)}</DetailField>
            {dimensions ? <DetailField label="Dimensions (L × W × H)">{dimensions}</DetailField> : null}
          </dl>
          {product.description ? (
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <h3 className="text-sm font-semibold text-zinc-900">Description</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-600 [overflow-wrap:anywhere]">{product.description}</p>
            </div>
          ) : null}
          {product.note ? (
            <div className="mt-4 rounded-lg bg-zinc-50 p-3">
              <h3 className="text-sm font-semibold text-zinc-900">Note</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-600 [overflow-wrap:anywhere]">{product.note}</p>
            </div>
          ) : null}
        </section>
      </div>

      <section aria-labelledby="stock-heading" className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="stock-heading" className="text-base font-semibold text-zinc-950">Stock by location</h2>
            <p className="mt-1 text-sm text-zinc-500">Sold is cumulative and excluded from current stock.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-950">
            <Package className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm">Current stock <strong className="ml-1 tabular-nums">{formatInventoryNumber(product.quantity)}</strong></span>
          </div>
        </div>
        {product.quantity <= product.low_stock_at ? (
          <div role="note" className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>Low stock: current quantity is at or below the threshold of {formatInventoryNumber(product.low_stock_at)}.</p>
          </div>
        ) : null}
        <div className="mt-4 min-w-0"><StockByLocation product={product} /></div>
      </section>

      <ProductReservations product={product} role={role} userId={userId} preview={preview} />

      {costs ? (
        <section aria-labelledby="cost-heading" className={cardClass}>
          <h2 id="cost-heading" className="text-base font-semibold text-zinc-950">Cost breakdown</h2>
          <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
            {costRows.map(([label, value]) => <DetailField key={label} label={label}><span className="tabular-nums">{value.toFixed(2)}</span></DetailField>)}
          </dl>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-4 text-sm font-semibold text-zinc-950">
            <span>Total cost</span><span className="tabular-nums">{costs.total_cost.toFixed(2)}</span>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="movements-heading" className={cardClass}>
        <h2 id="movements-heading" className="text-base font-semibold text-zinc-950">Recent movements</h2>
        {product.recent_movements.length ? (
          <ol className="mt-4 divide-y divide-zinc-100">
            {product.recent_movements.map((movement) => (
              <li key={movement.id} className="min-w-0 py-4 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900">{inventoryLabel(movement.movement_type)}</p>
                  <p className="text-sm font-semibold text-zinc-900 tabular-nums">{formatInventoryNumber(movement.quantity)} <span className="font-normal text-zinc-500">units</span></p>
                </div>
                <p className="mt-1 text-sm text-zinc-700 [overflow-wrap:anywhere]">
                  {movement.from_location ? LOCATION_LABELS[movement.from_location] : "—"}
                  <span className="px-2" aria-label="to">→</span>
                  {movement.to_location ? LOCATION_LABELS[movement.to_location] : "—"}
                </p>
                <p className="mt-2 text-sm leading-5 text-zinc-500 [overflow-wrap:anywhere]">
                  {movement.actor_display_name || "Unknown"} · <time dateTime={movement.created_at}>{formatInventoryDate(movement.created_at)}</time>
                </p>
                {movement.note ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-600 [overflow-wrap:anywhere]">{movement.note}</p> : null}
              </li>
            ))}
          </ol>
        ) : <p className="mt-3 text-sm text-zinc-500">No stock movements recorded.</p>}
      </section>
    </div>
  );
}
