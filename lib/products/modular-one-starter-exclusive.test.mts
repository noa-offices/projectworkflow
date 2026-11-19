import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accessoryApplicabilityTargetKey, evaluateAccessoryConfigurationForModel } from "./accessory-conditional-configuration.js";
import { categoryPricingValue } from "./category-pricing-value.js";
import {
  applyModularRowQuantity,
  BASE_MODEL_DISABLED_NOTE,
  MODULAR_AND_BASE_MODEL_MESSAGE,
  MODULAR_DISABLED_NOTE,
  modularGroupsExcludeBaseModels,
  SINGLE_STARTER_HINT,
  validateModularBaseModelExclusivity,
  validateModularCompositionGroups,
} from "./modular-composition.js";
import { isSingleStarterModularGroup, modularExcludesBaseModels, type ModularCategoryPricingShape } from "./modular-pricing.js";
import { resolveMainAccessoryTargets } from "./main-accessory-targets.js";
import { mapDraftModularPricing } from "./product-template-draft-modular-adapter.js";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace.js";
import { normalizeProductTemplateDraft } from "./product-template-draft.js";

// Generic architecture-only group: four starter widths and four intermediate widths (no real catalogue codes or prices).
const widths = ["120", "140", "160", "180"];
function runtimeGroup(options: { composition?: { min_starters: number; max_starters: number | null } | null; excludes?: unknown } = {}): ModularCategoryPricingShape {
  const composition = options.composition === undefined ? { min_starters: 1, max_starters: 1 } : options.composition;
  return {
    id: "bench",
    group_name: "Bench",
    pricing_type: "modular_group",
    modular_pricing_mode: "direct",
    ...(composition ? { modular_composition: composition } : {}),
    ...(options.excludes === undefined ? {} : { modular_excludes_base_models: options.excludes as boolean }),
    items: [
      ...widths.map((width) => ({ id: `starter-${width}`, variant_name: `Starter W${width}`, modular_role: "starter", price: 100, pricing_type: "modular_item" })),
      ...widths.map((width) => ({ id: `inter-${width}`, variant_name: `Intermediate W${width}`, modular_role: "intermediate", price: 50, pricing_type: "modular_item" })),
    ],
  };
}
const quantityFrom = (quantities: Record<string, number>) => (_groupId: string, rowId: string) => quantities[rowId] ?? 0;

// ---------------------------------------------------------------------------
// R1: one starter, "replace" behaviour
// ---------------------------------------------------------------------------

test("R1: with max_starters 1, choosing starter B zeroes starter A", () => {
  const group = runtimeGroup();
  assert.equal(isSingleStarterModularGroup(group), true);
  const afterA = applyModularRowQuantity(group, {}, "starter-120", 1);
  assert.equal(afterA["starter-120"], 1);
  assert.ok(widths.filter((width) => width !== "120").every((width) => (afterA[`starter-${width}`] ?? 0) === 0));
  const afterB = applyModularRowQuantity(group, afterA, "starter-160", 1);
  assert.equal(afterB["starter-160"], 1);
  assert.equal(afterB["starter-120"], 0);
  const selectedStarters = widths.filter((width) => (afterB[`starter-${width}`] ?? 0) > 0);
  assert.deepEqual(selectedStarters, ["160"]);
  assert.equal(validateModularCompositionGroups([group], quantityFrom(afterB)), null);
});

test("R1: a starter quantity is clamped to 0 or 1", () => {
  const group = runtimeGroup();
  assert.equal(applyModularRowQuantity(group, {}, "starter-140", 5)["starter-140"], 1);
  assert.equal(applyModularRowQuantity(group, {}, "starter-140", 2)["starter-140"], 1);
  assert.equal(applyModularRowQuantity(group, {}, "starter-140", -3)["starter-140"], 0);
  assert.equal(applyModularRowQuantity(group, {}, "starter-140", Number.NaN)["starter-140"], 0);
  assert.equal(applyModularRowQuantity(group, { "starter-140": 1 }, "starter-140", 0)["starter-140"], 0);
});

test("R1: setting a starter to 0 does not touch other starters or the intermediates", () => {
  const group = runtimeGroup();
  const next = applyModularRowQuantity(group, { "starter-120": 1, "inter-120": 3 }, "starter-160", 0);
  assert.equal(next["starter-120"], 1);
  assert.equal(next["inter-120"], 3);
  assert.equal(next["starter-160"], 0);
});

test("R2: intermediate rows stay free (many rows, any quantity) even for a single-starter group", () => {
  const group = runtimeGroup();
  let quantities = applyModularRowQuantity(group, {}, "starter-120", 1);
  quantities = applyModularRowQuantity(group, quantities, "inter-120", 4);
  quantities = applyModularRowQuantity(group, quantities, "inter-140", 2);
  quantities = applyModularRowQuantity(group, quantities, "inter-180", 7);
  assert.equal(quantities["starter-120"], 1);
  assert.deepEqual([quantities["inter-120"], quantities["inter-140"], quantities["inter-180"]], [4, 2, 7]);
  assert.ok(widths.filter((width) => width !== "120").every((width) => (quantities[`starter-${width}`] ?? 0) === 0));
  assert.equal(validateModularCompositionGroups([group], quantityFrom(quantities)), null);
});

test("R1: max_starters 2, null, or a missing composition keeps today's behaviour", () => {
  for (const composition of [{ min_starters: 1, max_starters: 2 }, { min_starters: 1, max_starters: null }, null]) {
    const group = runtimeGroup({ composition });
    assert.equal(isSingleStarterModularGroup(group), false);
    let quantities = applyModularRowQuantity(group, {}, "starter-120", 1);
    quantities = applyModularRowQuantity(group, quantities, "starter-160", 1);
    assert.deepEqual(quantities, { "starter-120": 1, "starter-160": 1 }, "no replacement outside max_starters === 1");
    assert.equal(applyModularRowQuantity(group, {}, "starter-140", 5)["starter-140"], 5, "no clamping outside max_starters === 1");
  }
  // The existing validation still reports too many starters (max 2 with three selected).
  const two = runtimeGroup({ composition: { min_starters: 1, max_starters: 2 } });
  assert.equal(validateModularCompositionGroups([two], quantityFrom({ "starter-120": 1, "starter-140": 1, "starter-160": 1 }))?.code, "too_many_starters");
});

test("R1: the existing server check stays: two starters under max 1 are still reported", () => {
  const group = runtimeGroup();
  assert.equal(validateModularCompositionGroups([group], quantityFrom({ "starter-120": 1, "starter-140": 1 }))?.code, "too_many_starters");
});

test("R1: a product with no modular rows is not affected at all", () => {
  assert.deepEqual(applyModularRowQuantity(null, { a: 1 }, "x", 3), { a: 1, x: 3 });
  assert.deepEqual(applyModularRowQuantity({ id: "empty", items: [] }, {}, "x", 3), { x: 3 });
  assert.equal(modularGroupsExcludeBaseModels([]), false);
  assert.equal(validateModularBaseModelExclusivity([], () => 0, true), null);
});

// ---------------------------------------------------------------------------
// R4: one way only (opt-in)
// ---------------------------------------------------------------------------

test("R4: only an explicit boolean true opts in", () => {
  assert.equal(modularExcludesBaseModels(runtimeGroup({ excludes: true })), true);
  for (const value of [undefined, false, null, "true", 1, "yes"]) {
    assert.equal(modularExcludesBaseModels(runtimeGroup({ excludes: value })), false, `value ${String(value)} must not opt in`);
  }
  assert.equal(modularGroupsExcludeBaseModels([{ ...runtimeGroup({ excludes: true }), is_active: false }]), false, "an inactive group does not opt in");
});

test("R4: flag true rejects modular and a base size together (server rule); one side alone is fine", () => {
  const group = runtimeGroup({ excludes: true });
  const modular = quantityFrom({ "starter-120": 1, "inter-120": 2 });
  const issue = validateModularBaseModelExclusivity([group], modular, true);
  assert.equal(issue?.code, "modular_and_base_model_selected");
  assert.equal(issue?.message, MODULAR_AND_BASE_MODEL_MESSAGE);
  assert.equal(validateModularBaseModelExclusivity([group], modular, false), null, "modular only is accepted");
  assert.equal(validateModularBaseModelExclusivity([group], quantityFrom({}), true), null, "base size only is accepted");
});

test("R4: flag false or absent accepts both exactly as today", () => {
  for (const excludes of [undefined, false]) {
    const group = runtimeGroup({ excludes });
    assert.equal(validateModularBaseModelExclusivity([group], quantityFrom({ "starter-120": 1 }), true), null);
  }
});

test("R4: the exclusivity rule does not change the shared composition validation", () => {
  const group = runtimeGroup({ excludes: true });
  assert.equal(validateModularCompositionGroups([group], quantityFrom({ "starter-120": 1 })), null);
});

// ---------------------------------------------------------------------------
// The flag survives draft -> normaliser -> adapter -> template JSON -> editor pass-through -> reopen
// ---------------------------------------------------------------------------

function baseDraft(groups: Record<string, unknown>[]) {
  return {
    version: 1,
    template: { templateName: "Bench system" },
    defaultCurrency: "EUR",
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: groups },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 0.9, sources: [],
  };
}
function directDraftGroup(extra: Record<string, unknown> = {}) {
  return {
    id: "bench", label: "Bench", defaultDimensions: null, defaultSpecification: null, pricingMode: "direct",
    directRows: [
      { id: "starter-120", label: "Starter W120", price: 100, currency: "EUR", supplierCodes: ["S-1"], role: "starter" },
      { id: "inter-120", label: "Intermediate W120", price: 50, currency: "EUR", supplierCodes: ["I-1"], role: "intermediate" },
    ],
    composition: { minStarters: 1, maxStarters: 1 },
    ...extra,
  };
}
function matrixDraftGroup(extra: Record<string, unknown> = {}) {
  return {
    id: "sofa", label: "Sofa", defaultDimensions: null, defaultSpecification: null,
    matrix: { id: "sofa-matrix", label: "Upholstery", columns: [{ id: "cat-a", label: "Cat A" }], rows: [{ id: "corner", label: "Corner", prices: { "cat-a": 990 }, role: "starter" }] },
    composition: { minStarters: 1, maxStarters: 1 },
    ...extra,
  };
}

test("flag round trip: direct group draft -> normaliser -> adapter -> template JSON -> reopen", () => {
  const normalized = normalizeProductTemplateDraft(baseDraft([directDraftGroup({ excludesBaseModels: true })]));
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));
  assert.equal(normalized.draft!.pricing.modularGroups[0].excludesBaseModels, true);

  const mapped = mapDraftModularPricing(normalized.draft!);
  assert.equal(mapped.compatible, true);
  assert.equal(modularExcludesBaseModels(mapped.groups[0]), true);

  // Product Template editor save: the raw JSON payload goes through the server-side runtime normaliser.
  const saved = categoryPricingValue("[]", JSON.stringify(mapped.groups), "{}");
  const savedGroup = saved.find((row) => (row as { id?: string }).id === "bench") as ModularCategoryPricingShape | undefined;
  assert.equal(savedGroup?.modular_excludes_base_models, true);
  assert.deepEqual(savedGroup?.modular_composition, { min_starters: 1, max_starters: 1 }, "existing composition is untouched");

  // Reopen in Smart Setup: the saved runtime shape returns to the same draft flag.
  const workspace = productTemplateFormSmartWorkspace({
    variant_pricing: "[]", desking_size_pricing: "[]", category_pricing: JSON.stringify(saved), modular_item_pricing: "[]", accessory_pricing: "[]",
  });
  assert.equal(workspace.draft.pricing.modularGroups[0].excludesBaseModels, true);
});

test("flag round trip: matrix modular group carries the flag too", () => {
  const normalized = normalizeProductTemplateDraft(baseDraft([matrixDraftGroup({ excludesBaseModels: true })]));
  assert.equal(normalized.valid, true, JSON.stringify(normalized.errors));
  assert.equal(normalized.draft!.pricing.modularGroups[0].excludesBaseModels, true);
  const mapped = mapDraftModularPricing(normalized.draft!);
  assert.equal(mapped.compatible, true);
  assert.equal(modularExcludesBaseModels(mapped.groups[0]), true);
  const saved = categoryPricingValue("[]", JSON.stringify(mapped.groups), "{}");
  assert.equal((saved.find((row) => (row as { id?: string }).id === "sofa") as ModularCategoryPricingShape).modular_excludes_base_models, true);
  const workspace = productTemplateFormSmartWorkspace({
    variant_pricing: "[]", desking_size_pricing: "[]", category_pricing: JSON.stringify(saved), modular_item_pricing: "[]", accessory_pricing: "[]",
  });
  assert.equal(workspace.draft.pricing.modularGroups[0].excludesBaseModels, true);
});

test("flag round trip: absent or false is omitted everywhere (saved templates stay byte-compatible)", () => {
  for (const extra of [{}, { excludesBaseModels: false }]) {
    const normalized = normalizeProductTemplateDraft(baseDraft([directDraftGroup(extra)]));
    assert.equal(normalized.valid, true);
    assert.equal("excludesBaseModels" in normalized.draft!.pricing.modularGroups[0], false);
    const mapped = mapDraftModularPricing(normalized.draft!);
    assert.equal("modular_excludes_base_models" in mapped.groups[0], false);
    const saved = categoryPricingValue("[]", JSON.stringify(mapped.groups), "{}");
    assert.equal("modular_excludes_base_models" in (saved.find((row) => (row as { id?: string }).id === "bench") as object), false);
  }
});

test("flag normaliser: a non-boolean value is rejected with a clear path", () => {
  const normalized = normalizeProductTemplateDraft(baseDraft([directDraftGroup({ excludesBaseModels: "yes" })]));
  assert.equal(normalized.valid, false);
  assert.ok(normalized.errors.some((error) => String(error.path ?? "").includes("excludesBaseModels")), JSON.stringify(normalized.errors));
});

test("flag editor pass-through: the Product Template editor keeps the flag on load and on save", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.equal(source.split("modular_excludes_base_models").length - 1 >= 3, true, "type + normalise + save payload");
  assert.ok(/modular_excludes_base_models\?: boolean \| null/.test(source));
  assert.ok(source.includes("...(group.modular_excludes_base_models === true ? { modular_excludes_base_models: true } : {})"));
});

// ---------------------------------------------------------------------------
// Required-component target: client and server use one priority
// ---------------------------------------------------------------------------

const modularTarget = (rowId: string) => ({ kind: "modular" as const, group_id: "bench", row_id: rowId });
const baseModelTarget = { kind: "base_model" as const, group_id: "desks", row_id: "desk-140" };

function topAccessGroups() {
  return [{
    id: "top-access",
    group_name: "Top access",
    items: [{ id: "top-access-item", item_name: "Top access", price: 10, is_active: true }],
    conditional_configuration: {
      role: "companion" as const,
      selection: "at_least_one" as const,
      applicability: [
        { target: modularTarget("starter-120"), required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true },
        { target: modularTarget("inter-120"), required: true, visible: true, fixed_quantity: 2, scale_with_target_quantity: true },
      ],
    },
  }];
}

test("targets: modular wins over a base size whenever the template uses modular pricing (flag on or off)", () => {
  for (const excludes of [undefined, true]) {
    const group = runtimeGroup({ excludes });
    const modular = [modularTarget("starter-120"), modularTarget("inter-120")];
    const targets = resolveMainAccessoryTargets({ workstation: [], usesModularPricing: true, modular, baseModel: [baseModelTarget], priceMatrix: [] });
    assert.deepEqual(targets, modular, `flag ${String(excludes)}: modular targets first`);
    assert.equal(modularExcludesBaseModels(group), excludes === true);
  }
});

test("targets: the shared priority order is workstation, modular, base model, price matrix", () => {
  const workstation = [{ kind: "workstation" as const, group_id: "w", row_id: "w1" }];
  const priceMatrix = [{ kind: "price_matrix" as const, group_id: "m", row_id: "m1" }];
  assert.deepEqual(resolveMainAccessoryTargets({ workstation, usesModularPricing: true, modular: [modularTarget("a")], baseModel: [baseModelTarget], priceMatrix }), workstation);
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: [], usesModularPricing: false, modular: [], baseModel: [baseModelTarget], priceMatrix }), [baseModelTarget]);
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: [], usesModularPricing: false, modular: [], baseModel: [], priceMatrix }), priceMatrix);
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: [], usesModularPricing: false, modular: [], baseModel: [], priceMatrix: [] }), []);
  // A modular template with nothing selected has no targets. One pricing mode per line: with a base size chosen (and no modular item) the base size applies.
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: [], usesModularPricing: true, modular: [], baseModel: [], priceMatrix: [] }), []);
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: [], usesModularPricing: true, modular: [], baseModel: [baseModelTarget], priceMatrix: [] }), [baseModelTarget]);
});

test("targets: required Top-Access quantity is 6 for starter 1 + intermediate 2, even with a base size also selected", () => {
  const selection = [{ rowId: "starter-120", qty: 1 }, { rowId: "inter-120", qty: 2 }];
  const targets = resolveMainAccessoryTargets({
    workstation: [], usesModularPricing: true,
    modular: selection.map((item) => modularTarget(item.rowId)),
    baseModel: [baseModelTarget], priceMatrix: [],
  });
  const evaluation = evaluateAccessoryConfigurationForModel({
    accessoryGroups: topAccessGroups(),
    baseModelGroupId: null,
    baseModelRowId: null,
    selectedModelTarget: targets[0],
    selectedModelTargets: targets,
    selectedModelTargetQuantities: Object.fromEntries(selection.map((item) => [accessoryApplicabilityTargetKey(modularTarget(item.rowId)), item.qty])),
    selectedQuantitiesByGroupId: { "top-access": { "top-access-item": 6 } },
  });
  assert.equal(evaluation.groups[0].fixedQuantity, 6);
  assert.equal(evaluation.valid, true);
});

test("targets: client and server both call the shared helper with the same candidates", () => {
  const client = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  const server = readFileSync("app/quotations/actions.ts", "utf8");
  for (const source of [client, server]) {
    assert.ok(source.includes("resolveMainAccessoryTargets({"));
    assert.ok(source.includes("usesModularPricing,") || source.includes("usesModularPricing: modularInUse,"));
    assert.ok(/workstation:/.test(source) && /modular:/.test(source) && /baseModel:/.test(source) && /priceMatrix:/.test(source));
  }
  assert.ok(!server.includes(": selectedModularItems.map((item) => ({ kind: \"modular\" as const, group_id: item.group_id, row_id: item.id }));"), "the old server chain (base model before modular) must be gone");
});

// ---------------------------------------------------------------------------
// Selector and server wiring (source-level: the selector is a client component)
// ---------------------------------------------------------------------------

test("selector wiring: starter hint, max 1 input, replace handler, and disabled sections with clear actions", () => {
  const client = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.equal(SINGLE_STARTER_HINT, "Only one starter can be selected. Choosing another replaces it.");
  assert.equal(BASE_MODEL_DISABLED_NOTE, "A workstation system is selected. Clear it to choose a desk size.");
  assert.equal(MODULAR_DISABLED_NOTE, "A desk size is selected. Clear it to build a workstation.");
  assert.ok(client.includes('role === "starter" && isSingleStarterModularGroup(group) ? <p className="mb-1 text-[11px] text-zinc-600">{SINGLE_STARTER_HINT}</p>'));
  assert.ok(client.includes('max={role === "starter" && isSingleStarterModularGroup(group) ? 1 : undefined}'));
  assert.ok(client.includes("applyModularRowQuantity(group, current[template.id] ?? {}, rowId, nextQty)"));
  assert.ok(client.includes("const baseSectionDisabled = (excludesBaseModels && selectedModularItems.length > 0) || pricingModes.baseModelDisabled;"));
  assert.ok(client.includes("const modularSectionDisabled = (excludesBaseModels && Boolean(selectedVariantRow)) || pricingModes.modularDisabled;"));
  assert.ok(client.includes("<fieldset disabled={baseSectionDisabled}"));
  assert.ok(client.includes("<fieldset disabled={modularSectionDisabled}"));
  assert.ok(client.includes("excludesBaseModels ? BASE_MODEL_DISABLED_NOTE : pricingModes.reason") && client.includes("excludesBaseModels ? MODULAR_DISABLED_NOTE : pricingModes.reason"));
  assert.ok(client.includes("onClick={clearModularSelection}") && client.includes("onClick={clearBaseModelSelection}"));
  assert.equal(client.split("Clear selection</button>").length - 1, 3, "Base / Model, modular items and the Price Matrix note each have one");
  assert.ok(client.includes("modular_excludes_base_models: sourceGroup.modular_excludes_base_models === true"));
  // One pricing mode per line: choosing a base size / matrix row clears the modular items (three guarded call sites, only for a template that offers both modes).
  assert.equal(client.split("clearModularSelection()").length - 1, 3);
  assert.equal(client.split("pricingModes.exclusive && nextRowId) clearModularSelection()").length - 1 + client.split("pricingModes.exclusive && nextRow?.id) clearModularSelection()").length - 1 + client.split("if (pricingModes.exclusive) clearModularSelection();").length - 1, 3, "every call is guarded by the mode check");
  assert.equal(client.split("clearBaseModelSelection()").length - 1, 0);
});

test("clear actions only touch their own side", () => {
  const client = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(client.includes("const clearModularSelection = () => setSelectedModularQuantities((current) => { const next = { ...current }; delete next[template.id]; return next; });"));
  assert.ok(client.includes("const clearBaseModelSelection = () => {") && client.includes("setSelectedCategoryRows((current) => { const next = { ...current }; delete next[template.id]; return next; });"), "it also clears the Price Matrix choice");
});

test("server wiring: the exclusivity check runs for modular templates and rejects with the shared message", () => {
  const server = readFileSync("app/quotations/actions.ts", "utf8");
  assert.ok(server.includes("validateModularBaseModelExclusivity("));
  assert.ok(server.includes("Boolean(selectedVariantPricingRow)"));
  assert.ok(server.includes("redirectWithMessage(redirectPath, modularBaseModelExclusivityIssue.message);"));
  // The check is gated on modular pricing, so templates without modular rows never reach it.
  assert.ok(server.includes("const modularBaseModelExclusivityIssue = usesModularPricing"));
});
