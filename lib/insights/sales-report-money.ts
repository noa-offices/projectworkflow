import { formatMoney } from "@/lib/currencies";

export function formatSalesReportAEDMillions(
  value: number,
  options: { includeCurrency?: boolean } = {},
): string {
  const amount = Number.isFinite(value) ? value : 0;
  const fractionDigits = Math.abs(amount) < 1_000_000 ? 3 : 2;
  const formatted = (amount / 1_000_000).toFixed(fractionDigits);
  const prefix = options.includeCurrency === false ? "" : "AED ";

  return `${prefix}${formatted}M`;
}

/** Display-only switch for the Sales Report. `amount=full` in the URL; absent means millions. */
export type AmountMode = "millions" | "full";

export function parseAmountMode(value: string | null | undefined): AmountMode {
  return value === "full" ? "full" : "millions";
}

/** Whole AED with thousand commas, e.g. "AED 97,350". */
export function formatSalesReportAEDFull(
  value: number,
  options: { includeCurrency?: boolean } = {},
): string {
  const whole = Number.isFinite(value) ? Math.round(value) || 0 : 0;
  if (options.includeCurrency === false) return whole.toLocaleString("en-US");
  return formatMoney("AED", whole, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatSalesReportAED(
  value: number,
  mode: AmountMode,
  options: { includeCurrency?: boolean } = {},
): string {
  return mode === "full"
    ? formatSalesReportAEDFull(value, options)
    : formatSalesReportAEDMillions(value, options);
}

/** Query string for the next mode: `amount=full` is added, millions removes it. Everything else (range, user, ...) is kept. */
export function amountModeQuery(currentQuery: string, next: AmountMode): string {
  const params = new URLSearchParams(currentQuery);
  if (next === "full") params.set("amount", "full");
  else params.delete("amount");
  return params.toString();
}
