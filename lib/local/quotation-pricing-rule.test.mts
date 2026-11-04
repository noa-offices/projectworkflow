import assert from "node:assert/strict";
import test from "node:test";
import { wholeAedTotals } from "../quotation-pricing.js";
import { preparePublication } from "./quotation-publication-payload.js";
import { createWorkspaceFromServerSnapshot, itemLinePricing, layoutSettingsWithPriceRounding, publishedPriceRounding, recalculateWorkspace, workspaceItemDisplayPricing, workspaceTotals, type LocalQuotationItem, type LocalQuotationWorkspace, type ServerQuotationWorkspaceSource } from "./quotation-workspace.js";

const item = (id: string, extra: Partial<LocalQuotationItem> = {}) => ({ id, quotation_id: "q", section_id: "s", item_type: "product", qty: 1, unit_price: 1555, discount_type: "percent", discount_value: 10, net_price: 0, net_total: 0, currency: "AED", is_active: true, is_rate_only: false, is_optional: false, include_in_total: true, line_style: "normal", sort_order: 10, ...extra }) as LocalQuotationItem;
const source = (layout: unknown, items: LocalQuotationItem[]): ServerQuotationWorkspaceSource => ({
  quotation: { id: "q", client_id: "c", project_id: null, quotation_no: "Q1", title: "T", status: "draft", quotation_date: "2026-11-04", currency: "AED", vat_percent: 5, layout_mode: "standard", layout_settings: layout, overall_discount_type: "amount", overall_discount_value: 0 },
  client: null, project: null, sections: [], items,
});
const open = (layout: unknown, items: LocalQuotationItem[]) => createWorkspaceFromServerSnapshot(source(layout, items));

test("a legacy local line stays exactly as today: exact discount, net with decimals", () => {
  assert.deepEqual(itemLinePricing(item("a")), { unitPrice: 1555, discountValue: 10, netPrice: 1399.5, netTotal: 1399.5 });
  const workspace = open({ documentSetup: {} }, [item("a")]);
  assert.equal(workspace.items[0].net_price, 1399.5);
  assert.deepEqual(workspace.totals, { subtotal: 1555, discount_total: 155.5, overall_discount_amount: 0, net_total: 1399.5, vat_amount: 69.97, grand_total: 1469.47 });
});

test("legacy totals for five realistic items match today's numbers", () => {
  const items = [item("a"), item("b", { qty: 3, unit_price: 320, discount_type: "amount", discount_value: 12 }), item("c", { qty: 2, unit_price: 1000, discount_value: 7.5 }), item("d", { qty: 5, unit_price: 99.9, discount_type: "none", discount_value: 0 }), item("e", { unit_price: 330, discount_value: 3 })];
  assert.deepEqual(open(null, items).totals, { subtotal: 5344.5, discount_total: 351.4, overall_discount_amount: 0, net_total: 4993.1, vat_amount: 249.66, grand_total: 5242.76 });
});

test("a whole AED local line: discount 156, net 1,399, and the totals agree with the shared builder's", () => {
  const workspace = open({ pricing_rule: "whole_aed_v1" }, [item("a"), item("b", { qty: 3, unit_price: 1554 })]);
  assert.equal(workspace.items[0].net_price, 1399); assert.equal(workspace.items[0].net_total, 1399);
  assert.equal(workspace.items[1].net_price, 1399); assert.equal(workspace.items[1].net_total, 4197);
  assert.deepEqual(workspace.totals, wholeAedTotals({ lines: workspace.items.map((row) => ({ qty: row.qty, unitPrice: row.unit_price, netTotal: row.net_total })), overallDiscountType: "amount", overallDiscountValue: 0, vatPercent: 5 }));
  assert.equal(workspace.totals.vat_amount, 279.8); assert.equal(workspace.totals.grand_total, 5875.8);
  assert.equal(workspaceTotals(workspace).grand_total, 5875.8);
  assert.equal(workspaceItemDisplayPricing(workspace, workspace.items[0]).discountAmount, 156);
});

test("a typed price in a whole AED draft is kept as typed", () => {
  const workspace = open({ pricing_rule: "whole_aed_v1" }, [item("a", { unit_price: 1554.5 })]);
  assert.equal(workspace.items[0].unit_price, 1554.5); assert.equal(workspace.items[0].net_price, 1399.5);
});

test("the rule is published with the quotation, and the local draft keeps it", () => {
  const layout = { pricing_rule: "whole_aed_v1", documentSetup: { a: 1 } };
  const workspace = open(layout, [item("a")]);
  assert.deepEqual(workspace.layout_settings, layout);
  const published = preparePublication(workspace as LocalQuotationWorkspace, "u");
  assert.deepEqual(published.quotation.layout_settings, layout);
});

test("publication: a legacy quotation's payload keeps today's discount total; whole AED stores the item discount like the shared builder", () => {
  const withOverall = (layout: unknown) => recalculateWorkspace({ ...open(layout, [item("a")]), overall_discount_type: "amount", overall_discount_value: 100 });
  assert.equal(preparePublication(withOverall(null), "u").quotation.discount_total, 255.5);
  assert.equal(preparePublication(withOverall({ pricing_rule: "whole_aed_v1" }), "u").quotation.discount_total, 156);
});

test("Price Rounding is published and comes back when the quotation is opened from the server", () => {
  const applied = recalculateWorkspace({ ...open(null, [item("a")]), metadata: { price_rounding: { rounded_net_prices: { a: 1400 }, step: 5, last_applied_step: 5 } } });
  assert.equal(applied.items[0].unit_price, 1555); assert.equal(applied.items[0].net_price, 1400); // the saved unit price is kept
  const published = preparePublication(applied, "u");
  assert.deepEqual((published.quotation.layout_settings as { price_rounding: { rounded_net_prices: object } }).price_rounding.rounded_net_prices, { a: 1400 });
  const reopened = open(published.quotation.layout_settings, [item("a", { net_price: 1400, net_total: 1400 })]);
  assert.equal(reopened.items[0].net_price, 1400); assert.equal(reopened.totals.net_total, 1400);
});

test("Price Rounding: nothing is added when unused, Restore removes it, and a line edited elsewhere drops its rounding", () => {
  const plain = { documentSetup: {} };
  assert.equal(layoutSettingsWithPriceRounding(plain, {}), plain); // the same object: an unrounded quotation's settings are untouched
  assert.equal(layoutSettingsWithPriceRounding(null, undefined), null);
  assert.deepEqual(layoutSettingsWithPriceRounding({ a: 1, price_rounding: { rounded_net_prices: { x: 1 } } }, { price_rounding: { rounded_net_prices: {} } }), { a: 1 });
  assert.deepEqual(publishedPriceRounding(plain, [item("a")]), {});
  assert.deepEqual(publishedPriceRounding({ price_rounding: { rounded_net_prices: { a: 1400 } } }, [item("a", { net_price: 1395 })]), {});
  assert.equal(open({ price_rounding: { rounded_net_prices: { a: 1400 } } }, [item("a", { net_price: 1395 })]).items[0].net_price, 1399.5);
});
