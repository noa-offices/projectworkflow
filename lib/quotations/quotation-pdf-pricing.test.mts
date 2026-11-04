import assert from "node:assert/strict";
import test from "node:test";
import { pdfLineAmounts, pdfTotals } from "./quotation-pdf-pricing.js";

test("whole AED PDF line and summary agree with the saved builder amounts", () => {
  const line = pdfLineAmounts("whole_aed_v1", { unit_price: 1554, discount_type: "percent", discount_value: 10, net_price: 1399, net_total: 1399, qty: 1 });
  const totals = pdfTotals("whole_aed_v1", { subtotal: 1554, discount_total: 155, vat_amount: 69.95, grand_total: 1468.95, overall_discount_type: "amount", overall_discount_value: 0 });
  assert.equal(line.unitPrice - line.discountAmount, line.netPrice);
  assert.equal(line.netTotal, totals.subtotal - totals.itemDiscount);
  assert.equal(totals.grandTotal, totals.netAfterDiscount + totals.vat);
  assert.deepEqual(totals, { subtotal: 1554, itemDiscount: 155, overallDiscount: 0, netAfterDiscount: 1399, vat: 69.95, grandTotal: 1468.95 });
});

test("legacy PDF values match the original percent and amount formulas", () => {
  assert.deepEqual(pdfLineAmounts(undefined, { unit_price: 1554, discount_type: "percent", discount_value: 10, net_price: 1399, net_total: 2798, qty: 2 }), {
    unitPrice: 1554, discountAmount: 310, netPrice: 1399, netTotal: 2798,
  });
  assert.deepEqual(pdfTotals(undefined, { subtotal: 1554, discount_total: 155, vat_amount: 70, grand_total: 1470, overall_discount_type: "percent", overall_discount_value: 10 }), {
    subtotal: 1554, itemDiscount: 155, overallDiscount: 139.9, netAfterDiscount: 1259.1, vat: 70, grandTotal: 1470,
  });
});

test("whole AED PDF sections sum saved net totals across quantities", () => {
  const rows = [
    pdfLineAmounts("whole_aed_v1", { unit_price: 1554, discount_type: "percent", discount_value: 10, net_price: 1399, net_total: 1399, qty: 1 }),
    pdfLineAmounts("whole_aed_v1", { unit_price: 200.25, discount_type: "amount", discount_value: 20, net_price: 180.25, net_total: 360.5, qty: 2 }),
  ];
  const sectionSubtotal = rows.reduce((sum, row) => sum + row.netTotal, 0);
  const totals = pdfTotals("whole_aed_v1", { subtotal: 1954.5, discount_total: 195, vat_amount: 87.98, grand_total: 1847.48, overall_discount_type: "amount", overall_discount_value: 0 });
  assert.equal(sectionSubtotal, totals.subtotal - totals.itemDiscount);
  assert.equal(totals.grandTotal, sectionSubtotal + totals.vat);
});
