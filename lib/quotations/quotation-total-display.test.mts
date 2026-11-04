import assert from "node:assert/strict";
import test from "node:test";
import { displayedTotals, formatRoundingDifference, lineRoundingAdjustment, roundingAdjustmentFromLayout } from "./quotation-total-display.js";
import { pdfTotalRowKeys } from "./quotation-pdf-pricing.js";
import { normalizeQuotationPdfSettings } from "./quotation-pdf-settings.js";
import { formatRuleMoney, ruleMoneyCell } from "../quotation-pricing.js";

test("total after discount reconciles for both rules and extra discount", () => {
  const worked = displayedTotals("whole_aed_v1", { subtotal: 1554, discount_total: 155, overall_discount_type: "amount", overall_discount_value: 0, vat_amount: 69.95, grand_total: 1468.95 });
  assert.equal(worked.totalAfterDiscount, 1399);
  assert.equal(worked.totalAfterDiscount + worked.vat, worked.grandTotal);
  for (const rule of ["whole_aed_v1", "round_up_5_legacy"] as const) {
    const simple = displayedTotals(rule, { subtotal: 1545, discount_total: 155, overall_discount_type: "amount", overall_discount_value: 0, vat_amount: 69.5, grand_total: 1459.5 });
    assert.equal(simple.totalAfterDiscount, 1390);
    const extra = displayedTotals(rule, { subtotal: 1545, discount_total: 155, overall_discount_type: "amount", overall_discount_value: 50, vat_amount: 67, grand_total: 1407 });
    assert.equal(extra.totalAfterDiscount, 1340);
  }
});

test("rounding difference is informational and a quantity adjustment is carried", () => {
  assert.equal(roundingAdjustmentFromLayout({ price_rounding: { adjustment: 3, rounded_net_prices: { a: 1 } } }), 3);
  assert.equal(roundingAdjustmentFromLayout({ price_rounding: { adjustment: 3, rounded_net_prices: {} } }), 0);
  const totals = displayedTotals("whole_aed_v1", { subtotal: 1554, discount_total: 155, overall_discount_type: "amount", overall_discount_value: 0, vat_amount: 69.95, grand_total: 1468.95 }, 3);
  assert.equal(totals.rounding, 3);
  assert.equal(totals.totalAfterDiscount + totals.vat, totals.grandTotal);
  assert.match(formatRoundingDifference("whole_aed_v1", "AED", -1.5), /^-.*1\.50$/);
  assert.match(formatRoundingDifference(undefined, "AED", 1), /^\+.*1$/);
  const twoItems = displayedTotals("whole_aed_v1", { subtotal: 3090, discount_total: 310, overall_discount_type: "amount", overall_discount_value: 0, vat_amount: 139, grand_total: 2919 }, 2);
  assert.equal(twoItems.totalAfterDiscount, 2780);
  assert.equal(twoItems.totalAfterDiscount + twoItems.vat, twoItems.grandTotal);
  assert.equal(lineRoundingAdjustment(1400, 1399, 3), 3);
  assert.equal(lineRoundingAdjustment(1395, 1399, 2), -8);
});

test("PDF discount ticks select rows in all four combinations; missing ticks keep both visible", () => {
  const old = normalizeQuotationPdfSettings({ orientation: "portrait" });
  assert.equal(old.showItemDiscount, true);
  assert.equal(old.showExtraDiscount, true);
  assert.deepEqual(pdfTotalRowKeys(old, true), ["subtotal", "itemDiscount", "extraDiscount", "totalAfterDiscount", "vat", "grandTotal"]);
  assert.deepEqual(pdfTotalRowKeys({ ...old, showItemDiscount: false }, true), ["extraDiscount", "totalAfterDiscount", "vat", "grandTotal"]);
  assert.deepEqual(pdfTotalRowKeys({ ...old, showExtraDiscount: false }, true), ["itemDiscount", "totalAfterDiscount", "vat", "grandTotal"]);
  assert.deepEqual(pdfTotalRowKeys({ ...old, showItemDiscount: false, showExtraDiscount: false }, true), ["totalAfterDiscount", "vat", "grandTotal"]);
  assert.deepEqual(pdfTotalRowKeys(old, false, true), ["subtotal", "itemDiscount", "totalAfterDiscount", "rounding", "vat", "grandTotal"]);
});

test("whole AED fractional amounts use two decimals and legacy fixed values stay", () => {
  assert.equal(ruleMoneyCell("whole_aed_v1", 69.5), "69.50");
  assert.equal(ruleMoneyCell("whole_aed_v1", 1390), "1,390");
  assert.match(formatRuleMoney("whole_aed_v1", "AED", 1459.5), /1,459\.50$/);
  assert.equal(ruleMoneyCell(undefined, 69.5), "70");
  assert.equal(ruleMoneyCell("round_up_5_legacy", 1390), "1,390");
});
