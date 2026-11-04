import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LEGACY_PRICING_RULE, NEW_QUOTATION_PRICING_RULE, formatRuleMoney, quotationLinePricing, quotationMoneyValue, readPricingRule, roundExact2, roundWholeHalfUp, ruleConvertedPrice, ruleExactAmount, ruleMoneyCell, wholeAedLinePricing, wholeAedTotals, withPricingRule,
} from "./quotation-pricing.js";
import { branchLayoutSettings, newEnquiryCopyLayoutSettings } from "./quotations/quotation-layout-copy.js";

const WHOLE = "whole_aed_v1" as const;

test("the rule: missing, null or unknown is legacy; new quotations get whole AED", () => {
  for (const value of [undefined, null, "", {}, { pricing_rule: null }, { pricing_rule: "other" }, { pricing_rule: 5 }, []]) assert.equal(readPricingRule(value), LEGACY_PRICING_RULE);
  assert.equal(readPricingRule({ pricing_rule: "round_up_5_legacy" }), LEGACY_PRICING_RULE);
  assert.equal(readPricingRule({ pricing_rule: WHOLE }), WHOLE);
  assert.equal(NEW_QUOTATION_PRICING_RULE, WHOLE);
  assert.deepEqual(withPricingRule({ a: 1 }, WHOLE), { a: 1, pricing_rule: WHOLE });
});

test("half up to a whole number", () => {
  assert.equal(roundWholeHalfUp(155.5), 156); assert.equal(roundWholeHalfUp(155.4), 155); assert.equal(roundWholeHalfUp(1554.064), 1554);
  assert.equal(roundWholeHalfUp(379.04 * 4.1), 1554); // 1554.0639999999999
  assert.equal(roundWholeHalfUp(2.4999999999999), 2 + 1); // a binary fraction of 2.5 still goes up
  assert.equal(roundExact2(1.005), 1.01); assert.equal(roundExact2(69.975), 69.98);
});

test("example 1: EUR 379.04, rate 4.1, discount 10%: price 1,554, discount 155, net 1,399", () => {
  const price = ruleConvertedPrice(WHOLE, 379.04 * 4.1);
  assert.equal(price, 1554);
  assert.deepEqual(wholeAedLinePricing(price, "percent", 10, 1), { unitPrice: 1554, discountValue: 10, discountAmount: 155, netPrice: 1399, netTotal: 1399 });
});

test("example 2: price 1,555 with discount 10%: discount 156, net 1,399", () => {
  assert.deepEqual(quotationLinePricing(WHOLE, 1555, "percent", 10, 1), { unitPrice: 1555, discountValue: 10, discountAmount: 156, netPrice: 1399, netTotal: 1399 });
});

test("whole AED lines: typed price kept, amount discount whole, zero or negative discount, quantity above 1", () => {
  assert.equal(quotationLinePricing(WHOLE, 1554.5, "percent", 10, 1).unitPrice, 1554.5); // typed by hand: kept
  assert.equal(quotationLinePricing(WHOLE, 1554.5, "percent", 10, 1).discountAmount, 155);
  assert.equal(quotationLinePricing(WHOLE, 1554.5, "percent", 10, 1).netPrice, 1399.5);
  assert.deepEqual(quotationLinePricing(WHOLE, 1000, "amount", 155.5, 2), { unitPrice: 1000, discountValue: 156, discountAmount: 156, netPrice: 844, netTotal: 1688 });
  assert.deepEqual(quotationLinePricing(WHOLE, 1000, "amount", 155.4, 1), { unitPrice: 1000, discountValue: 155, discountAmount: 155, netPrice: 845, netTotal: 845 });
  for (const discount of [0, -10]) assert.deepEqual(quotationLinePricing(WHOLE, 500, "amount", discount, 3), { unitPrice: 500, discountValue: 0, discountAmount: 0, netPrice: 500, netTotal: 1500 });
  assert.equal(quotationLinePricing(WHOLE, 500, "percent", -5, 1).discountAmount, 0);
  assert.equal(quotationLinePricing(WHOLE, 50, "amount", 60, 1).netPrice, 0); // never below zero
  assert.equal(quotationLinePricing(WHOLE, 500, "none", 40, 1).discountAmount, 0);
  assert.equal(quotationLinePricing(WHOLE, 100, "percent", 150, 1).discountAmount, 100);
});

test("whole AED totals: exact sum of lines, VAT and grand total at 2 decimals, nothing to 5", () => {
  const line = quotationLinePricing(WHOLE, 1554, "percent", 10, 3);
  const totals = wholeAedTotals({ lines: [{ qty: 3, unitPrice: line.unitPrice, netTotal: line.netTotal }], overallDiscountType: "amount", overallDiscountValue: 0, vatPercent: 5 });
  assert.deepEqual(totals, { subtotal: 4662, discount_total: 465, overall_discount_amount: 0, net_total: 4197, vat_amount: 209.85, grand_total: 4406.85 });
  const single = wholeAedTotals({ lines: [{ qty: 1, unitPrice: 1554, netTotal: 1399 }], overallDiscountType: "amount", overallDiscountValue: 0, vatPercent: 5 });
  assert.equal(single.vat_amount, 69.95); assert.equal(single.grand_total, 1468.95);
  const overall = wholeAedTotals({ lines: [{ qty: 1, unitPrice: 1000, netTotal: 1000 }], overallDiscountType: "percent", overallDiscountValue: 2.5, vatPercent: 5 });
  assert.equal(overall.overall_discount_amount, 25); assert.equal(overall.net_total, 975); assert.equal(overall.vat_amount, 48.75); assert.equal(overall.grand_total, 1023.75);
});

test("legacy lines are unchanged: today's outputs for realistic items", () => {
  const cases: Array<[number, string, number, number, object]> = [
    [1554.064, "percent", 10, 1, { unitPrice: 1555, discountValue: 10, discountAmount: 160, netPrice: 1395, netTotal: 1395 }],
    [320, "amount", 12, 3, { unitPrice: 320, discountValue: 15, discountAmount: 15, netPrice: 305, netTotal: 915 }],
    [1000, "percent", 7.5, 2, { unitPrice: 1000, discountValue: 7.5, discountAmount: 75, netPrice: 925, netTotal: 1850 }],
    [99.9, "amount", 0, 5, { unitPrice: 100, discountValue: 0, discountAmount: 0, netPrice: 100, netTotal: 500 }],
    [328.57, "percent", 3, 1, { unitPrice: 330, discountValue: 3, discountAmount: 10, netPrice: 320, netTotal: 320 }],
    [50, "amount", 60, 1, { unitPrice: 50, discountValue: 60, discountAmount: 60, netPrice: 0, netTotal: 0 }],
  ];
  for (const [price, type, value, qty, expected] of cases) {
    assert.deepEqual(quotationLinePricing(LEGACY_PRICING_RULE, price, type, value, qty), expected);
    assert.deepEqual(quotationLinePricing(undefined, price, type, value, qty), expected); // no rule at all
  }
});

test("legacy displays and amounts are unchanged", () => {
  for (const value of [0, 1, 1395, 1399.5, 1469.48, 328.57]) {
    assert.equal(ruleConvertedPrice(LEGACY_PRICING_RULE, value), quotationMoneyValue(value));
    assert.equal(ruleExactAmount(undefined, value), quotationMoneyValue(value));
  }
  assert.equal(ruleMoneyCell(undefined, 1399.5), "1,400");
  assert.match(formatRuleMoney(LEGACY_PRICING_RULE, "AED", 1399.5), /1,400$/);
  assert.equal(ruleMoneyCell(WHOLE, 1399.5), "1,399.50");
  assert.match(formatRuleMoney(WHOLE, "AED", 1468.95), /1,468\.95$/);
  assert.equal(ruleExactAmount(WHOLE, 1468.95), 1468.95); // the Project File total is exact
  assert.equal(ruleExactAmount(LEGACY_PRICING_RULE, 1469.48), 1470);
});

test("mixed quotation list rows use their own saved pricing rule", () => {
  const rows = [
    { currency: "AED", grand_total: 1468.95, layout_settings: null },
    { currency: "AED", grand_total: 1468.95, layout_settings: { pricing_rule: "whole_aed_v1" } },
    { currency: "AED", grand_total: 1468.95, layout_settings: { pricing_rule: "unknown" } },
  ];
  assert.deepEqual(rows.map((row) => formatRuleMoney(readPricingRule(row.layout_settings), row.currency, row.grand_total)), [
    formatRuleMoney(LEGACY_PRICING_RULE, "AED", 1468.95),
    formatRuleMoney(WHOLE, "AED", 1468.95),
    formatRuleMoney(LEGACY_PRICING_RULE, "AED", 1468.95),
  ]);
  assert.equal(ruleMoneyCell(WHOLE, 1468.95), "1,468.95");
  assert.equal(ruleMoneyCell(undefined, 1468.95), "1,470");
  assert.equal(ruleMoneyCell(WHOLE, 1_234_567_890.55), "1,234,567,890.55");
});

test("revisions, options and copies keep the source's rule; a legacy source stays legacy", () => {
  const whole = withPricingRule({ documentSetup: { a: 1 }, projectFile: { orderNo: "x" } }, WHOLE);
  assert.equal(readPricingRule(branchLayoutSettings(whole, { quotationType: "revision" })), WHOLE);
  assert.equal(readPricingRule(newEnquiryCopyLayoutSettings(whole)), WHOLE);
  assert.equal("projectFile" in newEnquiryCopyLayoutSettings(whole), false);
  for (const legacy of [{ documentSetup: {} }, null, undefined]) {
    assert.equal(readPricingRule(branchLayoutSettings(legacy, { quotationType: "option" })), LEGACY_PRICING_RULE);
    assert.equal(readPricingRule(newEnquiryCopyLayoutSettings(legacy)), LEGACY_PRICING_RULE);
  }
});

test("the create action gives a new quotation the new rule, and a copy uses the source's settings", () => {
  const actions = readFileSync(new URL("../app/quotations/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /mergeDocumentSetupIntoLayoutSettings\(\s*withPricingRule\(\{\}, NEW_QUOTATION_PRICING_RULE\),/);
  assert.equal(actions.split("NEW_QUOTATION_PRICING_RULE").length - 1, 2); // the import and the one create path
  assert.match(actions, /: source\.layout_settings \?\? \{\}\),/); // a locked source is stripped of its Project File by lockedSourceCopySettings; the rule stays
  assert.match(actions, /total: ruleExactAmount\(readPricingRule\(quotation\.layout_settings\), quotation\.grand_total \?\? 0\)/);
});

test("the actions use the quotation's rule; whole AED change detection and the audit log compare exact numbers", () => {
  const actions = readFileSync(new URL("../app/quotations/actions.ts", import.meta.url), "utf8");
  assert.ok(actions.includes("return (value: unknown) => ruleExactAmount(pricingRule, value);"));
  assert.equal(actions.split("const quotationMoneyValue = priceHistoryValue(pricingRule);").length - 1, 2); // change detection and the writer
  const callers = actions.split("await insertQuotationItemPriceHistory({").slice(1);
  assert.equal(callers.length, 5);
  for (const caller of callers) assert.match(caller.slice(0, 60), /^\s+pricingRule: /); // every caller passes the rule
  assert.notEqual(ruleExactAmount("whole_aed_v1", 1401), ruleExactAmount("whole_aed_v1", 1403));
  assert.equal(ruleExactAmount(undefined, 1401), ruleExactAmount(undefined, 1403)); // legacy reads them as the same, as today
  assert.ok(actions.includes('readPricingRule(quotation.layout_settings) === "whole_aed_v1"')); // recalculateQuotationTotals
});

test("the builders pass the rule to the Product Library, the row editor and the manual conversion", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const local = read("../components/quotations/local-quotation-builder.tsx"), shared = read("../app/quotations/[id]/builder/page.tsx");
  assert.equal(local.match(/^\s+pricingRule=\{readPricingRule\(workspace\.layout_settings\)\}$/gm)?.length, 2);
  assert.ok(shared.includes("const pricingRule = readPricingRule(quotation.layout_settings);"));
  assert.ok(shared.includes("<ProductLibrarySelector\n          pricingRule={readPricingRule(quotation.layout_settings)}"));
  assert.equal(shared.split("<QuotationRowEditorProvider\n").length - 1, shared.split("<QuotationRowEditorProvider\n                              pricingRule={item.pricing_rule}").length - 1);
  assert.ok(shared.includes("pricingRule={manualItem.pricing_rule}"));
  assert.ok(shared.includes('step={item.pricing_rule === "whole_aed_v1" ? "any" : "5"}')); // a typed whole-AED price is not forced to a multiple of 5
  assert.ok(local.includes("net selling price to the nearest step. The saved unit price"));
});
