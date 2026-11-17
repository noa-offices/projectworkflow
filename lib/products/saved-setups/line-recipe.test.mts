/* eslint-disable @typescript-eslint/no-explicit-any -- tiny supabase stub and deliberately hostile input */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRecipe, findForbiddenRecipeKey, hashSpecificationText, type SavedSetupPlainState } from "./recipe";
import {
  LINE_ADDED_BEFORE_HINT,
  LINE_RECIPE_KEY,
  buildLineConfigurationRecipe,
  isLineSaveable,
  parseLineConfigurationRecipe,
  recipeFromLine,
  withConfigurationRecipe,
} from "./line-recipe";
import { saveSetupForUser } from "./saved-setups-service";

const TPL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TPL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "11111111-1111-4111-8111-111111111111";
const GENERATED = "Fabric back.\nAluminium base.";

const states: Record<string, SavedSetupPlainState> = {
  priceMatrix: { templateId: TPL, mainCode: "EV211", categoryGroupId: "g1", categoryRowId: "r1", fabricCategory: "A", finishes: [{ group: "x", code: "F1" }], generatedSpecification: GENERATED },
  baseModel: { templateId: TPL, mainCode: "159 913", variantRowId: "v1", variantGroupId: "vg", subgroupId: "sg", generatedSpecification: GENERATED },
  modular: { templateId: TPL, mainCode: "M1", fabricCategory: "B", modularQuantities: { m1: 2, m2: 1 }, pricingAccessoryQuantities: { a1: 1 }, generatedSpecification: GENERATED },
  workstation: { templateId: TPL, mainCode: "WS", workstationSizeId: "s1", workstationLayout: "L", additionalClusterQuantity: 2, dimensionOverride: "1200x600", generatedSpecification: GENERATED },
  system: { templateId: TPL, mainCode: "SYS", systemRowId: "sys1", systemQuantity: 3, variantRowId: "v2", generatedSpecification: GENERATED },
};

function lineFor(state: SavedSetupPlainState, patch: Record<string, unknown> = {}) {
  const source = withConfigurationRecipe({ template_name: "Every", template_code: "EV" }, state);
  return {
    item_type: "product",
    source_template_id: state.templateId,
    source_component_data: source,
    specification_snapshot: GENERATED,
    item_name_snapshot: "Every",
    ...patch,
  };
}

// isLineSaveable
test("isLineSaveable: template line with recipe is saveable", () => {
  assert.deepEqual(isLineSaveable(lineFor(states.priceMatrix)), { saveable: true });
});

test("isLineSaveable: an old template line without a recipe is not saveable and shows the added-before hint", () => {
  const old = { item_type: "product", source_template_id: TPL, source_component_data: { template_name: "Every" }, specification_snapshot: "x" };
  const result = isLineSaveable(old);
  assert.equal(result.saveable, false);
  assert.equal((result as any).reason, "added_before");
  assert.equal((result as any).message, "Added before My Collection. Add it again to save it.");
  assert.equal(LINE_ADDED_BEFORE_HINT, "Added before My Collection. Add it again to save it.");
  assert.equal(isLineSaveable({ ...old, source_component_data: null }).saveable, false);
});

test("isLineSaveable: custom, note and blank rows are never saveable (no button)", () => {
  for (const item_type of ["custom", "note", "blank", "heading", "subtotal"]) {
    const result = isLineSaveable({ item_type, source_template_id: null, source_component_data: null });
    assert.equal(result.saveable, false);
    assert.equal((result as any).reason, "not_a_template_line");
  }
  assert.equal(isLineSaveable(lineFor(states.baseModel, { item_type: "custom" })).saveable, false);
  assert.equal(isLineSaveable(lineFor(states.baseModel, { source_template_id: null })).saveable, false);
});

test("a stored recipe for a different template than the line's template is not saveable", () => {
  assert.equal(isLineSaveable(lineFor(states.baseModel, { source_template_id: OTHER_TPL })).saveable, false);
});

// recipeFromLine
test("recipeFromLine: no price or quantity keys, for every product kind", () => {
  for (const [kind, state] of Object.entries(states)) {
    const result = recipeFromLine(lineFor(state));
    assert.equal(result.ok, true, kind);
    if (!result.ok) continue;
    assert.equal(findForbiddenRecipeKey(result.recipe), null, kind);
    assert.equal(findForbiddenRecipeKey(result.specOverrides), null, kind);
    assert.equal(findForbiddenRecipeKey(result.state), null, kind);
    assert.equal(result.templateId, TPL);
  }
});

test("recipeFromLine: an unchanged line round-trips to exactly the recipe the selector's Save button builds", () => {
  for (const [kind, state] of Object.entries(states)) {
    const result = recipeFromLine(lineFor(state));
    assert.ok(result.ok, kind);
    if (!result.ok) continue;
    const fromSelector = buildRecipe(state);
    assert.deepEqual(result.recipe, fromSelector.recipe, kind);
    assert.deepEqual(result.specOverrides, fromSelector.specOverrides, kind);
  }
});

test("recipeFromLine: specification rule - same text saves no override; edited text saves override plus base hash", () => {
  const same = recipeFromLine(lineFor(states.baseModel));
  assert.ok(same.ok);
  if (same.ok) {
    assert.equal(same.specOverrides.specification_edited, false);
    assert.equal(same.specOverrides.edited_specification, null);
    assert.equal(same.specOverrides.generated_specification_hash, hashSpecificationText(GENERATED));
  }
  const spaced = recipeFromLine(lineFor(states.baseModel, { specification_snapshot: "  Fabric back.   Aluminium base.\n" }));
  assert.ok(spaced.ok && spaced.specOverrides.specification_edited === false);

  const edited = recipeFromLine(lineFor(states.baseModel, { specification_snapshot: "Leather back. Aluminium base." }));
  assert.ok(edited.ok);
  if (edited.ok) {
    assert.equal(edited.specOverrides.specification_edited, true);
    assert.equal(edited.specOverrides.edited_specification, "Leather back. Aluminium base.");
    assert.equal(edited.specOverrides.generated_specification_hash, hashSpecificationText(GENERATED));
  }
});

test("recipeFromLine: the line text is the truth, also when the text was edited in the selector before Add", () => {
  const editedAtAdd: SavedSetupPlainState = { ...states.baseModel, specificationEdited: true, editedSpecification: "Custom text", generatedSpecification: GENERATED };
  const result = recipeFromLine(lineFor(editedAtAdd, { specification_snapshot: "Custom text" }));
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.specOverrides.edited_specification, "Custom text");
    assert.equal(result.specOverrides.generated_specification_hash, hashSpecificationText(GENERATED));
  }
  const reverted = recipeFromLine(lineFor(editedAtAdd, { specification_snapshot: GENERATED }));
  assert.ok(reverted.ok && reverted.specOverrides.specification_edited === false);
});

test("recipeFromLine: default name is the product name first, then the main code; old lines return a reason", () => {
  const result = recipeFromLine(lineFor(states.priceMatrix));
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.defaultName, "Every EV211");
  const old = recipeFromLine({ item_type: "product", source_template_id: TPL, source_component_data: {} });
  assert.equal(old.ok, false);
  if (!old.ok) assert.equal(old.reason, "added_before");
});

// The recipe attached at add time
test("attached recipe equals the recipe the selector's Save button builds (no drift) for all product kinds", () => {
  for (const [kind, state] of Object.entries(states)) {
    const attached = (withConfigurationRecipe({}, state) as any)[LINE_RECIPE_KEY];
    const built = buildRecipe(state);
    assert.deepEqual(attached, { recipe: built.recipe, spec_overrides: built.specOverrides }, kind);
    assert.deepEqual(attached, buildLineConfigurationRecipe(state), kind);
  }
});

test("snapshot comparison: only configuration_recipe is added; every existing key and value is unchanged", () => {
  const existing = {
    template_code: "EV", template_name: "Every", specification: "S", dimension: "1x1",
    selected_options_snapshot: [{ item_type: "modular_item", group_id: "g", qty: 2, unit_price: 100, total: 200 }],
    source_price_reference: { price: 100 }, add_ons: { groups: [] },
  };
  const before = structuredClone(existing);
  const after = withConfigurationRecipe(existing, states.modular);
  assert.deepEqual(existing, before, "input is not mutated");
  const { [LINE_RECIPE_KEY]: added, ...rest } = after as Record<string, unknown>;
  assert.deepEqual(rest, before);
  assert.ok(added);
  assert.deepEqual(Object.keys(after).sort(), [...Object.keys(before), LINE_RECIPE_KEY].sort());
});

test("pricing is identical with and without the new key; no pricing or document file reads it", () => {
  const existing = { source_price_reference: { price: 100 } };
  const after = withConfigurationRecipe(existing, states.workstation) as Record<string, unknown>;
  const { [LINE_RECIPE_KEY]: _recipe, ...rest } = after;
  void _recipe;
  assert.deepEqual(rest, existing);
  for (const file of ["lib/local/quotation-workspace.ts", "lib/local/quotation-publication-payload.ts", "lib/quotations/derived-document-data.ts", "lib/quotations/native-system-base.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /configuration_recipe/, file);
  }
});

test("a recipe that carries a price-like key is not attached (the line is still added, just not saveable)", () => {
  const dirty: SavedSetupPlainState = { ...states.baseModel, finishes: [{ price: 10 }] };
  assert.deepEqual(withConfigurationRecipe({ a: 1 }, dirty), { a: 1 });
});

// Consumers of source_component_data (source-text checks)
test("consumers copy source_component_data whole and never iterate its keys; duplicate and paste keep the recipe", () => {
  const builder = readFileSync("components/quotations/local-quotation-builder.tsx", "utf8");
  assert.match(builder, /function duplicateItem[\s\S]*?\.\.\.source,/);
  assert.match(builder, /function cloneQuotationRowForSection[\s\S]*?cloneUnknown\(source\)[\s\S]*?\.\.\.rowSnapshot,/);
  assert.match(readFileSync("app/quotations/actions.ts", "utf8"), /source_component_data: source\.source_component_data \?\? null,/);
  assert.match(readFileSync("lib/local/quotation-publication-payload.ts", "utf8"), /source_component_data: jsonValue\(item\.source_component_data\)/);
  for (const file of ["supabase/migrations/20261107100000_project_snapshots.sql", "supabase/migrations/20261108100000_project_variations.sql"]) {
    const sql = readFileSync(file, "utf8");
    assert.doesNotMatch(sql, /source_component_data\s*->/, file);
    assert.doesNotMatch(sql, /jsonb_each\(\s*\w*\.?source_component_data/, file);
  }
  for (const file of ["app/quotations/actions.ts", "components/quotations/local-quotation-builder.tsx", "lib/quotations/derived-document-data.ts", "app/quotations/[id]/builder/page.tsx"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /Object\.(keys|entries|values)\(\s*(?:\w+\.)?source_component_data/, file);
  }
});

// Server path
test("server path: tampered recipes are rejected (price-like keys, oversize, wrong template id, bad JSON)", () => {
  const good = JSON.stringify(buildLineConfigurationRecipe(states.baseModel));
  assert.ok(parseLineConfigurationRecipe(good, TPL));
  assert.equal(parseLineConfigurationRecipe(good, OTHER_TPL), null, "recipe for a different template");
  assert.equal(parseLineConfigurationRecipe("{not json", TPL), null);
  assert.equal(parseLineConfigurationRecipe("", TPL), null);
  assert.equal(parseLineConfigurationRecipe(null, TPL), null);
  assert.equal(parseLineConfigurationRecipe(good, "not-a-uuid"), null);
  const base = buildLineConfigurationRecipe(states.baseModel) as any;
  assert.equal(parseLineConfigurationRecipe(JSON.stringify({ ...base, recipe: { ...base.recipe, unit_price: 5 } }), TPL), null);
  assert.equal(parseLineConfigurationRecipe(JSON.stringify({ ...base, recipe: { ...base.recipe, qty: 5 } }), TPL), null);
  assert.equal(parseLineConfigurationRecipe(JSON.stringify({ ...base, spec_overrides: { ...base.spec_overrides, net_total: 5 } }), TPL), null);
  assert.equal(parseLineConfigurationRecipe(JSON.stringify({ ...base, recipe: { ...base.recipe, finishes: [{ blob: "x".repeat(70000) }] } }), TPL), null);
  assert.equal(parseLineConfigurationRecipe(JSON.stringify({ recipe: base.recipe }), TPL), null, "missing spec_overrides");
});

test("server path is wired: the form field is validated against the line's template and only then stored", () => {
  const actions = readFileSync("app/quotations/actions.ts", "utf8");
  assert.match(actions, /parseLineConfigurationRecipe\(formData\.get\(LINE_RECIPE_FORM_FIELD\), template\.id\)/);
  assert.match(actions, /\.\.\.submittedConfigurationRecipe,/);
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(selector, /name=\{LINE_RECIPE_FORM_FIELD\}/);
  assert.match(selector, /localProductItem\.source_component_data = withConfigurationRecipe\(/);
});

// Saving
function stubSupabase(template: Record<string, unknown> | null, inserted: Array<Record<string, any>>) {
  const query = (table: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      insert: (row: Record<string, any>) => { inserted.push(row); return q; },
      maybeSingle: () => Promise.resolve({ data: table === "product_templates" ? template : { name: "Brand" }, error: null }),
      single: () => Promise.resolve({ data: { id: "new-id" }, error: null }),
    };
    return q;
  };
  return { from: query } as unknown as SupabaseClient;
}

test("saving a line: the saved recipe has no price or line quantity and keeps the edited spec with its base hash", async () => {
  const result = recipeFromLine(lineFor(states.system, { specification_snapshot: "Edited" }));
  assert.ok(result.ok);
  if (!result.ok) return;
  const inserted: Array<Record<string, any>> = [];
  const template = { id: TPL, brand_id: null, template_name: "Every", is_active: true, lifecycle_status: "active", pricing_version: 3 };
  const saved = await saveSetupForUser(stubSupabase(template, inserted), USER, { templateId: result.templateId, setupName: result.defaultName, state: result.state });
  assert.equal(saved.ok, true);
  const row = inserted[0];
  assert.equal(row.owner_id, USER);
  assert.equal(findForbiddenRecipeKey(row.recipe), null);
  assert.equal(findForbiddenRecipeKey(row.spec_overrides), null);
  assert.equal(row.spec_overrides.edited_specification, "Edited");
  assert.equal(row.spec_overrides.generated_specification_hash, hashSpecificationText(GENERATED));
  assert.equal(row.recipe.selections.system_row_id, "sys1");
});

test("saving from a line whose template is now archived or removed fails with the existing clear message", async () => {
  const result = recipeFromLine(lineFor(states.baseModel));
  assert.ok(result.ok);
  if (!result.ok) return;
  const inserted: Array<Record<string, any>> = [];
  const archived = { id: TPL, brand_id: null, template_name: "Every", is_active: true, lifecycle_status: "archived", pricing_version: 1 };
  const a = await saveSetupForUser(stubSupabase(archived, inserted), USER, { templateId: result.templateId, setupName: "n", state: result.state });
  const b = await saveSetupForUser(stubSupabase(null, inserted), USER, { templateId: result.templateId, setupName: "n", state: result.state });
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal((a as any).error, (b as any).error);
  assert.equal(inserted.length, 0);
});
