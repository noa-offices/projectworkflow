"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Clock, Package, Puzzle } from "lucide-react";
import { formatInventoryNumber, inventoryLabel, productStockLocations } from "@/lib/inventory/presentation";
import type { InventoryProduct } from "@/lib/inventory/types";

const locationShortLabels = {
  warehouse: "WH", dubai_showroom: "DXB", abudhabi_showroom: "AUH",
  mockup: "Mockup", temporary_out: "Out", sold: "Sold",
};

export function ProductCard({ product, href }: { product: InventoryProduct; href?: string }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageUrl = product.main_image_url;
  const showImage = Boolean(imageUrl && imageUrl !== failedImage);
  const PlaceholderIcon = product.item_type === "accessory" ? Puzzle : product.item_type === "temporary" ? Clock : Package;
  const itemCode = product.item_code?.trim();

  return (
    <Link href={href ?? `/inventory/products/${encodeURIComponent(product.id)}`} className="group block min-h-11 min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:border-emerald-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-lg border-b border-zinc-100 bg-zinc-50">
        {showImage && imageUrl ? (
          <Image src={imageUrl} alt={product.item_name} fill sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw" loading="lazy" unoptimized className="object-cover" onError={() => setFailedImage(imageUrl)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-zinc-400">
            <PlaceholderIcon aria-hidden="true" className="h-9 w-9" strokeWidth={1.5} />
            <span className="text-center text-xs text-zinc-500">No image</span>
          </div>
        )}
      </div>
      <div className="min-w-0 p-3">
        <h2 className="text-sm font-semibold text-zinc-950 [overflow-wrap:anywhere] group-hover:text-emerald-900">{product.item_name}</h2>
        <p className="mt-1 text-sm font-semibold text-emerald-800 [overflow-wrap:anywhere]">{product.stock_ref}</p>
        {itemCode ? <p className="mt-1 text-xs text-zinc-500 [overflow-wrap:anywhere]">Code: {itemCode}</p> : null}
        <p className="mt-1 text-xs text-zinc-500 [overflow-wrap:anywhere]">{product.brand_name || "Brand not specified"}</p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
          <span className="max-w-full break-words rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700">{inventoryLabel(product.status)}</span>
          <span className="max-w-full break-words rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900">{formatInventoryNumber(product.quantity)} live</span>
          <span className="max-w-full break-words rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-950">Reserved {formatInventoryNumber(product.reserved_quantity)}</span>
          <span className="max-w-full break-words rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-950">Available {formatInventoryNumber(product.available_quantity)}</span>
        </div>
      </div>
      <ul aria-label="Stock locations" className="flex min-w-0 flex-wrap gap-1 border-t border-zinc-100 px-3 py-2">
        {productStockLocations(product).filter(({ quantity }) => quantity > 0).map(({ code, label, quantity, cumulative }) => {
          const fullLabel = `${label}${cumulative ? " (cumulative)" : ""}: ${formatInventoryNumber(quantity)}`;
          return <li key={code} aria-label={fullLabel} title={fullLabel} className="max-w-full rounded bg-zinc-100 px-1.5 py-1 text-xs text-zinc-600 [overflow-wrap:anywhere]">
            {locationShortLabels[code]} <span className="font-semibold tabular-nums text-zinc-800">{formatInventoryNumber(quantity)}</span>
          </li>;
        })}
      </ul>
    </Link>
  );
}
