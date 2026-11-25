import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveMainAccessoryTargets } from "../products/main-accessory-targets";
import { resolveProductConfigurationState } from "../products/product-configuration-state";
import {
  BASE_SELECTED_NOTE,
  MODES_COMBINED_MESSAGE,
  MODULAR_OR_BASE_REQUIRED_MESSAGE,
  MODULAR_REQUIRED_MESSAGE,
  MODULAR_SELECTED_NOTE,
  WORKSTATION_SELECTED_NOTE,
  configuratorModes,
  modularMissingMessage,
  pricingModesProblem,
  type ConfiguratorModeInput,
} from "./configurator-choosers";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const selector = read("../../components/quotations/product-library-selector.tsx");
const action = read("../../app/quotations/actions.ts");

const NOTHING: ConfiguratorModeInput = { hasModularRows: true, hasWorkstationRows: false, hasBaseModelRows: true, hasPriceMatrixRows: false, modularSelected: false, workstationSelected: false, baseModelSelected: false, priceMatrixSelected: false };
const modes = (change: Partial<ConfiguratorModeInput>) => configuratorModes({ ...NOTHING, ...change });

// ── mode logic ─────────────────────────────────────────────────────────────
test("nothing selected: both modes are available, nothing is disabled", () => {
  const result = modes({});
  assert.deepEqual([result.mode, result.exclusive, result.modularDisabled, result.baseModelDisabled, result.priceMatrixDisabled, result.reason], ["none", true, false, false, false, null]);
});

test("modular items selected: Base / Model and Price Matrix are disabled with the note; modular stays usable", () => {
  const result = modes({ modularSelected: true, hasPriceMatrixRows: true });
  assert.equal(result.mode, "modular");
  assert.deepEqual([result.baseModelDisabled, result.priceMatrixDisabled, result.modularDisabled], [true, true, false]);
  assert.equal(result.reason, MODULAR_SELECTED_NOTE);
  assert.equal(MODULAR_SELECTED_NOTE, "Modular items selected. Choose a model / size as a separate product.");
  assert.deepEqual([result.useModular, result.useBaseModel, result.usePriceMatrix], [true, false, false]);
});

test("workstation size selected: the base choosers are disabled with its own note", () => {
  const result = modes({ hasModularRows: false, hasWorkstationRows: true, hasPriceMatrixRows: true, hasBaseModelRows: false, workstationSelected: true });
  assert.equal(result.mode, "modular");
  assert.deepEqual([result.baseModelDisabled, result.priceMatrixDisabled], [true, true]);
  assert.equal(result.reason, WORKSTATION_SELECTED_NOTE);
});

test("Base / Model row selected: the modular items are disabled with the note", () => {
  const result = modes({ baseModelSelected: true });
  assert.equal(result.mode, "base");
  assert.deepEqual([result.modularDisabled, result.workstationDisabled, result.baseModelDisabled], [true, true, false]);
  assert.equal(result.reason, BASE_SELECTED_NOTE);
  assert.equal(BASE_SELECTED_NOTE, "Model / size selected. Clear it to configure modular items.");
  assert.deepEqual([result.useModular, result.useBaseModel], [false, true]);
});

test("Price Matrix choice selected: the modular items are disabled", () => {
  const result = modes({ hasBaseModelRows: false, hasPriceMatrixRows: true, priceMatrixSelected: true });
  assert.equal(result.mode, "base");
  assert.equal(result.modularDisabled, true);
  assert.equal(result.usePriceMatrix, true);
});

test("both attempted (a saved line carrying both): the modular side wins, the base values are ignored, nothing is priced from both", () => {
  const result = modes({ modularSelected: true, baseModelSelected: true, priceMatrixSelected: true, hasPriceMatrixRows: true });
  assert.equal(result.mode, "modular");
  assert.deepEqual([result.useModular, result.useBaseModel, result.usePriceMatrix], [true, false, false]);
  assert.deepEqual([result.baseModelDisabled, result.priceMatrixDisabled], [true, true]);
  const workstationAndBase = modes({ hasModularRows: false, hasWorkstationRows: true, workstationSelected: true, baseModelSelected: true });
  assert.deepEqual([workstationAndBase.useWorkstation, workstationAndBase.useBaseModel], [true, false]);
});

test("clearing the selection enables both modes again (reversible)", () => {
  const selected = modes({ modularSelected: true });
  assert.equal(selected.baseModelDisabled, true);
  const cleared = modes({ modularSelected: false });
  assert.deepEqual([cleared.mode, cleared.baseModelDisabled, cleared.modularDisabled, cleared.reason], ["none", false, false, null]);
  const base = modes({ baseModelSelected: true });
  assert.equal(base.modularDisabled, true);
  assert.equal(modes({ baseModelSelected: false }).modularDisabled, false);
});

test("a template with only modular OR only Base / Model is never constrained (behaves as today)", () => {
  const modularOnly = modes({ hasBaseModelRows: false, modularSelected: true });
  assert.deepEqual([modularOnly.exclusive, modularOnly.baseModelDisabled, modularOnly.priceMatrixDisabled, modularOnly.modularDisabled, modularOnly.reason], [false, false, false, false, null]);
  const baseOnly = modes({ hasModularRows: false, baseModelSelected: true });
  assert.deepEqual([baseOnly.exclusive, baseOnly.modularDisabled, baseOnly.baseModelDisabled, baseOnly.reason], [false, false, false, null]);
  const matrixOnly = modes({ hasModularRows: false, hasBaseModelRows: false, hasPriceMatrixRows: true, priceMatrixSelected: true });
  assert.deepEqual([matrixOnly.exclusive, matrixOnly.priceMatrixDisabled, matrixOnly.modularDisabled], [false, false, false]);
});

// ── server validation (pure part) ──────────────────────────────────────────
test("server: both modes with positive values are rejected, each alone is accepted, neither is a separate error", () => {
  const exclusive = true;
  assert.equal(pricingModesProblem({ exclusive, modularSelected: true, workstationSelected: false, baseSelected: true }), MODES_COMBINED_MESSAGE);
  assert.equal(pricingModesProblem({ exclusive, modularSelected: false, workstationSelected: true, baseSelected: true }), MODES_COMBINED_MESSAGE);
  assert.equal(pricingModesProblem({ exclusive, modularSelected: true, workstationSelected: false, baseSelected: false }), null, "modular alone");
  assert.equal(pricingModesProblem({ exclusive, modularSelected: false, workstationSelected: false, baseSelected: true }), null, "base alone");
  assert.equal(pricingModesProblem({ exclusive, modularSelected: false, workstationSelected: false, baseSelected: false }), null, "neither is handled by its own message");
  assert.equal(pricingModesProblem({ exclusive: false, modularSelected: true, workstationSelected: false, baseSelected: true }), null, "a one-mode template is never constrained");
});

test("server: the 'nothing selected' message is extended with 'or a model / size' only for a template that also has Base / Model rows", () => {
  assert.equal(modularMissingMessage(false), MODULAR_REQUIRED_MESSAGE);
  assert.equal(MODULAR_REQUIRED_MESSAGE, "Select at least one modular item before adding this product.");
  assert.equal(modularMissingMessage(true), MODULAR_OR_BASE_REQUIRED_MESSAGE);
  assert.equal(MODULAR_OR_BASE_REQUIRED_MESSAGE, "Select at least one modular item or a model / size before adding this product.");
});

test("the server action: the same condition, the rejections and the message are wired, and the price chain uses modularInUse", () => {
  assert.match(action, /const modularInUse = usesModularPricing && modularGroups\.some\(\(group\) => group\.items\.some\(\(row\) => \{/);
  assert.match(action, /if \(usesModularPricing && !selectedModularItems\.length && !\(selectedVariantPricingRow \|\| selectedCategoryPricingRow\)\) \{\s*redirectWithMessage\(redirectPath, modularMissingMessage\(offersBaseMode\)\);/);
  assert.match(action, /const pricingModesIssue = pricingModesProblem\(\{\s*exclusive: offersModularMode && offersBaseMode,\s*modularSelected: selectedModularItems\.length > 0,\s*workstationSelected: Boolean\(submittedDeskingSizeId\),\s*baseSelected: Boolean\(selectedVariantPricingRow \|\| selectedCategoryPricingRow\),/);
  assert.match(action, /if \(pricingModesIssue\) \{\s*redirectWithMessage\(redirectPath, pricingModesIssue\);/);
  assert.match(action, /const baseUnitPrice = derivedDesking\s*\? derivedDesking\.unitPrice \|\| money\(template\.default_unit_price \?\? 0\)\s*: modularInUse/);
  const afterTargets = action.slice(action.indexOf("// Same priority as the quotation selector (shared helper): workstation, modular, Base / Model, Price Matrix."), action.indexOf("export async function addProductTemplateToQuotation") + 60000);
  assert.ok(afterTargets.length > 5000 && afterTargets.includes("baseUnitPrice"), "the slice covers the price chain");
  assert.doesNotMatch(afterTargets.replace("usesModularPricing: modularInUse", ""), /[^a-zA-Z]usesModularPricing/, "after the mode is decided, nothing reads the template-level flag for a price, target or snapshot");
});

// ── the selector ───────────────────────────────────────────────────────────
test("the selector shows every chooser again and disables the other mode with the existing 'Clear selection' pattern", () => {
  assert.match(selector, /import \{ configuratorModes \} from "@\/lib\/quotations\/configurator-choosers";/);
  assert.match(selector, /const pricingModes = configuratorModes\(\{/);
  assert.match(selector, /const selectedVariantRow = modularModeActive \? null : rawSelectedVariantRow;/);
  assert.match(selector, /const baseSectionDisabled = \(excludesBaseModels && selectedModularItems\.length > 0\) \|\| pricingModes\.baseModelDisabled;/);
  assert.match(selector, /const modularSectionDisabled = \(excludesBaseModels && Boolean\(selectedVariantRow\)\) \|\| pricingModes\.modularDisabled;/);
  assert.match(selector, /const priceMatrixSectionDisabled = pricingModes\.priceMatrixDisabled;/);
  assert.match(selector, /\{usesVariantPricing \? \(\s*<div className="mt-3 space-y-2">/, "the Base / Model chooser is rendered again (not hidden)");
  assert.match(selector, /\{usesCategoryPricing \? \(\s*<>\s*\{priceMatrixSectionDisabled \? \(/, "and so is the Price Matrix chooser");
  assert.match(selector, /<fieldset disabled=\{priceMatrixSectionDisabled\}/);
  assert.doesNotMatch(selector, /showBaseModelChooser|showPriceMatrixChooser/, "the previous hiding is gone");
  assert.match(selector, /excludesBaseModels \? BASE_MODEL_DISABLED_NOTE : pricingModes\.reason/);
  assert.match(selector, /excludesBaseModels \? MODULAR_DISABLED_NOTE : pricingModes\.reason/);
});

test("the selector clears the other mode when one becomes active, and prices modular only when a modular item has a quantity", () => {
  const pricing = read("../products/configuration-price.ts");
  assert.match(selector, /if \(nextQty > 0\) clearBaseValuesForModular\(\);/);
  assert.match(selector, /if \(pricingModes\.exclusive\) clearModularSelection\(\); setSelectedVariantRows/);
  assert.match(selector, /if \(pricingModes\.exclusive && nextRowId\) clearModularSelection\(\);/);
  assert.match(selector, /const modularInUse = usesModularPricing && selectedModularItems\.length > 0;/);
  assert.match(selector, /modularInUse, modularItems: selectedModularItems,/);
  assert.match(pricing, /const previewUnitPrice = baseProductPrice \+ selectedWorkstationVariantPrice \+ matchingSystemTotal \+ matchingAccessoryTotal;/);
  assert.match(pricing, /const baseProductPrice =\s*modularInUse\s*\? selectedModularItems\.reduce/);
  assert.match(selector, /const missingRequiredModularSelection = usesModularPricing && \(selectedModularItems\.length > 0 \? Boolean\(modularCompositionIssue\) : !baseModeChosen\);/);
  assert.match(selector, /const savedModularSide = Object\.values\(plain\.modularQuantities \?\? \{\}\)\.some/, "a saved line with both modes keeps the modular side");
  assert.match(selector, /put\(setSelectedVariantRows, savedModularSide \? null : plain\.variantRowId\);/);
  // the flags the one-mode templates use are unchanged
  assert.match(selector, /const usesVariantPricing = !usesWorkstationFlow && variantRows\.length > 0;/);
  assert.match(selector, /const usesModularPricing = modularRows\.length > 0;/);
});

// ── price tests, hand computed ─────────────────────────────────────────────
const modular = [{
  id: "mgrp1", pricing_type: "modular_group", group_name: "Benches", is_active: true, sort_order: 0, modular_pricing_mode: "direct",
  items: [
    { id: "bench-a", pricing_type: "modular_item", modular_role: "starter", display_name: "Bench A", price: 411, currency: "EUR", is_active: true, sort_order: 0 },
    { id: "bench-b", pricing_type: "modular_item", modular_role: "intermediate", display_name: "Bench B", price: 100, currency: "EUR", is_active: true, sort_order: 1 },
  ],
}];
const legacy = [{ id: "legacy", pricing_type: "base_model_group", group_name: "Choose model / size", is_active: true, sort_order: 0, items: [{ id: "row152", display_name: "Desk 152", price: 152, currency: "EUR", is_active: true, sort_order: 0 }, { id: "row300", display_name: "Desk 300", price: 300, currency: "EUR", is_active: true, sort_order: 1 }] }];
const template = (extra: Record<string, unknown> = {}) => ({ id: "t", templateName: "OXI", currency: "EUR", defaultUnitPrice: 0, categoryPricing: modular, variantPricing: legacy, ...extra });

test("price: modular quantity above 0 prices from the modular rows, exactly as before, even with a legacy variant_row_id", () => {
  const modularOnly = resolveProductConfigurationState(template(), { modularQuantities: { "bench-a": 1, "bench-b": 2 } });
  const withLegacy = resolveProductConfigurationState(template(), { modularQuantities: { "bench-a": 1, "bench-b": 2 }, variantRowId: "row152" });
  assert.equal(modularOnly.price.unit, 611, "411 x 1 + 100 x 2");
  assert.deepEqual(withLegacy.price, modularOnly.price);
  assert.equal(withLegacy.price.unit, 611);
});

test("price: Base / Model only on a modular-capable template is the Base / Model row price (the template default is EUR 0)", () => {
  const row152 = resolveProductConfigurationState(template(), { variantRowId: "row152" });
  assert.equal(row152.price.unit, 152, "the row, not the EUR 0 default and not a 0 modular total");
  const row300 = resolveProductConfigurationState(template(), { variantRowId: "row300" });
  assert.equal(row300.price.unit, 300);
});

test("price: nothing selected on a modular-capable template falls to the existing default (EUR 0), as the last branch always did", () => {
  assert.equal(resolveProductConfigurationState(template(), {}).price.unit, 0);
  assert.equal(resolveProductConfigurationState(template({ defaultUnitPrice: 40 }), {}).price.unit, 40);
});

test("price: a template with ONLY modular rows, and one with ONLY Base / Model rows, price as before", () => {
  assert.equal(resolveProductConfigurationState(template({ variantPricing: [] }), { modularQuantities: { "bench-b": 3 } }).price.unit, 300);
  assert.equal(resolveProductConfigurationState({ id: "t", templateName: "Chair", currency: "EUR", defaultUnitPrice: 1000, variantPricing: legacy }, { variantRowId: "row300" }).price.unit, 300);
});

test("accessory targets: modular first when selected, otherwise the Base / Model (or Price Matrix) target; one-mode templates unchanged", () => {
  const modularTarget = [{ kind: "modular" as const, group_id: "g", row_id: "bench-a" }];
  const baseTarget = [{ kind: "base_model" as const, group_id: "g2", row_id: "row152" }];
  const matrixTarget = [{ kind: "price_matrix" as const, group_id: "g3", row_id: "crow" }];
  const empty: [] = [];
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: empty, usesModularPricing: true, modular: modularTarget, baseModel: baseTarget, priceMatrix: empty }), modularTarget);
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: empty, usesModularPricing: false, modular: empty, baseModel: baseTarget, priceMatrix: empty }), baseTarget, "Base / Model alone");
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: empty, usesModularPricing: true, modular: empty, baseModel: empty, priceMatrix: empty }), empty, "a modular template with nothing selected has no target, as before");
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: empty, usesModularPricing: false, modular: empty, baseModel: empty, priceMatrix: matrixTarget }), matrixTarget);
});
