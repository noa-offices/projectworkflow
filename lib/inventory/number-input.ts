/**
 * Number fields keep their value as text while typing. Digits only (one decimal point where decimals
 * are allowed), no leading zeros, empty allowed. Every Inventory number field uses these two helpers.
 */
export type NumberTextOptions = { decimals?: boolean; maxDecimals?: number };

export function cleanNumberText(raw: string, { decimals = false, maxDecimals = 2 }: NumberTextOptions = {}): string {
  const text = raw.replace(decimals ? /[^\d.]/g : /\D/g, "");
  if (!decimals) return text.replace(/^0+(?=\d)/, "");
  const dot = text.indexOf(".");
  if (dot === -1) return text.replace(/^0+(?=\d)/, "");
  const whole = text.slice(0, dot).replace(/^0+(?=\d)/, ""), fraction = text.slice(dot + 1).replace(/\./g, "").slice(0, maxDecimals);
  return `${whole || "0"}.${fraction}`;
}
/** The clean number to use in totals, previews, validation and the data sent to the server. Empty counts as 0. */
export function numberValue(text: string | number | null | undefined): number {
  if (typeof text === "number") return Number.isFinite(text) ? text : 0;
  const value = Number((text ?? "").trim());
  return text && Number.isFinite(value) ? value : 0;
}
