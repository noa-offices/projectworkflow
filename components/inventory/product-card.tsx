"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatInventoryNumber, inventoryLabel, inventoryOptionalText, productStockLocations } from "@/lib/inventory/presentation";
import type { InventoryProduct } from "@/lib/inventory/types";

export function ProductCard({ product, href }: { product: InventoryProduct; href?: string }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageUrl = product.main_image_url;
  const showImage = Boolean(imageUrl && imageUrl !== failedImage);

  return (
    <Link href={href ?? `/inventory/products/${encodeURIComponent(product.id)}`} className="group block min-h-11 min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:border-emerald-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
      <div className="flex min-w-0 items-start gap-3 p-4">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50">
          {showImage && imageUrl ? (
            <Image src={imageUrl} alt={product.item_name} fill sizes="96px" loading="lazy" unoptimized className="object-contain p-2" onError={() => setFailedImage(imageUrl)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-zinc-400">
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z" /><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5" /></svg>
              <span className="text-center text-sm text-zinc-500">No image</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold text-zinc-950 group-hover:text-emerald-900">{product.item_name}</h2>
          <p className="mt-1 break-words text-sm text-zinc-600">{inventoryOptionalText(product.item_code)}</p>
          <p className="mt-1 break-words text-sm text-zinc-500">{product.brand_name || "Brand not specified"}</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <span className="max-w-full break-words rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700">{inventoryLabel(product.status)}</span>
            <span className="max-w-full break-words rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900">{formatInventoryNumber(product.quantity)} live</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-950">Reserved {formatInventoryNumber(product.reserved_quantity)}</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-950">Available {formatInventoryNumber(product.available_quantity)}</span>
          </div>
        </div>
      </div>
      <dl className="grid min-w-0 grid-cols-3 gap-x-3 gap-y-3 border-t border-zinc-100 p-4">
        {productStockLocations(product).map(({ code, label, quantity, cumulative }) => (
          <div key={code} className="min-w-0">
            <dt className="break-words text-sm text-zinc-500">{label}{cumulative ? " (cumulative)" : ""}</dt>
            <dd className="mt-1 break-words text-sm font-semibold tabular-nums text-zinc-800">{formatInventoryNumber(quantity)}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}
