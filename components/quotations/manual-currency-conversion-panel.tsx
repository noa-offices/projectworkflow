"use client";

import { useState } from "react";
import { applyManualCurrencyConversion } from "@/app/quotations/actions";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { quotationMoneyValue } from "@/lib/quotation-pricing";

function parseNumber(value: string, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatPreviewMoney(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ManualCurrencyConversionPanel({
  hasStoredConversion,
  itemCurrency,
  itemId,
  quotationId,
  returnTo,
  sourceCurrencyDefault,
  sourcePriceDefault,
  conversionRateDefault,
}: {
  hasStoredConversion: boolean;
  itemCurrency: string;
  itemId: string;
  quotationId: string;
  returnTo: string;
  sourceCurrencyDefault: string;
  sourcePriceDefault: number;
  conversionRateDefault: number;
}) {
  const [sourcePrice, setSourcePrice] = useState(String(sourcePriceDefault));
  const [sourceCurrency, setSourceCurrency] = useState(normalizeCurrency(sourceCurrencyDefault));
  const [conversionRate, setConversionRate] = useState(String(conversionRateDefault));

  const normalizedSourceCurrency = normalizeCurrency(sourceCurrency || defaultCurrency);
  const numericSourcePrice = parseNumber(sourcePrice);
  const numericRate = normalizedSourceCurrency === "AED" ? 1 : parseNumber(conversionRate);
  const convertedPrice = quotationMoneyValue(
    normalizedSourceCurrency === "AED"
      ? numericSourcePrice
      : numericSourcePrice * numericRate,
  );
  const showNoConversionNote =
    normalizeCurrency(itemCurrency) === "AED" &&
    !hasStoredConversion &&
    normalizedSourceCurrency === "AED";

  return (
    <details className="border border-zinc-300 bg-white p-3" open>
      <summary className="cursor-pointer list-none text-[11px] font-bold uppercase text-zinc-500">
        Manual Source Price / Conversion
      </summary>
      <div className="mt-3 grid gap-3">
        {showNoConversionNote ? (
          <p className="text-xs text-zinc-500">
            No conversion needed right now. Quotation row pricing stays in AED, and you can still keep the original manual source price here.
          </p>
        ) : null}
        <form action={applyManualCurrencyConversion} className="grid gap-2 md:grid-cols-4">
          <input type="hidden" name="quotation_id" value={quotationId} />
          <input type="hidden" name="quotation_item_id" value={itemId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Source price</span>
            <input
              name="source_price"
              type="number"
              step="0.01"
              min="0"
              value={sourcePrice}
              onChange={(event) => setSourcePrice(event.target.value)}
              className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Source currency</span>
            <select
              name="source_currency"
              value={normalizedSourceCurrency}
              onChange={(event) => setSourceCurrency(event.target.value)}
              className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
            >
              {supportedCurrencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Conversion rate to AED</span>
            <input
              name="conversion_rate"
              type="number"
              step="0.0001"
              min="0"
              value={normalizedSourceCurrency === "AED" ? "1" : conversionRate}
              onChange={(event) => setConversionRate(event.target.value)}
              disabled={normalizedSourceCurrency === "AED"}
              className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20 disabled:bg-zinc-50 disabled:text-zinc-500"
            />
          </label>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase text-zinc-500">Converted AED price preview</p>
            <p className="mt-1 text-sm font-semibold text-zinc-900">AED {formatPreviewMoney(convertedPrice)}</p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 md:col-span-3">
            <p>Source: {normalizedSourceCurrency} {formatPreviewMoney(numericSourcePrice)}</p>
            <p>Rate: {normalizedSourceCurrency === "AED" ? "1.00" : conversionRate || "-"}</p>
            <p>Converted AED: {formatPreviewMoney(convertedPrice)}</p>
          </div>
          <div className="flex items-end justify-end md:col-span-1">
            <button
              type="submit"
              className="h-8 w-full bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
            >
              Apply converted AED price
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}
