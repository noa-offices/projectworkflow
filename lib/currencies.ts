export const defaultCurrency = "AED";

export const supportedCurrencies = [
  { code: "AED", label: "AED - UAE Dirham" },
  { code: "EUR", label: "EUR - Euro" },
  { code: "USD", label: "USD - US Dollar" },
] as const;

export type SupportedCurrency = (typeof supportedCurrencies)[number]["code"];

// TODO: Future currency conversion phase should add an exchange_rates table
// with AED as base currency, source currency, rate to AED, rate date, manual
// admin updates, later optional live API sync, and quotation item original
// currency plus converted AED amount.
const supportedCurrencyCodes = new Set<string>(
  supportedCurrencies.map((currency) => currency.code),
);

export function normalizeCurrency(value: string | null | undefined) {
  const code = value?.trim().toUpperCase() ?? "";

  return supportedCurrencyCodes.has(code) ? code : defaultCurrency;
}

export function formatMoney(
  currency: string | null | undefined,
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  return `${normalizeCurrency(currency)} ${value.toLocaleString("en-US", {
    minimumFractionDigits: options?.minimumFractionDigits ?? 2,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    ...options,
  })}`;
}
