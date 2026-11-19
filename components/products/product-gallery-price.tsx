"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import { EMPTY_RATES, galleryAedView, type CurrencyRates } from "@/lib/products/gallery/gallery-aed";
import { galleryPriceView, type GalleryPriceState } from "@/lib/products/gallery/gallery-price-view";
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
  if (view.kind === "loading") return (
    <div role="status" aria-label="Loading price list" className="flex flex-col gap-1.5 pt-1">
      <span aria-hidden="true" className="h-3 w-24 animate-pulse rounded bg-zinc-100" />
      <span aria-hidden="true" className="h-3 w-16 animate-pulse rounded bg-zinc-100" />
    </div>
  );
  if (view.kind === "configure") return (
    <Link href={view.href} title="Some saved choices changed, so the price cannot be calculated here." className="text-xs font-semibold text-emerald-900 underline underline-offset-2">
      Open to configure
    </Link>
  );
  const aed = defaults ? galleryAedView(price, defaults, temporary) : null;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p title={view.amount} className={detail ? "text-sm" : "max-w-full overflow-x-auto whitespace-nowrap text-xs [scrollbar-width:thin]"}>
        <span className="text-zinc-600">Price list</span>{" "}
        <strong className="tabular-nums text-zinc-950">{view.amount}</strong>
      </p>
      {aed ? (
        <div className="space-y-0.5 text-xs text-zinc-600">
          {aed.amounts.map((amount) => <p key={amount} className="font-semibold tabular-nums text-zinc-950">{amount}</p>)}
          {aed.notes.map((note) => <p key={note}>{note}</p>)}
          {aed.noRate ? <p>No rate set for {aed.missing.join(", ")}</p> : aed.missing.map((currency) => <p key={currency}>No rate for {currency}</p>)}
        </div>
      ) : null}
      {view.badge ? <PriceStatusBadge {...view.badge} /> : null}
      {detail && view.checked ? <p className="text-xs text-zinc-600">{view.checked}</p> : null}
    </div>
  );
}
