// Deterministic currency conversion for a COMPLETED Product Configuration. The rate is always typed by the user (never defaulted or
// fetched), the multiplication runs on integer minor units (cents) with BigInt, and no AI is involved.

export const CONFIGURATION_MIN_RATE = 0.01;
export const CONFIGURATION_MAX_RATE = 100;
const RATE_NUMBER = /\d+(?:\.\d+)?/;
const MAX_RATE_DECIMALS = 6;

/** True for a message that is only a number, optionally led by the words "rate" and/or "at" ("4.05", "rate 4.05", "at 4.05"). */
export function isBareRateMessage(message: string): boolean {
  return /^(?:(?:rate|at)\s+)*\d+(?:\.\d+)?$/i.test(message.trim());
}

/** True when a post-completion message asks for a conversion: it names AED / dirham, says "convert", or is only a rate. */
export function isCurrencyConversionMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return /\baed\b/.test(normalized) || normalized.includes("dirham") || /\bconvert/.test(normalized) || isBareRateMessage(normalized);
}

export type ConversionRate = { status: "none" } | { status: "invalid" } | { status: "valid"; text: string };

/** The first number written with digits and an optional "." decimal part. Valid only when finite and within 0.01..100 inclusive. */
export function parseConversionRate(message: string): ConversionRate {
  const text = message.match(RATE_NUMBER)?.[0];
  if (text === undefined) return { status: "none" };
  const value = Number(text);
  return Number.isFinite(value) && value >= CONFIGURATION_MIN_RATE && value <= CONFIGURATION_MAX_RATE ? { status: "valid", text } : { status: "invalid" };
}

/** unit x rate in integer cents, rounded half up. 764 x 4.05 = 309420 cents exactly. */
export function convertToAedMinorUnits(unit: number, rateText: string): number {
  const [whole, fraction = ""] = rateText.split(".");
  const decimals = Math.min(fraction.length, MAX_RATE_DECIMALS);
  const scaledRate = BigInt(whole + fraction.slice(0, decimals));
  let divisor = BigInt(1);
  for (let index = 0; index < decimals; index += 1) divisor *= BigInt(10);
  const cents = BigInt(Math.round(unit * 100));
  const two = BigInt(2);
  return Number((cents * scaledRate * two + divisor) / (divisor * two));
}

export function formatAedMinorUnits(minorUnits: number): string {
  return (minorUnits / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type ConfigurationConversion =
  | { kind: "unsupported" }
  | { kind: "already_aed" }
  | { kind: "ask_rate"; currency: string; invalidRate: boolean }
  | { kind: "converted"; currency: string; rate: string; aedMinorUnits: number };

/** Decision only; the caller words the answer. A price with any missing exchange rate (mixed currencies) or a currency other than AED / EUR / USD is not supported. */
export function convertConfiguredPrice(price: { currency: string; unit: number; missingExchangeRateCurrencies: string[] }, message: string): ConfigurationConversion {
  if (price.missingExchangeRateCurrencies.length > 0) return { kind: "unsupported" };
  const currency = price.currency.toUpperCase();
  if (currency === "AED") return { kind: "already_aed" };
  if (currency !== "EUR" && currency !== "USD") return { kind: "unsupported" };
  const rate = parseConversionRate(message);
  if (rate.status !== "valid") return { kind: "ask_rate", currency, invalidRate: rate.status === "invalid" };
  return { kind: "converted", currency, rate: rate.text, aedMinorUnits: convertToAedMinorUnits(price.unit, rate.text) };
}
