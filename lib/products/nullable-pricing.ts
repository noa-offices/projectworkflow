/** Shared JSON-pricing semantics: null means unknown; zero remains explicit. */
export function parseNullablePricingNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;

  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function hasExplicitPricingNumber(value: number | null | undefined) {
  return value !== null && value !== undefined;
}

export function resolveInheritedPricingCurrency({
  brandCurrency,
  fallbackCurrency,
  normalizeCurrency,
  rowCurrency,
  templateCurrency,
}: {
  brandCurrency?: string | null;
  fallbackCurrency: string;
  normalizeCurrency: (value: string) => string;
  rowCurrency?: string | null;
  templateCurrency?: string | null;
}) {
  const firstDefined = [rowCurrency, templateCurrency, brandCurrency]
    .find((value) => typeof value === "string" && value.trim());
  return firstDefined ? normalizeCurrency(firstDefined) : fallbackCurrency;
}
