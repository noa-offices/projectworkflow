import { parseSupportedCurrency, type SupportedCurrency } from "../currencies";

export const pricingConflictMessage = "This Product Template changed. Reload before saving.";

/** Postgres bigint tokens must never be rounded or defaulted when absent. */
export function expectedPricingVersion(value: unknown): string | null {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const token = String(value).trim();
  if (!/^\d+$/.test(token) || BigInt(token) > BigInt("9223372036854775807")) return null;
  return BigInt(token).toString();
}

export function requireProductPricingCurrency(value: unknown): SupportedCurrency {
  const currency = parseSupportedCurrency(value);
  if (!currency) throw new Error("Unsupported Product currency. Use AED, EUR, or USD.");
  return currency;
}

/** Validate source JSON before legacy parsers can turn unsupported currencies into AED. */
export function assertProductPricingCurrencies(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "currency" && item !== null && item !== undefined && item !== "") requireProductPricingCurrency(item);
    else if (typeof item === "object") assertProductPricingCurrencies(item);
  }
}
