import { formatMoney } from "@/lib/currencies";
import { ruleConvertedPrice } from "@/lib/quotation-pricing";
import type { GalleryPriceState } from "./gallery-price-view";

export type CurrencyRates = Readonly<Partial<Record<string, number>>>;
export const EMPTY_RATES: CurrencyRates = {};
type SourceTotal = { currency: string; amount: number };

export function currencyRateCode(value: unknown) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) && code !== "AED" ? code : null;
}

export function isCurrencyRate(value: unknown): value is number {
  return typeof value === "number" && value >= 0.0001 && value <= 100000 &&
    Number(value.toFixed(6)) === value;
}

export function galleryAed(sourceTotals: ReadonlyArray<SourceTotal>, rates: CurrencyRates) {
  const missing = new Set<string>();
  let unroundedTotal = 0;
  let hasConversion = false;
  const lines = sourceTotals.map<SourceTotal & { aed?: number }>((line) => {
    if (line.currency === "AED") {
      unroundedTotal += line.amount;
      return { ...line, aed: line.amount };
    }
    const rate = rates[line.currency];
    if (!isCurrencyRate(rate)) {
      missing.add(line.currency);
      return { ...line };
    }
    const converted = line.amount * rate;
    unroundedTotal += converted;
    hasConversion = true;
    return { ...line, aed: ruleConvertedPrice("whole_aed_v1", converted) };
  });
  const totalAed = sourceTotals.length && !missing.size
    ? hasConversion ? ruleConvertedPrice("whole_aed_v1", unroundedTotal) : unroundedTotal
    : undefined;
  return { lines, totalAed, missing: [...missing] };
}

const approximate = (amount: number) => `≈ ${formatMoney("AED", amount, { minimumFractionDigits: 0 })}`;

export function galleryAedView(price: GalleryPriceState, defaults: CurrencyRates, temporary: CurrencyRates) {
  if (!price || price === "loading" || price.status !== "priced" || !price.sourceTotals.length) return null;
  const rates = { ...defaults, ...temporary };
  const { lines, totalAed, missing } = galleryAed(price.sourceTotals, rates);
  const partial = lines.flatMap(({ currency, aed }) => aed === undefined ? [] : [`${currency} ${approximate(aed)}`]);
  const notes = [...new Set(lines.map(({ currency }) => currency))].flatMap((currency) => {
    const rate = rates[currency];
    if (currency === "AED" || !isCurrencyRate(rate)) return [];
    return [`1 ${currency} = ${rate} AED (${isCurrencyRate(temporary[currency]) ? "your temporary rate" : "default"})`];
  });
  return {
    amounts: totalAed === undefined ? partial : [approximate(totalAed)],
    notes,
    missing,
    noRate: partial.length === 0 && missing.length > 0,
  };
}
