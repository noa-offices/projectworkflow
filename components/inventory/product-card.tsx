"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Clock, Package, Puzzle } from "lucide-react";
import { inventoryIdentifier, formatInventoryNumber, inventoryLabel, productStockLocations } from "@/lib/inventory/presentation";
import type { InventoryProduct } from "@/lib/inventory/types";

const locationShortLabels = {
  warehouse: "WH", dubai_showroom: "DXB", abudhabi_showroom: "AUH",
  mockup: "MK", temporary_out: "Out", sold: "Sold",
};
/** Up to three chips fit one row on a 2-up phone grid. With more, two chips and a "+N" chip fit. */
export const MAX_LOCATION_CHIPS = 3;
const statusDot: Record<string, string> = { available: "bg-emerald-600", showroom: "bg-sky-600", reserved: "bg-amber-500", hold: "bg-amber-500", missing: "bg-red-600", sold: "bg-zinc-500" };
/**
 * Dark see-through glass with white text. The backdrop is darkened a little so the white text passes AA
 * over a pure white photo (about 6:1) and a pure black one (21:1). Without backdrop-filter it falls back to bg-black/55.
 */
const glass = "absolute top-1.5 inline-flex items-center rounded-full border border-white/30 bg-black/55 px-2 py-0.5 text-[11px] font-bold leading-4 text-white shadow-sm [text-shadow:0_1px_2px_rgba(0,0,0,0.55)] supports-[backdrop-filter]:bg-black/30 supports-[backdrop-filter]:backdrop-blur-md supports-[backdrop-filter]:backdrop-saturate-150 supports-[backdrop-filter]:backdrop-brightness-[0.6] lg:text-xs";

export function ProductCard({ product, href }: { product: InventoryProduct; href?: string }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageUrl = product.main_image_url;
  const showImage = Boolean(imageUrl && imageUrl !== failedImage);
  const TypeIcon = product.item_type === "accessory" ? Puzzle : product.item_type === "temporary" ? Clock : Package;
  const brand = product.brand_name?.trim();
  const locations = productStockLocations(product).filter(({ quantity }) => quantity > 0);
  const keep = locations.length <= MAX_LOCATION_CHIPS ? locations.length : MAX_LOCATION_CHIPS - 1;
  const shown = locations.slice(0, keep), hidden = locations.slice(keep);
  const label = ({ label: name, quantity, cumulative }: typeof locations[number]) => `${name}${cumulative ? " (cumulative)" : ""}: ${formatInventoryNumber(quantity)}`;

  return (
    <Link href={href ?? `/inventory/products/${encodeURIComponent(product.id)}`} className="group flex h-full min-h-11 min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:border-emerald-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 motion-reduce:transition-none">
      <div data-card-photo className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-t-lg bg-zinc-100">
        {showImage && imageUrl ? (
          <Image src={imageUrl} alt={product.item_name} fill sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw" loading="lazy" unoptimized className="object-cover" onError={() => setFailedImage(imageUrl)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-zinc-400">
            <TypeIcon aria-hidden="true" className="h-9 w-9" strokeWidth={1.5} />
            <span className="text-center text-xs text-zinc-600">No image</span>
          </div>
        )}
        {brand ? <span data-card-brand title={brand} className={`${glass} left-1.5 max-w-[calc(100%-3rem)]`}><span className="truncate">{brand}</span></span> : null}
        {product.item_type !== "product" ? <span data-card-type title={inventoryLabel(product.item_type)} className={`${glass} right-1.5 px-1.5`}><TypeIcon aria-hidden="true" size={13} /><span className="sr-only">{inventoryLabel(product.item_type)}</span></span> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2 lg:gap-1.5 lg:p-3">
        <h2 className="line-clamp-2 min-h-8 text-[13px] font-semibold leading-4 text-zinc-950 [overflow-wrap:anywhere] group-hover:text-emerald-900 lg:min-h-0 lg:text-sm lg:leading-5">{product.item_name}</h2>
        <p data-card-identifier className="text-xs font-semibold leading-4 text-emerald-800 [overflow-wrap:anywhere] lg:text-sm">{inventoryIdentifier(product)}</p>
        <p data-card-stats className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4 text-zinc-700 lg:text-sm">
          <span className="font-semibold text-emerald-900">{formatInventoryNumber(product.quantity)} live</span><span aria-hidden="true">·</span><span>{formatInventoryNumber(product.available_quantity)} avail</span>
          {product.reserved_quantity > 0 ? <span aria-label={`${formatInventoryNumber(product.reserved_quantity)} reserved`} className="rounded bg-amber-100 px-1 font-semibold text-amber-950">{formatInventoryNumber(product.reserved_quantity)} res.</span> : null}
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-700 lg:text-xs"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${statusDot[product.status] ?? "bg-zinc-500"}`} />{inventoryLabel(product.status)}</span>
        </p>
        <ul aria-label="Stock locations" className="mt-auto flex min-w-0 flex-nowrap gap-1 overflow-hidden pt-0.5">
          {shown.map(item => <li key={item.code} aria-label={label(item)} title={label(item)} className="shrink-0 whitespace-nowrap rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] leading-4 text-zinc-700 lg:text-xs">
            {locationShortLabels[item.code]} <span className="font-semibold tabular-nums text-zinc-900">{formatInventoryNumber(item.quantity)}</span>
          </li>)}
          {hidden.length ? <li aria-label={`${hidden.length} more: ${hidden.map(label).join(", ")}`} title={hidden.map(label).join(", ")} className="shrink-0 whitespace-nowrap rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-zinc-700 lg:text-xs">+{hidden.length}</li> : null}
        </ul>
      </div>
    </Link>
  );
}
