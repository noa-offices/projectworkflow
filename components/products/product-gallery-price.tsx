"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import { EMPTY_RATES, galleryAedView, type CurrencyRates } from "@/lib/products/gallery/gallery-aed";
import { galleryPriceLayout, galleryPriceView, type GalleryPriceState } from "@/lib/products/gallery/gallery-price-view";
import { PriceStatusBadge } from "./product-price-status-badge";

export const GalleryRatesContext = createContext<{ defaults: CurrencyRates | null; temporary: CurrencyRates }>({
  defaults: null,
  temporary: EMPTY_RATES,
});

export function ProductGalleryPrice({ templateId, price, detail = false }: {
  templateId: string;
  price: GalleryPriceState;
  detail?: boolean;
}) {
  const { defaults, temporary } = useContext(GalleryRatesContext);
  const view = galleryPriceView(templateId, price);
  if (!view) return null;
  const box = detail ? "min-h-24 p-4" : "min-h-24 p-3";
  if (view.kind === "loading") return (
    <div role="status" aria-label="Loading price list" className={`flex flex-col gap-1.5 rounded-lg bg-emerald-50 ${box}`}>
      <span aria-hidden="true" className="h-3 w-16 animate-pulse rounded bg-emerald-100" />
      <span aria-hidden="true" className="h-6 w-28 animate-pulse rounded bg-emerald-100" />
      <span aria-hidden="true" className="h-3 w-20 animate-pulse rounded bg-emerald-100" />
    </div>
  );
  if (view.kind === "configure") return (
    <div className={`flex flex-col items-start gap-1.5 rounded-lg bg-zinc-100 ${box}`}>
      <Link href={view.href} title={view.reason} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-zinc-50">
        Open to configure
      </Link>
      <p className="text-xs text-zinc-500">{view.reason}</p>
    </div>
  );
  const aed = defaults ? galleryAedView(price, defaults, temporary) : null;
  const sourceTotals = typeof price === "object" && price.status === "priced" ? price.sourceTotals : [];
  const layout = galleryPriceLayout(sourceTotals, aed);
  return (
    <div className={`flex min-w-0 flex-col items-start gap-0.5 rounded-lg bg-emerald-50 tabular-nums text-emerald-950 ${box}`} aria-label="Price list">
      <p className="text-xs text-zinc-500">Price list</p>
      {layout.headline ? <p title={layout.headline} className={`max-w-full font-bold leading-tight ${detail ? "text-3xl" : "text-xl"}`}>{layout.headline}</p> : null}
      {layout.lines.map((line) => <p key={line} className={`font-medium ${detail ? "text-base" : "text-sm"}`}>{line}</p>)}
      {layout.muted.map((note) => <p key={note} className="text-xs text-zinc-500">{note}</p>)}
      {layout.notes.map((note) => <p key={note} className="text-[11px] text-zinc-500">{note}</p>)}
      {view.badge ? <div className="pt-1"><PriceStatusBadge {...view.badge} /></div> : null}
      {detail && view.checked ? <p className="text-xs text-zinc-600">{view.checked}</p> : null}
    </div>
  );
}
