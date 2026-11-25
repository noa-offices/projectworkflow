import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { accessoryPriceLines, evaluateAccessoryRules } from "./accessory-rule-setup";
import { evaluateLinkedAccessories, linkedAccessoryPopupBlockReason } from "./linked-accessory-rules";
import { resolveMainAccessoryTargets } from "./main-accessory-targets";
import { buildRecipe } from "./saved-setups/recipe";
import { allowedFor, ALL_GROUPS, FELT, FRONT, itemId, rule, targetsOf } from "./testing/universal-screen-rules-fixture";
import { LinkedAccessoryPopup, nextLinkedQuantities } from "../../components/quotations/linked-accessory-popup";

// Universal Screen as a linked child. Prices from the reported case: S1 L100 EUR 62, S2 L140 cat-c EUR 140, stirrup 883 EUR 35.
const S1_L100 = { kind: "base_model" as const, groupId: "mel-front", rowId: "mel-front-r1", price: 62 };
const S2_L140 = { kind: "price_matrix" as const, groupId: "us-m-fabric-front", rowId: "us-m-fabric-front-r1", prices: { "cat-b": 130, "cat-c": 140 } };
const FELT_LATERAL = { kind: "base_model" as const, groupId: "felt-lateral", rowId: "felt-lateral-r1" };
const FELT_MODESTY = { kind: "base_model" as const, groupId: "felt-modesty", rowId: "felt-modesty-r2" };
const FELT_FRONT = { kind: "base_model" as const, groupId: "felt-front", rowId: "felt-front-r3" };
const stirrupPrice = (code: string) => (code === "883" ? 35 : 20 + Number(code) % 9);
const item = (id: string, price: number) => ({ id, item_name: id, supplier_price_list_code: id.split("-").pop(), price, currency: "EUR", is_active: true });
const groups = [
  { id: "us-og-front-stirrups-880", group_name: "Front Stirrups", group_is_required: true, items: FELT.map((code) => item(itemId(code), stirrupPrice(code))), conditional_configuration: { role: "accessory" as const, selection: "at_least_one" as const, applicability: Object.keys(ALL_GROUPS).flatMap((groupId) => targetsOf(groupId).map((target) => rule(target, allowedFor(groupId)))) } },
  { id: "us-og-lateral", group_name: "Lateral Stirrups", group_is_required: true, items: [item("us-lat-881", 18)], conditional_configuration: { role: "companion" as const, selection: "exactly_one" as const, applicability: targetsOf("felt-lateral").map((target) => ({ target, required: true, visible: true, fixed_quantity: 1 })) } },
  { id: "us-og-optional", group_name: "Optional Items", group_is_required: false, items: [item("us-opt-920", 3)] },
];
type Row = typeof S1_L100 | typeof S2_L140 | typeof FELT_LATERAL;

/** The standalone page for the same selection: its own target helper, the shared rules and prices. */
function standalone(row: Row, quantities: Record<string, number>) {
  const target = { kind: row.kind, group_id: row.groupId, row_id: row.rowId };
  const targets = resolveMainAccessoryTargets({ workstation: [], usesModularPricing: false, modular: [], baseModel: row.kind === "base_model" ? [target] : [], priceMatrix: row.kind === "price_matrix" ? [target] : [] });
  const rules = evaluateAccessoryRules({ groups, baseModelGroupId: row.kind === "base_model" ? row.groupId : null, baseModelRowId: row.kind === "base_model" ? row.rowId : null, targets, targetQuantities: {}, quantities, overrides: {} });
  return { configuration: rules.configuration, lines: accessoryPriceLines(groups, rules.configuration.activeQuantities, () => undefined) };
}
const view = (configuration: ReturnType<typeof standalone>["configuration"]) => configuration.groups.filter((group) => group.visible).map((group) => ({ id: group.groupId, required: group.required, max: group.maxSelections, allowed: [...group.allowedItemIds].sort(), valid: group.valid }));
const priced = (lines: ReturnType<typeof standalone>["lines"]) => lines.map((line) => [line.accessory.id, line.qty, line.unitPrice]);

test("linked popup and standalone page agree: visible groups, required status, accessory prices", () => {
  for (const row of [S1_L100, S2_L140, FELT_LATERAL, FELT_MODESTY, FELT_FRONT]) {
    for (const quantities of [{}, { [itemId("883")]: 1 }, { [itemId("880")]: 2, "us-opt-920": 1 }]) {
      const linked = evaluateLinkedAccessories({ groups, row, quantities });
      const page = standalone(row, quantities);
      assert.deepStrictEqual(view(linked.configuration), view(page.configuration), `${row.rowId} ${JSON.stringify(quantities)}`);
      assert.deepStrictEqual(priced(linked.priceLines), priced(page.lines));
      assert.equal(linked.blocked, !page.configuration.valid);
    }
  }
});

test("Front Stirrups is required on S1 and S2 fronts and blocks Apply until chosen; 883 costs EUR 35", () => {
  for (const row of [S1_L100, S2_L140]) {
    const empty = evaluateLinkedAccessories({ groups, row, quantities: {} });
    const front = empty.configuration.groups.find((group) => group.groupId === "us-og-front-stirrups-880")!;
    assert.deepEqual([front.visible, front.required, empty.blocked], [true, true, true]);
    assert.deepEqual([...front.allowedItemIds].sort(), FRONT.map(itemId).sort());
    const chosen = evaluateLinkedAccessories({ groups, row, quantities: { [itemId("883")]: 1 } });
    assert.equal(chosen.blocked, false);
    assert.deepEqual(priced(chosen.priceLines), [[itemId("883"), 1, 35]]);
    assert.deepEqual(chosen.savedQuantities, { [itemId("883")]: 1 });
  }
  // The linked base prices use the same row lookup as the standalone page.
  assert.equal(S1_L100.price, 62);
  assert.equal(S2_L140.prices["cat-c"], 140);
});

test("Felt Lateral and Felt Modesty offer 880 only; felt front offers all seven", () => {
  for (const row of [FELT_LATERAL, FELT_MODESTY]) {
    const front = evaluateLinkedAccessories({ groups, row, quantities: {} }).configuration.groups.find((group) => group.groupId === "us-og-front-stirrups-880")!;
    assert.deepEqual(front.allowedItemIds, [itemId("880")]);
  }
  assert.deepEqual([...evaluateLinkedAccessories({ groups, row: FELT_FRONT, quantities: {} }).configuration.groups[0]!.allowedItemIds].sort(), FELT.map(itemId).sort());
});

test("a required companion is added and locked; a removal attempt changes nothing", () => {
  const linked = evaluateLinkedAccessories({ groups, row: FELT_LATERAL, quantities: { [itemId("880")]: 1 } });
  assert.deepEqual(linked.savedQuantities, { [itemId("880")]: 1, "us-lat-881": 1 });
  assert.ok(linked.lockedItemIds.has("us-lat-881"));
  const quantities = { "us-lat-881": 1 };
  assert.equal(nextLinkedQuantities(quantities, linked.lockedItemIds, ["us-lat-881"], "us-lat-881", 0, false), quantities);
  assert.deepEqual(nextLinkedQuantities({ a: 1 }, new Set(), ["a", "b"], "b", 1, true), { b: 1 }, "exactly-one replaces the group, as on the page");
});

test("an old saved choice is not changed by opening or cancelling; only Apply writes", () => {
  // Saved by the old panel: 880 on an S1 front (allowed) plus an item that the rules would now hide.
  const saved = { [itemId("880")]: 1, [itemId("887")]: 1 };
  const frozen = structuredClone(saved);
  let applied: Record<string, number> | null = null;
  const html = renderToStaticMarkup(createElement(LinkedAccessoryPopup, { title: "Front screen", groups, row: S1_L100, savedQuantities: saved, money: (amount: number) => `EUR ${amount.toFixed(2)}`, renderFields: () => null, onApply: (next: Record<string, number>) => { applied = next; }, onClose: () => {} }));
  assert.ok(html.includes("Required: 1 of 1 groups chosen"));
  assert.ok(html.includes(`Accessories: EUR ${stirrupPrice("880").toFixed(2)}`), "the preview prices only what the rules allow");
  assert.ok(html.includes("1 saved item does not apply to the chosen model and will be removed on Apply."));
  assert.deepEqual([saved, applied], [frozen, null]);
  // The parent keeps pricing the old record until Apply: (880 at 20) + (887 at 23), as before.
  const parentTotal = Object.entries(saved).reduce((sum, [id, qty]) => sum + qty * groups[0]!.items.find((entry) => entry.id === id)!.price, 0);
  assert.equal(parentTotal, stirrupPrice("880") + stirrupPrice("887"));
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.ok(selector.includes("setLinkedAccessoryQuantities((current) => ({ ...current, [line.instanceKey]: accessoryQuantities }));"));
  assert.ok(selector.includes("onClose={() => setLinkedAccessoryPopupKey(null)}"));
  assert.ok(selector.includes(".reduce((total, line) => total + line.qty * numberValue(line.accessory.price), 0);"), "parent linked totals are unchanged");
});

test("Apply stores the existing format: the saved setup is identical to what the old panel stored for the same choice", () => {
  const applied = evaluateLinkedAccessories({ groups, row: S1_L100, quantities: { [itemId("883")]: 2, "us-opt-920": 1 } }).savedQuantities;
  const oldPanel = { [itemId("883")]: 2, "us-opt-920": 1 };
  const state = (accessoryQuantities: Record<string, number>) => ({ templateId: "11111111-1111-4111-8111-111111111111", linkedInstances: { link: ["link-default"] }, linkedSelections: { "link:link-default": { variantRowId: S1_L100.rowId, quantity: 1, accessoryQuantities } } });
  assert.deepStrictEqual(buildRecipe(state(applied)), buildRecipe(state(oldPanel)));
  assert.deepStrictEqual(Object.keys(applied).sort(), Object.keys(oldPanel).sort());
});

test("category-priced, structural-support and id-less accessories keep the classic panel", () => {
  assert.equal(linkedAccessoryPopupBlockReason(groups), null);
  assert.match(linkedAccessoryPopupBlockReason([{ ...groups[2]!, price_categories: [{ id: "a", label: "A" }] }])!, /priced by category/);
  assert.match(linkedAccessoryPopupBlockReason([{ ...groups[2]!, items: [{ ...item("s", 1), role: "structural_support" }] }])!, /structural support/);
  assert.match(linkedAccessoryPopupBlockReason([{ ...groups[2]!, items: [{ item_name: "x", price: 1 }] }])!, /no id/);
});

test("the popup reuses the standalone accessory section and the selector wiring", () => {
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8").replace(/\r\n/g, "\n");
  ["renderFields={(props) => <AccessoryConfigurationFields {...props}", "evaluateAccessoryRules({", "accessoryPriceLines(allAccessoryGroups, accessoryConfiguration.activeQuantities", "!linkedAccessoryPopupBlockReason(line.childAccessoryGroups)", "<LinkedAccessoryList"].forEach((expected) => assert.ok(selector.includes(expected), expected));
});
