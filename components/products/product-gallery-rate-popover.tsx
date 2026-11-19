"use client";

import { toolbarSecondaryButton } from "@/components/products/product-toolbar-styles";
import { isCurrencyRate, type CurrencyRates } from "@/lib/products/gallery/gallery-aed";

export function ProductGalleryRatePopover({ currencies, defaults, temporary, onRate, onReset }: {
  currencies: string[];
  defaults: CurrencyRates;
  temporary: CurrencyRates;
  onRate: (currency: string, rate: number) => void;
  onReset: () => void;
}) {
  const active = Object.keys(temporary).length > 0;
  return (
    <div className="flex items-center gap-2">
      <details className="relative">
        <summary className={`${toolbarSecondaryButton} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>Rate</summary>
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
          <p className="text-sm font-semibold">Temporary rates to AED</p>
          {currencies.length ? currencies.map((currency) => (
            <form key={`${currency}:${temporary[currency] ?? defaults[currency] ?? ""}`} className="mt-2 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const rate = Number(new FormData(event.currentTarget).get("rate"));
                if (isCurrencyRate(rate)) onRate(currency, rate);
              }}>
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium">
                {currency}
                <input name="rate" aria-label={`Temporary ${currency} rate to AED`} type="number" min="0.0001" max="100000" step="0.000001" required
                  defaultValue={temporary[currency] ?? defaults[currency]} className="w-full min-w-0 rounded-md border border-zinc-300 px-2 py-1.5" />
              </label>
              <button type="submit" className="text-xs font-semibold text-emerald-900">Apply</button>
            </form>
          )) : <p className="mt-2 text-xs text-zinc-600">No foreign currency prices on this page.</p>}
          {active ? <button type="button" onClick={onReset} className="mt-3 text-xs font-semibold text-emerald-900 underline">Reset to default</button> : null}
        </div>
      </details>
      {active ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">Temporary rate</span> : null}
    </div>
  );
}
