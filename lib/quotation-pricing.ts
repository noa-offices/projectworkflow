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

// ---- Pricing rule of one quotation. Everything below takes the rule as an input; a quotation without a rule is legacy and behaves as above. ----
// whole_aed_v1: converted price and discount amount are whole AED (half up), a typed price is kept as typed, and nothing rounds up to 5.
// Part 2 still to do: PDF, lists, project and procurement pages call formatQuotationMoney directly and do not read the rule yet.
export type PricingRule = "round_up_5_legacy" | "whole_aed_v1";
export const LEGACY_PRICING_RULE: PricingRule = "round_up_5_legacy";
/** The rule every new quotation starts with. Revisions and copies keep their source's rule instead. */
export const NEW_QUOTATION_PRICING_RULE: PricingRule = "whole_aed_v1";

/** Reads layout_settings.pricing_rule. Missing, null or unknown is legacy. */
export function readPricingRule(layoutSettings: unknown): PricingRule {
  const value = layoutSettings && typeof layoutSettings === "object" ? (layoutSettings as { pricing_rule?: unknown }).pricing_rule : null;
  return value === "whole_aed_v1" ? "whole_aed_v1" : LEGACY_PRICING_RULE;
}
export function withPricingRule(layoutSettings: unknown, rule: PricingRule) {
  return { ...(layoutSettings && typeof layoutSettings === "object" ? layoutSettings as Record<string, unknown> : {}), pricing_rule: rule };
}
const isWholeAed = (rule: PricingRule | null | undefined) => rule === "whole_aed_v1";

const finite = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : 0; };
/** 2 decimals, half up, without binary fraction surprises. */
export function roundExact2(value: unknown) {
  return Math.round(Number((finite(value) * 100).toPrecision(12))) / 100;
}
/** Nearest whole number, half up: 155.5 is 156, 155.4 is 155. */
export function roundWholeHalfUp(value: unknown) {
  return Math.round(Number(finite(value).toPrecision(12)));
}

/** A price that comes from the library or a conversion. Legacy: up to 5. Whole AED: nearest whole. */
export function ruleConvertedPrice(rule: PricingRule | null | undefined, value: unknown) {
  return isWholeAed(rule) ? roundWholeHalfUp(value) : quotationMoneyValue(value);
}
/** An amount that is not a converted price: a total, a kept price, a value for the audit log. Legacy: up to 5. Whole AED: exact, 2 decimals. */
export function ruleExactAmount(rule: PricingRule | null | undefined, value: unknown) {
  return isWholeAed(rule) ? roundExact2(value) : quotationMoneyValue(value);
}
export function formatRuleMoney(rule: PricingRule | null | undefined, currency: string | null | undefined, value: unknown) {
  return isWholeAed(rule) ? formatMoney(currency, roundExact2(value), { maximumFractionDigits: 2, minimumFractionDigits: 0 }) : formatQuotationMoney(currency, value);
}
export function ruleMoneyCell(rule: PricingRule | null | undefined, value: unknown) {
  return isWholeAed(rule) ? roundExact2(value).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 }) : quotationMoneyCell(value);
}

export type LinePricing = { unitPrice: number; discountValue: number; discountAmount: number; netPrice: number; netTotal: number };
/** Whole AED line: the price as given, the discount amount whole, net is price minus discount, net total is net x quantity. */
export function wholeAedLinePricing(unitPriceValue: unknown, discountType: string, discountValueInput: unknown, qty: unknown = 1): LinePricing {
  const unitPrice = roundExact2(unitPriceValue);
  const input = Math.max(roundExact2(discountValueInput), 0);
  const discountValue = discountType === "percent" ? Math.min(input, 100) : discountType === "none" ? 0 : roundWholeHalfUp(input);
  const rawDiscount = discountType === "percent" ? unitPrice * discountValue / 100 : discountValue;
  const discountAmount = Math.min(roundWholeHalfUp(rawDiscount), Math.max(unitPrice, 0));
  const netPrice = roundExact2(Math.max(unitPrice - discountAmount, 0));
  return { unitPrice, discountValue, discountAmount, netPrice, netTotal: roundExact2(netPrice * finite(qty)) };
}
/** The shared builder's line. The legacy branch is the original calculation, unchanged. */
export function quotationLinePricing(rule: PricingRule | null | undefined, unitPriceValue: number, discountType: string, discountValueInput: number, qty = 1): LinePricing {
  if (isWholeAed(rule)) return wholeAedLinePricing(unitPriceValue, discountType, discountValueInput, qty);
  const unitPrice = quotationMoneyValue(unitPriceValue);
  const discountValue = discountType === "percent"
    ? discountValueInput
    : quotationMoneyValue(discountValueInput);
  const discountAmount = quotationMoneyValue(
    discountType === "percent"
      ? (unitPrice * discountValue) / 100
      : discountValue,
  );
  const netPrice = quotationMoneyValue(Math.max(unitPrice - discountAmount, 0));

  return {
    discountAmount,
    discountValue,
    netPrice,
    netTotal: quotationMoneyValue(qty * netPrice),
    unitPrice,
  };
}

export type RuleTotals = { subtotal: number; discount_total: number; overall_discount_amount: number; net_total: number; vat_amount: number; grand_total: number };
/** Whole AED totals: the exact sum of the lines, VAT and grand total at 2 decimals. Both builders use this, so they agree. */
export function wholeAedTotals(input: { lines: Array<{ qty: unknown; unitPrice: unknown; netTotal: unknown }>; overallDiscountType: string; overallDiscountValue: unknown; vatPercent: unknown }): RuleTotals {
  const subtotal = roundExact2(input.lines.reduce((total, line) => total + roundExact2(finite(line.unitPrice) * finite(line.qty)), 0));
  const lineNet = roundExact2(input.lines.reduce((total, line) => total + roundExact2(line.netTotal), 0));
  const overallBase = roundExact2(input.overallDiscountType === "percent" ? lineNet * Math.min(Math.max(finite(input.overallDiscountValue), 0), 100) / 100 : Math.max(finite(input.overallDiscountValue), 0));
  const overall = roundExact2(Math.min(overallBase, lineNet || subtotal));
  const net = roundExact2(Math.max(lineNet - overall, 0));
  const vat = roundExact2(net * Math.max(finite(input.vatPercent), 0) / 100);
  return { subtotal, discount_total: roundExact2(Math.max(subtotal - lineNet, 0)), overall_discount_amount: overall, net_total: net, vat_amount: vat, grand_total: roundExact2(net + vat) };
}
