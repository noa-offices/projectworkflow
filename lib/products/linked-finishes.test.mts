import assert from "node:assert/strict";
import test from "node:test";
import { recipeFromLine, withConfigurationRecipe } from "./saved-setups/line-recipe";
import { buildRecipe, findForbiddenRecipeKey, SAVED_SETUP_MAX_BYTES, validateRecipeShape, type LinkedFinishChoice } from "./saved-setups/recipe";
import { evaluateSetup } from "./saved-setups/replay";

const templateId = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const template = { id: templateId, template_name: "Rebuilt Oxi", currency: "EUR", default_unit_price: 0 };
// Rebuilt UUIDs and a 131-material optional, multi-select group matching the reported catalogue size.
const options: LinkedFinishChoice[] = Array.from({ length: 131 }, (_, index) => [
  groupId, `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
]);
const base = {
  templateId,
  finishes: [{ finish_name: "Desk finish" }],
  linkedInstances: { screen: ["front", "side"] },
  linkedSelections: { "screen:front": { quantity: 1 }, "screen:side": { quantity: 2 } },
};

test("two linked instances save different finish choices while preserving the parent finish and legacy shape", () => {
  const state = { ...base, linkedSelections: {
    "screen:front": { ...base.linkedSelections["screen:front"], finishes: [options[0]] },
    "screen:side": { ...base.linkedSelections["screen:side"], finishes: [options[1], options[2]] },
  } };
  const { recipe, specOverrides } = buildRecipe(state);
  const legacy = buildRecipe(base).recipe;
  assert.deepEqual(legacy.linked.selections["screen:front"], { instance_quantity: 1, accessory_quantities: {} });
  const withoutChoices = structuredClone(recipe);
  for (const entry of Object.values(withoutChoices.linked.selections)) delete entry.finishes;
  assert.deepEqual(withoutChoices, legacy);
  assert.deepEqual(recipe.finishes, base.finishes);
  assert.deepEqual(recipe.linked.selections["screen:front"].finishes, [options[0]]);
  assert.deepEqual(recipe.linked.selections["screen:side"].finishes, [options[1], options[2]]);
  assert.equal(findForbiddenRecipeKey(recipe), null);
  assert.deepEqual(validateRecipeShape(recipe, specOverrides), { ok: true });

  const stored = JSON.parse(JSON.stringify(withConfigurationRecipe({}, state)));
  const reopened = recipeFromLine({ item_type: "product", source_template_id: templateId, source_component_data: stored });
  assert.ok(reopened.ok);
  const replayed = evaluateSetup(reopened.recipe, reopened.specOverrides, template, { linkedFamilyIds: ["screen"] });
  assert.ok(replayed.state);
  assert.deepEqual(replayed.state.finishes, base.finishes);
  assert.deepEqual(replayed.state.linkedSelections?.["screen:front"].finishes, [options[0]]);
  assert.deepEqual(replayed.state.linkedSelections?.["screen:side"].finishes, [options[1], options[2]]);
  assert.deepEqual(buildRecipe(replayed.state).recipe, recipe);
});

test("six fully selected rebuilt screens fit within the existing recipe size limit", () => {
  const ids = Array.from({ length: 6 }, (_, index) => `screen-${index + 1}`);
  const state = { templateId, linkedInstances: { link: ids }, linkedSelections: Object.fromEntries(
    ids.map((id) => [`link:${id}`, { finishes: options }]),
  ) };
  const recipe = buildRecipe(state).recipe;
  const bytes = Buffer.byteLength(JSON.stringify(recipe));
  assert.ok(bytes < SAVED_SETUP_MAX_BYTES, `${bytes} bytes`);
  assert.deepEqual(validateRecipeShape(recipe), { ok: true });
});
