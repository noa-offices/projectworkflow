import assert from "node:assert/strict";
import test from "node:test";
import { accessoryPriceLines } from "./accessory-rule-setup";
import { priceConfiguration } from "./configuration-price";
import { evaluateLinkedAccessories } from "./linked-accessory-rules";
import { buildRecipe, restorePlainState } from "./saved-setups/recipe";
import { configurationPriceFixtures } from "./testing/configuration-price-fixtures";

// Supplier codes and endpoint prices are reported values. The six middle pairs and IDs are rebuilt.
const prices = [[49, 54], [61, 65], [72, 78], [94, 99], [110, 113], [140, 149], [178, 186], [198, 204]];
const group = {
  id: "sound", group_name: "Sound-Proofing Accessories",
  price_categories: ["cat-d", "cat-e"].map((id) => ({ id, label: id })),
  items: prices.map(([d, e], index) => ({
    id: `sound-${913 + index}`, item_name: `103 ${913 + index}`, price: null,
    prices: { "cat-d": d, "cat-e": e }, currency: "EUR",
  })),
};

test("both Oxi parents, three screen prices and all 16 sound-proofing choices agree with standalone", () => {
  const fixtures = configurationPriceFixtures();
  for (const parent of ["Oxi_L", "Oxi_R"]) {
    for (const [row, base] of [["s1-l100", 62], ["cat-b", 138], ["cat-c", 140]] as const) {
      const fixture = fixtures.find(({ name }) => name.startsWith(parent + " screen ") && name.includes(row) && name.endsWith("x undefined, add true, other brand false"))!;
      const link = fixture.input.context.linked![0];
      const childTemplate = { ...link.childTemplate!, accessory_pricing: [group] };
      for (const item of group.items) {
        for (const category of ["cat-d", "cat-e"] as const) {
          const quantities = { [item.id]: 2 };
          const categories = { [item.id]: category };
          const popup = evaluateLinkedAccessories({ groups: [group], row: null, quantities, categories });
          const standalone = accessoryPriceLines([group], quantities, () => category);
          assert.deepEqual(popup.priceLines, standalone);
          assert.deepEqual(popup.savedCategories, categories);
          const unit = item.prices[category];
          assert.equal(popup.priceLines[0].unitPrice, unit);
          const instance = { ...link.instances[0], accessoryQuantities: quantities, accessoryCategories: popup.savedCategories };
          const result = priceConfiguration({ ...fixture.input, context: { ...fixture.input.context, linked: [{ ...link, childTemplate, instances: [instance] }] } });
          assert.equal(result.linked[0].unitPrice, base);
          assert.equal(result.linked[0].accessoryTotal, 2 * unit);
          assert.equal(result.lines.linkedAccessorySummary[0].unitPrice, unit);
          assert.equal(result.buckets.originalCurrencyTotals.get("EUR"), base + 2 * unit);
        }
      }
    }
  }
});

test("Apply saves only active category choices, including the displayed default; legacy recipes round-trip without the field", () => {
  const quantities = Object.freeze({ "sound-913": 1 });
  const categories = Object.freeze({ "sound-920": "cat-e" });
  const preview = evaluateLinkedAccessories({ groups: [group], row: null, quantities, categories });
  assert.deepEqual(preview.savedCategories, { "sound-913": "cat-d" });
  const selection = { quantity: 1, accessoryQuantities: quantities };
  const state = { templateId: "11111111-1111-4111-8111-111111111111", linkedInstances: { link: ["one"] }, linkedSelections: { "link:one": selection } };
  const legacy = buildRecipe(state);
  assert.deepEqual(legacy.recipe.linked.selections["link:one"], { instance_quantity: 1, accessory_quantities: quantities });
  const applied = buildRecipe({ ...state, linkedSelections: { "link:one": { ...selection, accessoryCategories: preview.savedCategories } } });
  const expected = structuredClone(legacy);
  expected.recipe.linked.selections["link:one"].accessory_categories = { "sound-913": "cat-d" };
  assert.deepEqual(applied, expected);
  for (const built of [legacy, applied]) {
    assert.deepEqual(buildRecipe(restorePlainState(built.recipe, built.specOverrides)), built);
  }
});
