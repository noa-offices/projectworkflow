import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildRecipe,
  findForbiddenRecipeKey,
  hashSpecificationText,
  type SavedSetupPlainState,
} from "./recipe";
import { baseModelPlacementFromTemplate } from "./base-model-placement";
import {
  evaluateSetup,
  recipeToSelectorState,
  specificationDrift,
  validateSetupAgainstTemplate,
  type SetupTemplateInput,
} from "./replay";

const TPL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// ── Fixtures (same shapes as lib/products/product-configuration-state.test.mts) ─────────────────────────────────
const variantTwoRows = [{
  id: "grp1", pricing_type: "base_model_group", group_name: "Models", is_active: true, sort_order: 0,
  items: [
    { id: "row1", display_name: "1800x900", price: 500, is_active: true, sort_order: 0 },
    { id: "row2", display_name: "2000x900", price: 600, is_active: true, sort_order: 1 },
  ],
}];
const variantOneRow = [{ ...variantTwoRows[0], items: [variantTwoRows[0].items[0]] }];
const systemGroup = [{
  id: "grp-sys", pricing_type: "base_model_group", group_name: "System", is_active: true, sort_order: 0,
  items: [
    { id: "sys1", role: "system_base", display_name: "System A", price: 100, is_active: true, sort_order: 0 },
    { id: "main1", display_name: "Main A", price: 200, is_active: true, sort_order: 1 },
    { id: "main2", display_name: "Main B", price: 300, is_active: true, sort_order: 2 },
  ],
}];
const deskingTwo = [{
  id: "wgrp1", pricing_type: "workstation_group", group_name: "Sizes", is_active: true, sort_order: 0,
  items: [
    { id: "size1", label: "1800x900", default_price: 700, is_active: true, sort_order: 0 },
    { id: "size2", label: "2000x900", default_price: 800, is_active: true, sort_order: 1 },
  ],
}];
const categoryGroup = [{
  id: "cgrp1", group_name: "Fabric", is_active: true, sort_order: 0, price_categories: ["Cat A", "Cat B"],
  items: [{ id: "crow1", display_name: "Chair Shell", prices: { "Cat A": 400, "Cat B": 450 }, is_active: true, sort_order: 0 }],
}];
const directModular = [{
  id: "mgrp1", pricing_type: "modular_group", group_name: "Modules", is_active: true, sort_order: 0,
  modular_pricing_mode: "direct", modular_composition: { min_starters: 1, max_starters: 1 },
  items: [
    { id: "starter1", pricing_type: "modular_item", modular_role: "starter", display_name: "Starter 90", price: 300, is_active: true, sort_order: 0 },
    { id: "inter1", pricing_type: "modular_item", modular_role: "intermediate", display_name: "Add-on 90", price: 150, is_active: true, sort_order: 1 },
  ],
}];
const serviceUnits = [
  {
    id: "service-units", group_name: "Support Service Units", is_active: true, sort_order: 0,
    items: [
      { id: "1af-090", item_name: "Right service unit", price: 1042, currency: "EUR", is_active: true, sort_order: 0, role: "normal" },
      { id: "1af-091", item_name: "Left service unit", price: 1042, currency: "EUR", is_active: true, sort_order: 1, role: "normal" },
    ],
    conditional_configuration: {
      role: "conditional_option", selection: "exactly_one",
      applicability: [{ base_model_group_id: "grp1", base_model_row_id: "row1", required: true, visible: true, allowed_item_ids: ["1af-090", "1af-091"], fixed_quantity: 1 }],
    },
  },
  {
    id: "modesty", group_name: "Modesty Panels", group_is_required: false, is_active: true, sort_order: 1,
    items: [{ id: "panel-standard", item_name: "Standard Modesty Panel", price: 154, currency: "EUR", is_active: true, sort_order: 0, role: "normal" }],
  },
  {
    id: "extras", group_name: "Extras", group_is_required: true, is_active: true, sort_order: 2,
    items: [
      { id: "x1", item_name: "Extra 1", price: 10, currency: "EUR", is_active: true, sort_order: 0, role: "normal" },
      { id: "x2", item_name: "Extra 2", price: 20, currency: "EUR", is_active: true, sort_order: 1, role: "normal" },
    ],
  },
];
const companion = [{
  id: "cgrp-comp", group_name: "Stirrup Kit", is_active: true, sort_order: 0,
  items: [{ id: "comp1", item_name: "Stirrup Kit", price: 40, is_active: true, sort_order: 0, role: "companion" }],
  conditional_configuration: {
    role: "companion", selection: "exactly_one",
    applicability: [{ base_model_group_id: "grp1", base_model_row_id: "row1", required: true, visible: true, allowed_item_ids: ["comp1"], fixed_quantity: 1 }],
  },
}];

function tpl(overrides: Partial<SetupTemplateInput> = {}): SetupTemplateInput {
  return { id: TPL, template_name: "Every", currency: "EUR", default_unit_price: 1000, ...overrides };
}
const recipeOf = (state: Partial<SavedSetupPlainState>) => buildRecipe({ templateId: TPL, ...state });
const kinds = (problems: Array<{ kind: string }>) => problems.map((problem) => problem.kind).sort();

// ── validateSetupAgainstTemplate ─────────────────────────────────────────────────────────────────────────────────
test("ok: every saved id still exists and required steps resolve", () => {
  const { recipe } = recipeOf({ variantRowId: "row1", pricingAccessoryQuantities: { "1af-090": 1, x1: 1 } });
  const result = validateSetupAgainstTemplate(recipe, tpl({ variant_pricing: variantTwoRows, accessory_pricing: serviceUnits }));
  assert.deepEqual(result, { status: "ok", problems: [] });
});

test("needs_review: model removed (reported, dropped from the restored state, never silent)", () => {
  const { recipe } = recipeOf({ variantRowId: "row-gone" });
  const evaluation = evaluateSetup(recipe, undefined, tpl({ variant_pricing: variantTwoRows }));
  assert.equal(evaluation.validation.status, "needs_review");
  assert.ok(evaluation.validation.problems.some((problem) => problem.kind === "model_removed"));
  assert.equal(evaluation.state?.variantRowId, null);
});

test("needs_review: option removed (component option) - the others are still restored", () => {
  const { recipe } = recipeOf({ variantRowId: "row1", componentOptionSelections: { "Armrest:1": "opt-gone", "Base:1": ["b1", "b2"], "Lumbar:1": "l1" } });
  const evaluation = evaluateSetup(recipe, undefined, tpl({ variant_pricing: variantTwoRows }), { componentIds: ["b1", "l1"] });
  assert.equal(evaluation.validation.status, "needs_review");
  assert.deepEqual(kinds(evaluation.validation.problems), ["option_removed", "option_removed"]);
  assert.deepEqual(evaluation.state?.componentOptionSelections, { "Base:1": ["b1"], "Lumbar:1": "l1" });
});

test("needs_review: accessory removed (pricing accessory and component accessory)", () => {
  const { recipe } = recipeOf({ variantRowId: "row1", pricingAccessoryQuantities: { "1af-090": 1, x1: 1, "acc-gone": 2 }, componentAccessoryQuantities: { "comp-gone": 1, "comp-ok": 1 } });
  const evaluation = evaluateSetup(recipe, undefined, tpl({ variant_pricing: variantTwoRows, accessory_pricing: serviceUnits }), { componentIds: ["comp-ok"] });
  assert.equal(evaluation.validation.status, "needs_review");
  assert.ok(evaluation.validation.problems.every((problem) => problem.kind === "accessory_removed"));
  assert.ok(evaluation.validation.problems.length >= 2);
  assert.ok(!("acc-gone" in (evaluation.state?.pricingAccessoryQuantities ?? {})));
  assert.deepEqual(evaluation.state?.componentAccessoryQuantities, { "comp-ok": 1 });
});

test("needs_review: finish gone (the finishes that still exist are kept; manual finishes are kept)", () => {
  const { recipe } = recipeOf({
    variantRowId: "row1",
    finishes: [{ brand_material_id: "m1", finish_name: "Oak" }, { brand_material_id: "mX", finish_name: "Walnut" }, { finish_name: "Hand-typed" }],
  });
  const evaluation = evaluateSetup(recipe, undefined, tpl({ variant_pricing: variantTwoRows }), { materialIds: ["m1"] });
  assert.equal(evaluation.validation.status, "needs_review");
  assert.deepEqual(kinds(evaluation.validation.problems), ["finish_gone"]);
  assert.match(evaluation.validation.problems[0].label, /Walnut/);
  assert.deepEqual(evaluation.state?.finishes?.map((finish) => finish.finish_name), ["Oak", "Hand-typed"]);
});

test("needs_review: a required step is unresolved (no saved model for a template that needs one)", () => {
  const { recipe } = recipeOf({});
  const result = validateSetupAgainstTemplate(recipe, tpl({ variant_pricing: variantTwoRows }));
  assert.equal(result.status, "needs_review");
  assert.ok(result.problems.some((problem) => problem.kind === "required_step"));
});

// ── PR R-1: a MODULAR product that also carries a legacy Base / Model group (live example: Oxi_Q) ──────────────────
// The real add flow prices through the modular rows and never asks for a Base / Model there (see nextRequiredForReplay in replay.ts).
const oxiVariant = [{
  id: "legacy-base-model-main", pricing_type: "base_model_group", group_name: "Legacy Base / Model", is_active: true, sort_order: 0,
  items: [
    { id: "desk-80", display_name: "Desk 80", price: 500, is_active: true, sort_order: 0 },
    { id: "desk-100", display_name: "Desk 100", price: 600, is_active: true, sort_order: 1 },
  ],
}];
const oxiPanels = [{
  id: "oxi-panels", group_name: "Panels", group_is_required: false, is_active: true, sort_order: 0,
  items: [
    { id: "panel-1", item_name: "Panel", price: 10, currency: "EUR", is_active: true, sort_order: 0, role: "normal" },
    { id: "tray-1", item_name: "Tray", price: 20, currency: "EUR", is_active: true, sort_order: 1, role: "normal" },
  ],
}];
const oxi = (overrides: Partial<SetupTemplateInput> = {}) => tpl({ variant_pricing: oxiVariant, category_pricing: directModular, accessory_pricing: oxiPanels, ...overrides });

test("R-1 (a) modular product with a legacy Base / Model group: modular rows + accessories saved, no variant ids -> NO required-step problem", () => {
  const { recipe } = recipeOf({ categoryGroupId: "mgrp1", modularQuantities: { starter1: 1 }, pricingAccessoryQuantities: { "panel-1": 1, "tray-1": 1 } });
  const evaluation = evaluateSetup(recipe, undefined, oxi());
  assert.deepEqual(evaluation.validation.problems.filter((problem) => problem.kind === "required_step"), []);
  assert.deepEqual(evaluation.validation, { status: "ok", problems: [] });
  assert.deepEqual(evaluation.state?.modularQuantities, { starter1: 1 }, "the modular selection is restored");
  assert.deepEqual(evaluation.state?.pricingAccessoryQuantities, { "panel-1": 1, "tray-1": 1 });
});

test("R-1 (b) a Base / Model product with no variant row chosen is STILL flagged", () => {
  const { recipe } = recipeOf({});
  const result = validateSetupAgainstTemplate(recipe, tpl({ variant_pricing: oxiVariant, accessory_pricing: oxiPanels }));
  assert.equal(result.status, "needs_review");
  assert.deepEqual(result.problems.filter((problem) => problem.kind === "required_step").map((problem) => problem.label), ["A required choice is not set: Base / Model."]);
  // and a modular template where the saved modular row is gone AND the template has Base / Model rows is not silently accepted either
});

test("R-1 (c) a modular product with NOTHING selected is still flagged, and the warning names the modular step", () => {
  const { recipe } = recipeOf({});
  const result = validateSetupAgainstTemplate(recipe, oxi());
  assert.equal(result.status, "needs_review");
  const required = result.problems.filter((problem) => problem.kind === "required_step");
  assert.equal(required.length, 1);
  assert.match(required[0].label, /Modules/, "the modular step, not Base / Model");
  // A modular template whose modular step is not required still reports the missing modular selection.
  const optional = [{ ...directModular[0], modular_composition: undefined }];
  const lenient = validateSetupAgainstTemplate(recipeOf({}).recipe, oxi({ category_pricing: optional }));
  assert.equal(lenient.status, "needs_review");
  assert.match(lenient.problems.find((problem) => problem.kind === "required_step")?.label ?? "", /Modules/);
});

test("R-1 (d) a modular row that no longer exists still shows the stale-selection problem (and the missing modular choice)", () => {
  const { recipe } = recipeOf({ modularQuantities: { "starter-gone": 1 }, pricingAccessoryQuantities: { "panel-1": 1 } });
  const evaluation = evaluateSetup(recipe, undefined, oxi());
  assert.equal(evaluation.validation.status, "needs_review");
  assert.ok(evaluation.validation.problems.some((problem) => problem.kind === "model_removed"), "the stale modular row is reported");
  assert.ok(!("starter-gone" in (evaluation.state?.modularQuantities ?? {})), "and dropped from the restored state");
  assert.ok(evaluation.validation.problems.some((problem) => problem.kind === "required_step" && /Modules/.test(problem.label)), "nothing valid is left selected");
  assert.ok(!evaluation.validation.problems.some((problem) => /Base \/ Model/.test(problem.label)), "but never a Base / Model complaint");
});

test("R-1 (e) a Buddy-like category product and the other product types replay with no problems", () => {
  const buddy = recipeOf({ categoryGroupId: "cgrp1", categoryRowId: "crow1", fabricCategory: "Cat B" });
  assert.deepEqual(evaluateSetup(buddy.recipe, undefined, tpl({ category_pricing: categoryGroup })).validation, { status: "ok", problems: [] });
  const base = recipeOf({ variantRowId: "row2" });
  assert.deepEqual(validateSetupAgainstTemplate(base.recipe, tpl({ variant_pricing: variantTwoRows })), { status: "ok", problems: [] });
  const workstation = recipeOf({ workstationSizeId: "size2" });
  assert.deepEqual(validateSetupAgainstTemplate(workstation.recipe, tpl({ desking_size_pricing: deskingTwo })), { status: "ok", problems: [] });
});

test("R-1: a modular product that unexpectedly also saved a Base / Model row keeps that row (nothing is dropped or invented)", () => {
  const { recipe } = recipeOf({ variantRowId: "desk-80", modularQuantities: { starter1: 1 } });
  const evaluation = evaluateSetup(recipe, undefined, oxi());
  assert.deepEqual(evaluation.validation, { status: "ok", problems: [] });
  assert.equal(evaluation.state?.variantRowId, "desk-80");
});

test("needs_review: a rule is newly incompatible (accessory no longer applies to the chosen model)", () => {
  // The exactly_one service units apply to row1 only; the saved setup now uses row2.
  const { recipe } = recipeOf({ variantRowId: "row2", pricingAccessoryQuantities: { "1af-090": 1 } });
  const result = validateSetupAgainstTemplate(recipe, tpl({ variant_pricing: variantTwoRows, accessory_pricing: serviceUnits }));
  assert.equal(result.status, "needs_review");
});

test("needs_review: a linked product link was removed", () => {
  const { recipe } = recipeOf({ variantRowId: "row1", linkedInstances: { "link-gone": ["i1"], "link-ok": ["i2"] }, linkedSelections: { "link-gone:i1": { variantRowId: "v" }, "link-ok:i2": { variantRowId: "w", quantity: 2 } } });
  const evaluation = evaluateSetup(recipe, undefined, tpl({ variant_pricing: variantTwoRows }), { linkedFamilyIds: ["link-ok"] });
  assert.deepEqual(kinds(evaluation.validation.problems), ["linked_removed"]);
  assert.deepEqual(Object.keys(evaluation.state?.linkedInstances ?? {}), ["link-ok"]);
  assert.deepEqual(Object.keys(evaluation.state?.linkedSelections ?? {}), ["link-ok:i2"]);
});

test("unavailable: template archived, inactive or missing (no state to hydrate)", () => {
  const { recipe } = recipeOf({ variantRowId: "row1" });
  for (const template of [tpl({ lifecycle_status: "archived" }), tpl({ lifecycle_status: "discontinued" }), tpl({ is_active: false }), null, undefined]) {
    const evaluation = evaluateSetup(recipe, undefined, template);
    assert.equal(evaluation.validation.status, "unavailable");
    assert.equal(evaluation.state, null);
  }
});

// ── recipeToSelectorState round trips ────────────────────────────────────────────────────────────────────────────
const productTypes: Array<[string, SavedSetupPlainState, SetupTemplateInput]> = [
  ["price matrix", { templateId: TPL, categoryGroupId: "cgrp1", categoryRowId: "crow1", fabricCategory: "Cat B" }, tpl({ category_pricing: categoryGroup })],
  ["base/model", { templateId: TPL, variantRowId: "row2", componentOptionSelections: { "Armrest:1": "opt-1" } }, tpl({ variant_pricing: variantTwoRows })],
  ["modular", { templateId: TPL, modularQuantities: { starter1: 1, inter1: 2 } }, tpl({ category_pricing: directModular })],
  ["workstation", { templateId: TPL, workstationSizeId: "size2", workstationLayout: "Linear", dimensionOverride: "1200x600" }, tpl({ desking_size_pricing: deskingTwo })],
  ["system", { templateId: TPL, systemRowId: "sys1", systemQuantity: 3, variantRowId: "main2" }, tpl({ variant_pricing: systemGroup })],
];
for (const [name, state, template] of productTypes) {
  test(`recipeToSelectorState round trip: ${name}`, () => {
    const built = buildRecipe(state);
    const restored = recipeToSelectorState(built.recipe, template, { componentIds: ["opt-1"] }, built.specOverrides);
    assert.ok(restored);
    // The only addition is the Product Family / Configuration derived from the row against the template.
    const placement = baseModelPlacementFromTemplate(template.variant_pricing, state.variantRowId);
    const expected = buildRecipe(placement ? { ...state, variantGroupId: placement.groupId, subgroupId: placement.subgroupId } : state);
    assert.deepEqual(buildRecipe(restored), expected, "restored state rebuilds the same recipe");
    assert.equal(validateSetupAgainstTemplate(built.recipe, template, { componentIds: ["opt-1"] }, built.specOverrides).status, "ok");
  });
}

const accessoryModes: Array<[string, Record<string, number>]> = [
  ["exactly_one", { "1af-090": 1 }],
  ["at_least_one", { x1: 1, x2: 2 }],
  ["choose_multiple", { x1: 1, x2: 1 }],
  ["unrestricted", { "panel-standard": 1 }],
];
for (const [mode, picks] of accessoryModes) {
  test(`recipeToSelectorState keeps the accessory picks: ${mode}`, () => {
    const built = buildRecipe({ templateId: TPL, variantRowId: "row1", pricingAccessoryQuantities: picks, skippedAccessoryGroupIds: mode === "unrestricted" ? [] : ["modesty"] });
    const restored = recipeToSelectorState(built.recipe, tpl({ variant_pricing: variantTwoRows, accessory_pricing: serviceUnits }));
    assert.deepEqual(restored?.pricingAccessoryQuantities, picks);
  });
}

test("recipeToSelectorState keeps a required companion override (Stirrup Kit style option_item companion)", () => {
  const built = buildRecipe({ templateId: TPL, variantRowId: "row1", requiredOverrides: { comp1: { quantity: 2, trigger: "[[],[]]" } }, pricingAccessoryQuantities: { comp1: 2 } });
  const restored = recipeToSelectorState(built.recipe, tpl({ variant_pricing: variantOneRow, accessory_pricing: companion }));
  assert.deepEqual(restored?.requiredOverrides, { comp1: { quantity: 2, trigger: "[[],[]]" } });
});

test("nothing price-like or line-quantity-like is ever restored: the hydration state has no such key", () => {
  const built = buildRecipe({
    templateId: TPL, variantRowId: "row1", modularQuantities: { starter1: 2 }, systemRowId: "sys1", systemQuantity: 2,
    linkedInstances: { l: ["i"] }, linkedSelections: { "l:i": { quantity: 3, accessoryQuantities: { a: 1 } } },
  });
  const restored = recipeToSelectorState(built.recipe, tpl({ variant_pricing: variantTwoRows }));
  assert.equal(findForbiddenRecipeKey(restored), null);
  assert.ok(!/price|total|exchange|discount|internal_?cost|\bqty\b/i.test(Object.keys(restored ?? {}).join(",")));
});

test("a recipe without display / linked / selections blocks (older rows) still evaluates without crashing", () => {
  const minimal = { recipe_version: 1, template_id: TPL, selections: {} } as never;
  const evaluation = evaluateSetup(minimal, undefined, tpl());
  assert.equal(evaluation.validation.status, "ok");
  const noSelections = { recipe_version: 1, template_id: TPL } as never;
  assert.doesNotThrow(() => evaluateSetup(noSelections, undefined, tpl()));
});

// ── specificationDrift ───────────────────────────────────────────────────────────────────────────────────────────
test("specificationDrift: same text -> same; template spec changed -> changed; nothing saved -> same", () => {
  const generated = "Chair with mesh back and 5-star base.";
  const { specOverrides } = buildRecipe({ templateId: TPL, specificationEdited: true, editedSpecification: "Mine", generatedSpecification: generated });
  assert.equal(specificationDrift(specOverrides, generated), "same");
  assert.equal(specificationDrift(specOverrides, "  Chair with   mesh back and 5-star base. "), "same");
  assert.equal(specificationDrift(specOverrides, "Chair with mesh back and 4-star base."), "changed");
  assert.equal(specificationDrift(specOverrides, null), "changed");
  assert.equal(specificationDrift({ generated_specification_hash: null }, "anything"), "same");
  assert.equal(specificationDrift(undefined, "anything"), "same");
  assert.equal(specOverrides.generated_specification_hash, hashSpecificationText(generated));
});

// ── Source-text guards ───────────────────────────────────────────────────────────────────────────────────────────
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("selector: Add / Add to Local Workspace and the Save to My Collection block are unchanged; hydration is inactive by default", () => {
  const source = read("../../../components/quotations/product-library-selector.tsx");
  assert.ok(source.includes("onAddLocalItem?.(localProductItem);"));
  assert.ok(source.includes("action={reconfigure ? undefined : addProductTemplateToQuotation}"));
  assert.ok(source.includes("                                  Add to Local Workspace"));
  assert.ok(source.includes("const savedSetupState: SavedSetupPlainState = {"));
  assert.ok(source.includes("<SaveToMyCollectionButton"));
  assert.ok(source.includes("defaultName={defaultSetupName({ mainCode: savedSetupState.mainCode, templateName: template.template_name })}"));
  // Hydration only runs from the picker; with no setup chosen `replay` stays null and the banner never renders.
  assert.match(source, /useState<\{ key: number; problems: SetupProblem\[\][^>]*\} \| null>\(null\)/);
  assert.equal((source.match(/openSetupFromCollection/g) ?? []).length, 4, "shared by My Collection, client history and local reconfigure");
  assert.equal((source.match(/setReplay\(/g) ?? []).length >= 2, true);
  assert.ok(source.includes("{!reconfigure && replay && replay.templateId === template.id ? ("));
  // The line object never receives replay data.
  const lineStart = source.indexOf("const localProductItem: LocalQuotationItem = {");
  const stateStart = source.indexOf("const savedSetupState: SavedSetupPlainState = {");
  assert.ok(!/replay|openSetupFromCollection/.test(source.slice(lineStart, stateStart)));
});

test("picker and banner show no price and never use an elevated client; actions authenticate and filter by owner", () => {
  for (const file of ["add-from-my-collection-button.tsx", "setup-replay-banner.tsx"]) {
    const source = read(`../../../components/quotations/${file}`);
    assert.ok(!/formatMoney|unit_price|net_price|currency|supabase/i.test(source), `${file} must not touch prices or Supabase`);
  }
  const actions = read("./actions.ts");
  assert.equal((actions.match(/await requireActiveUser\(\)/g) ?? []).length, 7);
  assert.ok(!/service[_-]?role|createAdmin/i.test(actions));
  const service = read("./saved-setups-service.ts");
  assert.ok(!/service[_-]?role|createAdmin/i.test(service));
});

// ── Product Family / Configuration restored from the model row (Jera-style: several groups and subgroups) ─────────
const sg = (id: string, name: string, rowIds: string[], sort: number) => ({ id, subgroup_name: name, sort_order: sort, is_active: true, row_ids: rowIds });
const item = (id: string, price: number, sort: number) => ({ id, display_name: id, price, is_active: true, sort_order: sort });
const jeraLike = [
  {
    id: "grpA", pricing_type: "base_model_group", group_name: "Meeting", is_active: true, sort_order: 0,
    items: [item("rowA1", 100, 0), item("rowA2", 110, 1), item("rowA3", 120, 2)],
    subgroups: [sg("s1", "Two doors", ["rowA1", "rowA2"], 0), sg("s2", "Open", ["rowA3"], 1)],
  },
  {
    id: "grpB", pricing_type: "base_model_group", group_name: "Storage", is_active: true, sort_order: 1,
    items: [item("rowB1", 200, 0), item("rowB2", 210, 1)],
    subgroups: [sg("sb1", "Low", ["rowB1"], 0)],
  },
];

test("old recipe with only variant_row_id (2 groups, subgroups) replays ok and derives the right group and subgroup", () => {
  for (const [rowId, groupId, subgroupId] of [["rowA3", "grpA", "s2"], ["rowA1", "grpA", "s1"], ["rowB1", "grpB", "sb1"], ["rowB2", "grpB", "__ungrouped__"]] as const) {
    const { recipe } = recipeOf({ variantRowId: rowId });
    assert.equal(recipe.selections.variant_group_id, undefined, "old format: no group id stored");
    const evaluation = evaluateSetup(recipe, undefined, tpl({ variant_pricing: jeraLike }));
    assert.deepEqual(evaluation.validation, { status: "ok", problems: [] }, rowId);
    assert.equal(evaluation.state?.variantGroupId, groupId);
    assert.equal(evaluation.state?.subgroupId, subgroupId);
    assert.equal(evaluation.state?.variantRowId, rowId);
  }
});

test("without the derivation the same old recipe WOULD report a missing Base / Model group (what the owner saw)", () => {
  // Guard against regressing the engine call: group and subgroup must be passed to it.
  const source = readFileSync(new URL("./replay.ts", import.meta.url), "utf8");
  assert.match(source, /variantGroupId,\s*\n\s*subgroupId,/);
});

test("new recipe stores the group and subgroup ids (ids only) and round-trips", () => {
  const built = buildRecipe({ templateId: TPL, variantRowId: "rowA3", variantGroupId: "grpA", subgroupId: "s2" });
  assert.equal(built.recipe.selections.variant_group_id, "grpA");
  assert.equal(built.recipe.selections.subgroup_id, "s2");
  assert.equal(findForbiddenRecipeKey(built.recipe), null);
  assert.deepEqual(validateSetupAgainstTemplate(built.recipe, tpl({ variant_pricing: jeraLike }), {}, built.specOverrides), { status: "ok", problems: [] });
  const restored = recipeToSelectorState(built.recipe, tpl({ variant_pricing: jeraLike }), {}, built.specOverrides);
  assert.deepEqual(buildRecipe(restored!), built);
  // The ids are only stored together with a model row.
  assert.equal(buildRecipe({ templateId: TPL, variantGroupId: "grpA", subgroupId: "s2" }).recipe.selections.variant_group_id, undefined);
});

test("row removed from the template: needs_review with the removed-model message (with and without saved group ids)", () => {
  for (const state of [{ variantRowId: "rowGone" }, { variantRowId: "rowGone", variantGroupId: "grpA", subgroupId: "s1" }]) {
    const evaluation = evaluateSetup(recipeOf(state).recipe, undefined, tpl({ variant_pricing: jeraLike }));
    assert.equal(evaluation.validation.status, "needs_review");
    assert.ok(evaluation.validation.problems.some((problem) => problem.kind === "model_removed"));
    assert.equal(evaluation.state?.variantRowId, null);
  }
});

test("row moved to another group / subgroup: derived from the CURRENT template, no false banner", () => {
  const { recipe } = recipeOf({ variantRowId: "rowA1", variantGroupId: "grpA", subgroupId: "s1" });
  const moved = [
    { ...jeraLike[0], items: jeraLike[0].items.filter((row) => row.id !== "rowA1"), subgroups: [sg("s1", "Two doors", ["rowA2"], 0), sg("s2", "Open", ["rowA3"], 1)] },
    { ...jeraLike[1], items: [item("rowA1", 100, 0), ...jeraLike[1].items], subgroups: [sg("sb1", "Low", ["rowB1", "rowA1"], 0)] },
  ];
  const evaluation = evaluateSetup(recipe, undefined, tpl({ variant_pricing: moved }));
  assert.deepEqual(evaluation.validation, { status: "ok", problems: [] });
  assert.equal(evaluation.state?.variantGroupId, "grpB");
  assert.equal(evaluation.state?.subgroupId, "sb1");
});

test("baseModelPlacement: single group without subgroups, ungrouped rows, no row", () => {
  assert.deepEqual(baseModelPlacementFromTemplate(variantTwoRows, "row2"), { groupId: "grp1", subgroupId: "" });
  assert.deepEqual(baseModelPlacementFromTemplate(jeraLike, "rowB2"), { groupId: "grpB", subgroupId: "__ungrouped__" });
  assert.equal(baseModelPlacementFromTemplate(jeraLike, null), null);
  assert.equal(baseModelPlacementFromTemplate(jeraLike, "rowGone"), null);
  // Inactive subgroups do not count as a configuration choice.
  const inactive = [{ ...jeraLike[1], subgroups: [{ ...sg("sb1", "Low", ["rowB1"], 0), is_active: false }] }];
  assert.deepEqual(baseModelPlacementFromTemplate(inactive, "rowB1"), { groupId: "grpB", subgroupId: "" });
});

test("selector: dropdowns start from the selected row (unchanged when none), the Save block only gains the two ids, Add paths unchanged", () => {
  const source = readFileSync(new URL("../../../components/quotations/product-library-selector.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('useState(() => baseModelPlacement(groups, selectedRowId)?.groupId ?? groups[0]?.id ?? "")'));
  assert.ok(source.includes('useState(() => baseModelPlacement(groups, selectedRowId)?.subgroupId ?? "")'));
  assert.ok(source.includes("onAddLocalItem?.(localProductItem);"));
  assert.ok(source.includes("action={reconfigure ? undefined : addProductTemplateToQuotation}"));
  assert.ok(source.includes("                                  Add to Local Workspace"));
  const lineStart = source.indexOf("const localProductItem: LocalQuotationItem = {");
  const stateStart = source.indexOf("const savedSetupState: SavedSetupPlainState = {");
  assert.ok(!/baseModelPlacement|variantGroupId|subgroupId/.test(source.slice(lineStart, stateStart)), "the quotation line is untouched");
  const saveBlock = source.slice(stateStart, source.indexOf("const mainItemCurrency", stateStart));
  assert.equal((saveBlock.match(/baseModelPlacement\(/g) ?? []).length, 2);
  // No-replay flow: the family/configuration selector key only changes when a setup is replayed.
  assert.ok(source.includes('key={`${nativeSystem.selected?.row.id ?? "no-system"}:${replay?.key ?? 0}`}'));
  const helper = readFileSync(new URL("./base-model-placement.ts", import.meta.url), "utf8");
  assert.ok(!/price|qty|quantity/i.test(helper.replace(/no prices/gi, "")), "placement helper deals with ids only");
});
