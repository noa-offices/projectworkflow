import { quotationMoneyValue, roundExact2, type PricingRule } from "../quotation-pricing";
import { formatMoney } from "../currencies";

type SavedTotals = {
  subtotal: number;
  discount_total: number;
  overall_discount_type: string;
  overall_discount_value: number;
  vat_amount: number;
  grand_total: number;
};

export function roundingAdjustmentFromLayout(layoutSettings: unknown): number {
  const settings = layoutSettings && typeof layoutSettings === "object" ? layoutSettings as Record<string, unknown> : {};
  const rounding = settings.price_rounding && typeof settings.price_rounding === "object" ? settings.price_rounding as Record<string, unknown> : {};
  const prices = rounding.rounded_net_prices;
  if (!prices || typeof prices !== "object" || !Object.keys(prices).length) return 0;
  const adjustment = Number(rounding.adjustment);
  return Number.isFinite(adjustment) ? roundExact2(adjustment) : 0;
}

export function lineRoundingAdjustment(roundedNetPrice: number, currentNetPrice: number, quantity: number) {
  return roundExact2((roundedNetPrice - currentNetPrice) * Math.max(quantity, 0));
}

export function formatRoundingDifference(rule: PricingRule | null | undefined, currency: string, adjustment: number) {
  const amount = roundExact2(Math.abs(adjustment));
  const digits = rule === "whole_aed_v1" && !Number.isInteger(amount) ? 2 : 0;
  return `${adjustment > 0 ? "+" : adjustment < 0 ? "-" : ""}${formatMoney(currency, amount, { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

export function displayedTotals(rule: PricingRule | null | undefined, saved: SavedTotals, rounding = 0) {
  const whole = rule === "whole_aed_v1";
  const displayed = (value: number) => whole ? roundExact2(value) : quotationMoneyValue(value);
  const subtotal = displayed(saved.subtotal);
  const itemDiscount = displayed(saved.discount_total);
  const itemNet = Math.max(saved.subtotal - saved.discount_total, 0);
  const rawExtra = saved.overall_discount_type === "percent"
    ? itemNet * saved.overall_discount_value / 100
    : saved.overall_discount_value;
  const extraDiscount = displayed(whole ? Math.min(Math.max(rawExtra, 0), itemNet) : rawExtra);
  const vat = displayed(saved.vat_amount);
  const grandTotal = displayed(saved.grand_total);
  // Saved legacy totals can have intermediate rounding; reconcile the displayed final and VAT.
  const totalAfterDiscount = whole
    ? roundExact2(subtotal - itemDiscount - extraDiscount)
    : grandTotal - vat;
  return { subtotal, itemDiscount, extraDiscount, totalAfterDiscount, rounding: roundExact2(rounding), vat, grandTotal };
}
