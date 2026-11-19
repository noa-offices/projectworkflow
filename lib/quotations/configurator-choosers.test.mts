import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveProductConfigurationState } from "../products/product-configuration-state";
import { configuratorChoosers } from "./configurator-choosers";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const selector = read("../../components/quotations/product-library-selector.tsx");

// The flags exactly as the selector computes them: usesVariantPricing excludes the workstation flow; usesCategoryPricing excludes
// Base / Model and modular pricing.
function flags(input: { workstation?: boolean; modular?: boolean; variantRows?: boolean; categoryRows?: boolean }) {
  const usesWorkstationFlow = Boolean(input.workstation);
  const usesVariantPricing = !usesWorkstationFlow && Boolean(input.variantRows);
  const usesModularPricing = Boolean(input.modular);
  const usesCategoryPricing = !usesVariantPricing && !usesModularPricing && Boolean(input.categoryRows);
  return { usesWorkstationFlow, usesVariantPricing, usesModularPricing, usesCategoryPricing };
}
const shown = (input: Parameters<typeof flags>[0]) => configuratorChoosers(flags(input));

test("modular only (with a legacy Base / Model list): no Base / Model chooser, no Price Matrix", () => {
  assert.deepEqual(shown({ modular: true, variantRows: true }), { showBaseModelChooser: false, showPriceMatrixChooser: false });
  assert.deepEqual(shown({ modular: true, variantRows: true, categoryRows: true }), { showBaseModelChooser: false, showPriceMatrixChooser: false });
});

test("workstation only (with legacy Base / Model and category rows): neither chooser", () => {
  assert.deepEqual(shown({ workstation: true, variantRows: true }), { showBaseModelChooser: false, showPriceMatrixChooser: false });
  assert.deepEqual(shown({ workstation: true, categoryRows: true }), { showBaseModelChooser: false, showPriceMatrixChooser: false });
  assert.deepEqual(shown({ workstation: true, variantRows: true, categoryRows: true }), { showBaseModelChooser: false, showPriceMatrixChooser: false });
});

test("modular and workstation together: neither chooser", () => {
  assert.deepEqual(shown({ workstation: true, modular: true, variantRows: true, categoryRows: true }), { showBaseModelChooser: false, showPriceMatrixChooser: false });
});

test("NEITHER modular nor workstation: Base / Model and Price Matrix show exactly as before", () => {
  assert.deepEqual(shown({ variantRows: true }), { showBaseModelChooser: true, showPriceMatrixChooser: false }, "Base / Model product");
  assert.deepEqual(shown({ categoryRows: true }), { showBaseModelChooser: false, showPriceMatrixChooser: true }, "Price Matrix product");
  assert.deepEqual(shown({ variantRows: true, categoryRows: true }), { showBaseModelChooser: true, showPriceMatrixChooser: false }, "Base / Model wins over the matrix, as the price order says");
  assert.deepEqual(shown({}), { showBaseModelChooser: false, showPriceMatrixChooser: false }, "a plain template has neither");
});

test("the selector uses the helper and its two flags; the flags the price uses are unchanged", () => {
  assert.match(selector, /const \{ showBaseModelChooser, showPriceMatrixChooser \} = configuratorChoosers\(\{ usesWorkstationFlow, usesVariantPricing, usesModularPricing, usesCategoryPricing \}\);/);
  // The existing definitions the price and the recipe read are exactly as before (no second rule, no price change).
  assert.match(selector, /const usesVariantPricing = !usesWorkstationFlow && variantRows\.length > 0;/);
  assert.match(selector, /const usesModularPricing = modularRows\.length > 0;/);
  assert.match(selector, /const usesCategoryPricing = !usesVariantPricing && !usesModularPricing && categoryRows\.length > 0;/);
  assert.match(selector, /\{showPriceMatrixChooser \? \(\s*<div className="mt-3 grid gap-2 md:grid-cols-2">/, "the Price Matrix chooser is gated");
  assert.match(selector, /\{showBaseModelChooser \? \(<>\s*<p className="text-xs font-bold uppercase tracking-wide text-zinc-700">\s*\{nativeSystem\.active \? "Main Product" : "Base Size \/ Main Price"\}/, "the Base / Model chooser is gated");
  assert.match(selector, /\{showBaseModelChooser && selectedVariantRow \? \(\s*<div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">/, "and so is its summary");
});

test("nothing blocks the Add button for the hidden Base / Model; System / Base stays and still gates as before", () => {
  assert.match(selector, /const missingRequiredSystemSelection = usesVariantPricing && nativeSystem\.requiresSystem && \(!nativeSystem\.selected \|\| \(showBaseModelChooser && !selectedVariantRow\)\);/);
  assert.match(selector, /\{usesVariantPricing && \(showBaseModelChooser \|\| nativeSystem\.active\) \? \(/, "the System / Base selectors still render when the Main Product chooser is hidden");
  // The only Add-button gates are workstation size, System / Base, a modular selection and accessories: never Base / Model.
  assert.match(selector, /disabled=\{missingExchangeRate \|\| missingRequiredWorkstationSelection \|\| missingRequiredSystemSelection \|\| missingRequiredModularSelection/);
  assert.doesNotMatch(selector, /Base \/ Model required|Select a Base \/ Model/);
  // The configurator does not use the engine's required-step flag at all.
  assert.doesNotMatch(selector, /resolveProductConfigurationState|nextRequiredStep/);
});

// ── price regression: a recipe with BOTH modular quantities and a legacy variant_row_id prices exactly like the modular one ─────────
const modular = [{
  id: "mgrp1", pricing_type: "modular_group", group_name: "Benches", is_active: true, sort_order: 0, modular_pricing_mode: "direct",
  items: [
    { id: "bench-a", pricing_type: "modular_item", modular_role: "starter", display_name: "Bench A", price: 411, currency: "EUR", is_active: true, sort_order: 0 },
    { id: "bench-b", pricing_type: "modular_item", modular_role: "intermediate", display_name: "Bench B", price: 100, currency: "EUR", is_active: true, sort_order: 1 },
  ],
}];
const legacy = [{ id: "legacy", pricing_type: "base_model_group", group_name: "Choose model / size", is_active: true, sort_order: 0, items: [{ id: "row152", display_name: "Desk 152", price: 152, currency: "EUR", is_active: true, sort_order: 0 }, { id: "row300", display_name: "Desk 300", price: 300, currency: "EUR", is_active: true, sort_order: 1 }] }];
const template = (extra: Record<string, unknown> = {}) => ({ id: "t", templateName: "OXI", currency: "EUR", defaultUnitPrice: 1000, categoryPricing: modular, variantPricing: legacy, ...extra });

test("price regression: modular quantities with and without a legacy variant_row_id give the same price", () => {
  const modularOnly = resolveProductConfigurationState(template(), { modularQuantities: { "bench-a": 1, "bench-b": 2 } });
  const withLegacy = resolveProductConfigurationState(template(), { modularQuantities: { "bench-a": 1, "bench-b": 2 }, variantRowId: "row152" });
  const withOther = resolveProductConfigurationState(template(), { modularQuantities: { "bench-a": 1, "bench-b": 2 }, variantRowId: "row300" });
  assert.equal(modularOnly.price.unit, 611, "411 + 2 x 100, the modular rows only");
  assert.deepEqual(withLegacy.price, modularOnly.price);
  assert.deepEqual(withOther.price, modularOnly.price);
  assert.equal(withLegacy.staleSelections.length, 0, "a saved legacy choice is ignored, not reported stale");
  assert.equal(modularOnly.price.base, 611);
});

test("price regression: the Base / Model price still counts for a template with NO modular and NO workstation pricing", () => {
  const baseModel = resolveProductConfigurationState({ id: "t", templateName: "Chair", currency: "EUR", defaultUnitPrice: 1000, variantPricing: legacy }, { variantRowId: "row152" });
  assert.equal(baseModel.price.unit, 152);
  const other = resolveProductConfigurationState({ id: "t", templateName: "Chair", currency: "EUR", defaultUnitPrice: 1000, variantPricing: legacy }, { variantRowId: "row300" });
  assert.equal(other.price.unit, 300);
});
