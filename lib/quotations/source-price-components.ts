/**
 * Commercial SOURCE amounts vs final QUOTATION rounding.
 *
 * Component cards/lines and the source-currency total show the authoritative source amounts (2 decimals only).
 * The company quotation rounding (`quotationMoneyValue`, round up to the nearest 5) is applied only where the
 * quotation price is finalized, never to an individual component line.
 */

/** Source-currency precision only: 2 decimals, no quotation rounding. */
export function roundSourceAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

/** One component line: raw unit source price x quantity. */
export function rawSourceLine(unitPrice: unknown, quantity: unknown) {
  const unit = roundSourceAmount(unitPrice);
  const qty = Number.isFinite(Number(quantity)) ? Number(quantity) : 0;
  return { unitPrice: unit, quantity: qty, total: roundSourceAmount(unit * qty) };
}

/** True source sum of already-raw lines (never the sum of individually rounded lines). */
export function sumSourceLines(lines: ReadonlyArray<{ total: number }>): number {
  return roundSourceAmount(lines.reduce((sum, line) => sum + line.total, 0));
}

/**
 * A selected Base/Model row REPLACES the template default price; the default only applies when the row has no
 * price (null/undefined). A price of 0 is a real price. Client and server share this rule.
 */
export function baseModelPriceOrDefault(rowPrice: number | null | undefined, defaultPrice: number | null | undefined): number {
  if (rowPrice === null || rowPrice === undefined) return Number(defaultPrice ?? 0) || 0;
  const parsed = Number(rowPrice);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Same-currency (AED-only) unit sum used by the server before final quotation rounding.
 * Every additive component appears exactly once, including the Workstation variant row.
 */
export function sameCurrencyUnitSum(parts: { base: number; system: number; workstationVariant: number; accessories: number; linked: number }): number {
  return roundSourceAmount(parts.base + parts.system + parts.workstationVariant + parts.accessories + parts.linked);
}

/** Non-AED source currencies that have an amount but no usable AED exchange rate. */
export function missingExchangeRateCurrencies(totals: ReadonlyMap<string, number> | Record<string, number>, rates: Record<string, unknown>): string[] {
  const entries = totals instanceof Map ? Array.from(totals.entries()) : Object.entries(totals);
  return entries
    .filter(([currency, amount]) => currency !== "AED" && amount > 0 && !(Number(rates[currency]) > 0))
    .map(([currency]) => currency);
}
