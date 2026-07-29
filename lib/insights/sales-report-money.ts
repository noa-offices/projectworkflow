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
