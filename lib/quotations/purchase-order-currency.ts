const PURCHASE_ORDER_CURRENCY_CODES = [
  "AED",
  "USD",
  "EUR",
  "GBP",
  "SAR",
  "QAR",
  "OMR",
  "KWD",
  "BHD",
  "CNY",
  "INR",
] as const;

export const purchaseOrderCurrencies = PURCHASE_ORDER_CURRENCY_CODES.map((code) => ({ code, label: code }));

const purchaseOrderCurrencyCodeSet = new Set<string>(PURCHASE_ORDER_CURRENCY_CODES);

export function normalizePurchaseOrderCurrency(value: string | null | undefined) {
  const code = value?.trim().toUpperCase() ?? "";
  return purchaseOrderCurrencyCodeSet.has(code) ? code : "AED";
}

export function formatPurchaseOrderMoney(currency: string | null | undefined, value: number | null) {
  if (value === null) return "-";

  return `${normalizePurchaseOrderCurrency(currency)} ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
