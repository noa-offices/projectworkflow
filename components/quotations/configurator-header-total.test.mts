import assert from "node:assert/strict";
import test from "node:test";
import { formatRuleMoney, quotationLinePricing, ruleConvertedPrice, type PricingRule } from "@/lib/quotation-pricing";
import { configuratorHeaderTotal } from "./configurator-header-total";

function preview({
  rule = "whole_aed_v1",
  source = [["EUR", 882]],
  missingExchangeRate = false,
  discountType = "none",
  discountValue = 0,
  quantity = 1,
}: {
  rule?: PricingRule;
  source?: [string, number][];
  missingExchangeRate?: boolean;
  discountType?: "none" | "percent" | "amount";
  discountValue?: number;
  quantity?: number;
} = {}) {
  const unit = ruleConvertedPrice(rule, 3528.3);
  const line = quotationLinePricing(rule, unit, discountType, discountValue, quantity);
  const beforeDiscount = quotationLinePricing(rule, unit, "amount", 0, quantity);
  const header = configuratorHeaderTotal({
    pricingRule: rule, sourceTotals: new Map(source), missingExchangeRate,
    currency: "AED", quantity, beforeDiscountTotal: beforeDiscount.netTotal, line, discountType,
  });
  return { header, line, beforeDiscount };
}

test("keeps EUR source and the converted quotation total separate", () => {
  const { header } = preview();
  assert.deepEqual(header.source, ["EUR 882.00"]);
  assert.equal(header.quote?.total, "AED 3,528");
  assert.equal(header.quote?.label, "Total");
  assert.equal(header.quote?.previous, null);
});

test("hides incomplete AED estimates and keeps every source currency visible", () => {
  const source: [string, number][] = [["EUR", 882], ["USD", 30], ["AED", 15]];
  const { header } = preview({ source, missingExchangeRate: true, discountType: "percent", discountValue: 10 });
  assert.deepEqual(header.source, ["EUR 882.00", "USD 30.00", "AED 15.00"]);
  assert.equal(header.quote, null);
  assert.equal(header.note, "Add exchange rate to see AED");
  assert.ok(preview({ source }).header.quote);
});

for (const rule of ["whole_aed_v1", "round_up_5_legacy"] as const) {
  test(`${rule}: percent discount shows the confirmation total and original price`, () => {
    const { header, line, beforeDiscount } = preview({ rule, discountType: "percent", discountValue: 10 });
    assert.equal(header.quote?.total, "AED 3,175");
    assert.equal(header.quote?.total, formatRuleMoney(rule, "AED", line.netTotal));
    assert.equal(header.quote?.previous, formatRuleMoney(rule, "AED", beforeDiscount.netTotal));
    assert.equal(header.quote?.previous, rule === "whole_aed_v1" ? "AED 3,528" : "AED 3,530");
    assert.equal(header.quote?.discount, "10%");
  });

  test(`${rule}: fixed discount and quantity greater than one use the priced unit and line total`, () => {
    const { header, line, beforeDiscount } = preview({ rule, discountType: "amount", discountValue: 23, quantity: 3 });
    assert.equal(header.quote?.label, "Line total");
    assert.equal(header.quote?.unit, formatRuleMoney(rule, "AED", line.netPrice));
    assert.equal(header.quote?.total, formatRuleMoney(rule, "AED", line.netTotal));
    assert.equal(header.quote?.previous, formatRuleMoney(rule, "AED", beforeDiscount.netTotal));
    assert.equal(header.quote?.discount, rule === "whole_aed_v1" ? "AED 23 off per unit" : "AED 25 off per unit");
  });
}
