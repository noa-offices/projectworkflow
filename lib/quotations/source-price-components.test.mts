import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { QUOTE_ROUNDING_STEP, quotationMoneyValue } from "../quotation-pricing.js";
import { currentSystemPricing, systemPriceContribution, systemSelectedOptionSnapshot } from "./native-system-base.js";
import { baseModelPriceOrDefault, missingExchangeRateCurrencies, rawSourceLine, roundSourceAmount, sameCurrencyUnitSum, sumSourceLines } from "./source-price-components.js";

const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
const actions = readFileSync("app/quotations/actions.ts", "utf8");
const builder = readFileSync("app/quotations/[id]/builder/page.tsx", "utf8");

// acceptance case: default 1, System 377 x 2, Main 334, companion 80, accessory 26 x 2
const systemRow = { price: 377, currency: "EUR" };
const lines = () => ({
  system: rawSourceLine(systemPriceContribution(systemRow, "EUR", 2).unitPrice, 2),
  main: rawSourceLine(baseModelPriceOrDefault(334, 1), 1),
  companion: rawSourceLine(80, 1),
  accessory: rawSourceLine(26, 2),
});

// ---- price display ----
test("1-5: component lines show raw source amounts (334 stays 334, 26 x 2 = 52) and sum to the raw source total", () => {
  const { system, main, companion, accessory } = lines();
  assert.equal(main.total, 334);
  assert.notEqual(main.total, quotationMoneyValue(334));
  assert.deepEqual([system.unitPrice, system.quantity, system.total], [377, 2, 754]);
  assert.deepEqual([accessory.unitPrice, accessory.quantity, accessory.total], [26, 2, 52]);
  assert.equal(companion.total, 80);
  assert.equal(sumSourceLines([system, main, companion, accessory]), 1220);
});

// ---- default price ----
test("6-8: a priced Main row replaces the template default; null falls back to the default; 0 is a real price", () => {
  assert.equal(baseModelPriceOrDefault(334, 1), 334);
  assert.equal(baseModelPriceOrDefault(null, 1), 1);
  assert.equal(baseModelPriceOrDefault(undefined, 1), 1);
  assert.equal(baseModelPriceOrDefault(0, 1), 0);
  // client and server use the same replacement semantics
  assert.ok(selector.includes("selectedVariantRow?.price ??"));
  assert.ok(actions.includes("baseModelPriceOrDefault(selectedVariantPricingRow.price ?? null, template.default_unit_price)"));
});

// ---- system ----
test("9-10: System 377 x 2 + Main 334 = 1088, and the full acceptance case is 1220 with the default contributing 0", () => {
  const { system, main, companion, accessory } = lines();
  assert.equal(system.total + main.total, 1088);
  assert.equal(sumSourceLines([system, main, companion, accessory]), 1220);
  assert.equal(sumSourceLines([system, main, companion, accessory]) - (754 + 334 + 80 + 52), 0, "the template default of 1 adds nothing");
});

// ---- rounding ----
test("11-13: component lines never call quotationMoneyValue; the final quotation still does; the policy is unchanged", () => {
  const start = selector.indexOf("const mainItemUnitPrice = ");
  const end = selector.indexOf("const sourceTotalsList");
  const componentRegion = selector.slice(start, end);
  assert.equal(componentRegion.includes("quotationMoneyValue("), false, "component summaries use raw source amounts");
  assert.ok(componentRegion.includes("roundSourceAmount("));
  assert.ok(selector.includes("const previewUnitPriceWithConversion = quotationMoneyValue(rawPreviewUnitPriceWithConversion);"));
  assert.ok(actions.includes("const unitPrice = quotationMoneyValue(rawUnitPrice);"));
  assert.equal(QUOTE_ROUNDING_STEP, 5);
  assert.equal(quotationMoneyValue(334), 335);
  assert.equal(quotationMoneyValue(1220), 1220);
  assert.equal(roundSourceAmount(334), 334);
});

// ---- workstation ----
test("14-15: the Workstation variant price is in the server AED-only sum exactly once and matches the client sum", () => {
  const parts = { base: 1200, system: 0, workstationVariant: 150, accessories: 26, linked: 0 };
  assert.equal(sameCurrencyUnitSum(parts), 1376);
  const clientSum = roundSourceAmount(parts.base + parts.workstationVariant + parts.system + parts.accessories + parts.linked);
  assert.equal(sameCurrencyUnitSum(parts), clientSum);
  assert.ok(actions.includes("workstationVariant: matchingWorkstationVariantTotal"));
  assert.equal(actions.split("matchingWorkstationVariantTotal").length - 1, 2, "defined once, used once in the sum");
});

// ---- currency ----
test("16-19: a missing EUR->AED rate is a missing-rate state; hints, disabled action and the EUR source total remain", () => {
  const totals = new Map([["EUR", 1220]]);
  assert.deepEqual(missingExchangeRateCurrencies(totals, {}), ["EUR"]);
  assert.deepEqual(missingExchangeRateCurrencies(totals, { EUR: "0" }), ["EUR"]);
  assert.deepEqual(missingExchangeRateCurrencies(totals, { EUR: "4.1" }), []);
  assert.deepEqual(missingExchangeRateCurrencies(new Map([["AED", 500]]), {}), []);
  assert.ok(selector.includes('Enter an exchange rate for {missingExchangeRateCurrencyList.join(", ")} to calculate the AED total.'));
  assert.ok(selector.includes('"Quotation unit price: awaiting exchange rate"'));
  assert.equal(selector.split("disabled={missingExchangeRate ||").length - 1, 2, "both Add actions stay disabled without a rate");
  assert.ok(selector.includes("Exact configured unit in source currency, before conversion and quotation rounding."));
  assert.ok(selector.includes("{sourceTotalsList.map((line) => ("), "the EUR source total renders independently of the exchange-rate state");
});

// ---- snapshot / recompute ----
test("20-22: snapshots keep raw component prices; recompute sums raw amounts, then applies the final rounding once; nothing is double counted", () => {
  const mirror = systemSelectedOptionSnapshot("g", { id: "sys", price: 377 }, 2) as Record<string, unknown>;
  assert.equal("price" in mirror, false, "the selected_options mirror carries no price (system_pricing owns it)");
  assert.equal("id" in mirror, false);
  const priced = currentSystemPricing({ system_pricing: { group_id: "g", quantity: 2, row: { id: "sys" } } }, [{ id: "sys", price: 377, currency: "EUR" }]);
  assert.equal(priced.kind === "ok" ? priced.total : null, 754, "raw System total, not rounded per line");
  const raw = 334 + 754 + 52 + 80;
  assert.equal(quotationMoneyValue(raw), 1220);
  assert.equal(quotationMoneyValue(334) + quotationMoneyValue(754) + quotationMoneyValue(52) + quotationMoneyValue(80), 1225, "rounding lines first would inflate the total");
  assert.ok(actions.includes("price: quotationMoneyValue(sourcePrice + systemTotal + componentTotal + accessoryTotal)"));
  assert.ok(builder.includes("sourcePrice: quotationMoneyValue(sourcePrice + systemTotal + componentOptionsTotal + accessoryTotal)"));
});

// ---- regression ----
test("23-27: ordinary Base/Model, Matrix, Modular and Workstation base formulas and System quantity behavior are unchanged", () => {
  assert.ok(selector.includes("selectedVariantRow?.price ??\n                        template.default_unit_price;") || selector.includes("selectedVariantRow?.price ??"));
  assert.ok(selector.includes("(selectedCategoryRow ? selectedCategoryPrice : undefined) ??"), "Matrix replacement branch");
  assert.ok(selector.includes("selectedModularItems.reduce((total, line) => total + line.total, 0)"), "Modular sum branch");
  assert.ok(selector.includes("derivedDesking?.unitPrice ??"), "Workstation replacement branch");
  assert.equal(systemPriceContribution(systemRow, "EUR", 2).amount, 754);
  assert.equal(systemPriceContribution(null, "EUR", 2).amount, 0);
});
