import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { LinkedAccessoryPopup } from "../../components/quotations/linked-accessory-popup";
import { activeAccessoryRows, priceConfiguration, type ConfigurationPriceInput } from "./configuration-price";
import { linkedAccessoryRow } from "./linked-accessory-rules";
import { LINE_RECIPE_KEY, recipeFromLine, withConfigurationRecipe } from "./saved-setups/line-recipe";
import { buildRecipe, findForbiddenRecipeKey, validateRecipeShape, type SavedSetupLinkedSelection } from "./saved-setups/recipe";
import { evaluateSetup } from "./saved-setups/replay";
import { configurationPriceFixtures } from "./testing/configuration-price-fixtures";

// Rebuilt Universal Screen rule with the reported €35 stirrup and a second eligible choice.
const input = configurationPriceFixtures().find(({ name }) =>
  name.startsWith("Oxi_R screen ") && name.includes("cat-b") && name.endsWith("x undefined, add true, other brand false"),
)!.input;
const family = input.context.linked![0];
const chosen = family.instances[0];
const child = {
  ...family.childTemplate!,
  accessory_pricing: [
    {
      id: "front", group_name: "Front Stirrups",
      conditional_configuration: { role: "companion" as const, selection: "exactly_one" as const, applicability: [{
        target: { kind: "price_matrix" as const, group_id: "fabric-front", row_id: "s2-l140" },
        required: true, visible: true, fixed_quantity: 1,
      }] },
      items: [{ id: "883", item_name: "Stirrup 883", price: 35 }, { id: "880", item_name: "Stirrup 880", price: 25 }],
    },
    { id: "extras", group_name: "Extras", items: [{ id: "extra", item_name: "Optional accessory", price: 4 }] },
  ],
};
const stored = { "883": 1, extra: 2 };
type Instance = NonNullable<ConfigurationPriceInput["context"]["linked"]>[number]["instances"][number];
const instance = (quantity: number, enabled: true | undefined, id = "a"): Instance => ({
  ...chosen, instance: { id, label: id }, quantity, accessoryQuantities: stored, perScreenFixedQuantities: enabled,
});
const price = (...instances: Instance[]) =>
  priceConfiguration({ ...input, context: { ...input.context, linked: [{ ...family, childTemplate: child, instances }] } });

test("fixed stirrup scales from €35 to €70 to €105; typed quantities and legacy prices stay put", () => {
  for (const qty of [1, 2, 3]) {
    const legacy = price(instance(qty, undefined));
    const applied = price(instance(qty, true));
    assert.equal(legacy.lines.linkedAccessorySummary[0].total, 35);
    assert.deepEqual(applied.lines.linkedAccessorySummary.map(({ qty, total }) => [qty, total]), [[qty, qty * 35], [2, 8]]);
    assert.deepEqual(applied.linked[0].selectedAccessories.map(({ qty }) => qty), [qty, 2]);
    assert.equal(applied.linked[0].accessoryTotal, qty * 35 + 8);
    assert.equal(applied.buckets.originalCurrencyTotals.get("EUR"), qty * 138 + qty * 35 + 8);
    if (qty === 1) assert.deepEqual(applied, legacy);
  }
  const two = price(instance(2, true), instance(3, true, "b"));
  assert.deepEqual(two.linked.map(({ accessoryTotal }) => accessoryTotal), [78, 113]);
  assert.deepEqual(two.lines.linkedAccessorySummary.map(({ qty }) => qty), [2, 2, 3, 2]);
});

test("popup preserves the legacy subtotal until Apply and shows the effective count after reopening", () => {
  const row = linkedAccessoryRow(price(instance(2, undefined)).linked[0]);
  const markup = (enabled?: true) => renderToStaticMarkup(createElement(LinkedAccessoryPopup, {
    title: "Screen", groups: activeAccessoryRows(child.accessory_pricing), row, savedQuantities: Object.freeze(stored),
    instanceQuantity: 2, perScreenFixedQuantities: enabled, money: String,
    renderFields: () => null,
    onApply: () => assert.fail("Rendering must not apply the draft"),
    onClose: () => assert.fail("Rendering must not close the popup"),
  }));
  assert.match(markup(), /Accessories: 43/);
  assert.match(markup(), /On Apply: Stirrup 883: 1 per screen x 2 screens = 2/);
  assert.match(markup(true), /Accessories: 78/);
  assert.match(markup(true), /Stirrup 883: 1 per screen x 2 screens = 2/);
  assert.deepEqual(stored, { "883": 1, extra: 2 });
});

test("the optional flag and per-screen quantities survive quotation and My Collection replay", () => {
  const templateId = "11111111-1111-4111-8111-111111111111";
  const parent = { ...input.template, id: templateId };
  for (const flag of [undefined, true] as const) {
    const selection: SavedSetupLinkedSelection = { quantity: 2, accessoryQuantities: stored, perScreenFixedQuantities: flag };
    const state = { templateId, linkedInstances: { screen: ["a"] }, linkedSelections: { "screen:a": selection } };
    const built = buildRecipe(state);
    const snapshot = withConfigurationRecipe({}, state);
    assert.deepEqual(validateRecipeShape(built.recipe), { ok: true });
    assert.equal(findForbiddenRecipeKey(built.recipe), null);
    assert.deepEqual(built.recipe.linked.selections["screen:a"], {
      instance_quantity: 2, accessory_quantities: stored, ...(flag ? { per_screen_fixed_quantities: true } : {}),
    });
    assert.ok(LINE_RECIPE_KEY in snapshot);
    const reopened = recipeFromLine({ item_type: "product", source_template_id: templateId, source_component_data: snapshot });
    assert.ok(reopened.ok);
    const fromCollection = evaluateSetup(built.recipe, built.specOverrides, parent, { linkedFamilyIds: ["screen"] });
    for (const restored of [reopened.state, fromCollection.state]) {
      const linked = restored.linkedSelections?.["screen:a"];
      assert.deepEqual(linked?.accessoryQuantities, stored);
      assert.equal(linked?.perScreenFixedQuantities, flag);
      assert.equal(price(instance(2, linked?.perScreenFixedQuantities)).lines.linkedAccessorySummary[0].total, flag ? 70 : 35);
    }
  }
});

test("the older Add guard blocks multiple linked units only when an accessory is selected", () => {
  const file = readFileSync(new URL("../../app/quotations/actions.ts", import.meta.url), "utf8");
  const guard = ts.createSourceFile("actions.ts", file, ts.ScriptTarget.Latest, true);
  const statements: ts.IfStatement[] = [];
  function visit(node: ts.Node) {
    if (ts.isIfStatement(node) && node.thenStatement.getText(guard).includes("add more than one linked product with accessories")) statements.push(node);
    ts.forEachChild(node, visit);
  }
  visit(guard);
  assert.equal(statements.length, 1);
  const check = new Function("selection", "qty", "redirectPath", "redirectWithMessage", statements[0].getText(guard));
  for (const units of [1, 2, 3]) {
    for (const qty of [0, 1, 2]) {
      const messages: string[] = [];
      check({ qty: units }, qty, "/quote", (_: string, message: string) => messages.push(message));
      assert.equal(messages.length, units > 1 && qty > 0 ? 1 : 0);
      if (messages.length) assert.match(messages[0], /local quotation builder/);
    }
  }
});
