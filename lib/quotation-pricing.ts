import { formatMoney } from "@/lib/currencies";

export const QUOTE_ROUNDING_STEP = 5;
export const QUOTE_ROUNDING_MODE = "ceil";

export function ceilToNearest(value: unknown, step = QUOTE_ROUNDING_STEP) {
  const number = Number(value);
  const safeValue = Number.isFinite(number) ? number : 0;
  const safeStep = Number.isFinite(step) && step > 0 ? step : QUOTE_ROUNDING_STEP;

  // Company pricing policy: quotation prices round up to the nearest 5 AED.
  return Math.ceil(safeValue / safeStep) * safeStep;
}

export function quotationMoneyValue(value: unknown) {
  return ceilToNearest(value, QUOTE_ROUNDING_STEP);
}

export function quotationMoneyCell(value: unknown) {
  return quotationMoneyValue(value).toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

export function formatQuotationMoney(currency: string | null | undefined, value: unknown) {
  return formatMoney(currency, quotationMoneyValue(value), {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}
