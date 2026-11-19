import { formatMoney } from "@/lib/currencies";
import { formatRuleMoney, type LinePricing, type PricingRule } from "@/lib/quotation-pricing";

/** Formats the selector's priced preview for display. All amounts are supplied by the caller. */
export function configuratorHeaderTotal({
  pricingRule, sourceTotals, missingExchangeRate, currency, quantity, beforeDiscountTotal, line, discountType, formatQuoteAmount,
}: {
  pricingRule?: PricingRule;
  sourceTotals: ReadonlyMap<string, number>;
  missingExchangeRate: boolean;
  currency: string;
  quantity: number;
  beforeDiscountTotal: number;
  line: LinePricing;
  discountType: string;
  formatQuoteAmount?: (amount: number) => string;
}) {
  const source = Array.from(sourceTotals, ([code, amount]) => formatMoney(code, amount));
  if (missingExchangeRate) return { source, note: "Add exchange rate to see AED", quote: null };

  const money = formatQuoteAmount ?? ((amount: number) => formatRuleMoney(pricingRule, currency, amount));
  const hasDiscount = discountType !== "none" && line.discountAmount > 0;
  const multiple = quantity > 1;
  const discount = discountType === "percent"
    ? `${line.discountValue}%`
    : `${money(line.discountAmount)} off${multiple ? " per unit" : ""}`;

  return {
    source,
    note: null,
    quote: {
      label: multiple ? "Line total" : "Total",
      unit: multiple ? money(line.netPrice) : null,
      total: money(line.netTotal),
      previous: hasDiscount ? money(beforeDiscountTotal) : null,
      discount: hasDiscount ? discount : null,
    },
  };
}
