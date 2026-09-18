import assert from "node:assert/strict";
import test from "node:test";
import { categoryPricingValue } from "./category-pricing-value.js";

/** Loosely typed view of a submitted-then-normalized Modular group, for test assertions only. */
type NormalizedModularGroup = {
  id: string;
  pricing_type?: string | null;
  modular_pricing_mode?: string;
  modular_composition?: { min_starters: number; max_starters: number | null };
  price_categories?: string[];
  items: Array<Record<string, unknown> & { id: string }>;
};

function findGroup(groups: ReturnType<typeof categoryPricingValue>, id: string) {
  return groups.find((group) => group.id === id) as unknown as NormalizedModularGroup;
}

/** Submitted "modular_item_pricing" FormData shape: a Direct Modular group plus its rows. */
function directModularSubmission() {
  return JSON.stringify([{
    id: "mod-oxi-p-bench",
    group_name: "OXI_P Bench",
    pricing_type: "modular_group",
    modular_pricing_mode: "direct",
    modular_composition: { min_starters: 1, max_starters: 1 },
    is_active: true,
    sort_order: 0,
    items: [
      { id: "bench-starter-120", display_name: "Starter Bench 120", supplier_price_list_code: "111 065", price: 425, currency: "EUR", modular_role: "starter", specification: "Panel-base starter bench.", importantRequirements: ["Move the panel to terminal position to finish the composition."], is_active: true, sort_order: 0 },
      { id: "bench-intermediate-120", display_name: "Intermediate Bench 120", supplier_price_list_code: "111 069", price: 421, currency: "EUR", modular_role: "intermediate", is_active: true, sort_order: 1 },
    ],
  }]);
}

test("Direct Modular round trip: group id, pricing_mode, and composition survive categoryPricingValue unchanged", () => {
  const groups = categoryPricingValue("", directModularSubmission(), "");
  const group = findGroup(groups, "mod-oxi-p-bench");
  assert.ok(group, "Expected the Direct Modular group to survive normalization");
  assert.equal(group.pricing_type, "modular_group");
  assert.equal(group.modular_pricing_mode, "direct");
  assert.deepEqual(group.modular_composition, { min_starters: 1, max_starters: 1 });
  assert.equal(group.items.length, 2);
});

test("Direct Modular starter row round trip: id, price, currency, role, specification, and requirements survive unchanged", () => {
  const groups = categoryPricingValue("", directModularSubmission(), "");
  const group = findGroup(groups, "mod-oxi-p-bench");
  const starter = group.items.find((item) => item.id === "bench-starter-120")!;
  assert.ok(starter, "Expected the starter row to survive normalization");
  assert.equal(starter.price, 425, "Expected the scalar price to survive unchanged, never converted to a category price map");
  assert.equal(starter.currency, "EUR");
  assert.equal(starter.modular_role, "starter");
  assert.equal(starter.supplier_price_list_code, "111 065");
  assert.equal(starter.display_name, "Starter Bench 120");
  assert.equal(starter.specification, "Panel-base starter bench.");
  assert.deepEqual(starter.importantRequirements, ["Move the panel to terminal position to finish the composition."]);
  assert.deepEqual(starter.prices, {}, "Expected no fake category price map on a direct row");
  assert.equal(starter.is_active, true);
});

test("Direct Modular intermediate row round trip: id, price, role survive unchanged", () => {
  const groups = categoryPricingValue("", directModularSubmission(), "");
  const group = findGroup(groups, "mod-oxi-p-bench");
  const intermediate = group.items.find((item) => item.id === "bench-intermediate-120")!;
  assert.ok(intermediate, "Expected the intermediate row to survive normalization");
  assert.equal(intermediate.price, 421);
  assert.equal(intermediate.modular_role, "intermediate");
  assert.equal(intermediate.supplier_price_list_code, "111 069");
});

test("Matrix Modular groups keep their existing category-price-map behavior unchanged", () => {
  const matrixSubmission = JSON.stringify([{
    id: "mod-sofa", group_name: "Sofa Modules", pricing_type: "modular_group", is_active: true, sort_order: 0,
    price_categories: ["Cat A"],
    items: [{ id: "corner", display_name: "Corner Module", prices: { "Cat A": 990 }, is_active: true, sort_order: 0 }],
  }]);
  const groups = categoryPricingValue("", matrixSubmission, "");
  const group = findGroup(groups, "mod-sofa");
  assert.equal("modular_pricing_mode" in group, false, "Expected Matrix Modular groups to never gain a Direct Modular field");
  assert.equal("modular_composition" in group, false);
  assert.deepEqual(group.price_categories, ["Cat A"]);
  assert.equal((group.items[0].prices as Record<string, number | null>)["Cat A"], 990);
  assert.equal("price" in group.items[0], false, "Expected a Matrix row to never gain a scalar price field");
});

/** Submitted "modular_item_pricing" FormData shape: a Matrix Modular group with starter/intermediate roles, composition, and finish-category prices, generic (not Terra-specific). */
function matrixModularWithRolesSubmission() {
  return JSON.stringify([{
    id: "mod-composed",
    group_name: "Composed Matrix Group",
    pricing_type: "modular_group",
    modular_composition: { min_starters: 1, max_starters: 1 },
    is_active: true,
    sort_order: 0,
    price_categories: ["Standard", "Designs"],
    items: [
      { id: "row-starter", display_name: "Starter Row", prices: { Standard: 1310, Designs: 1874 }, unavailable_categories: [], modular_role: "starter", is_active: true, sort_order: 0 },
      { id: "row-intermediate", display_name: "Extension Row", prices: { Standard: 1454, Designs: 2148 }, unavailable_categories: ["Designs"], modular_role: "intermediate", is_active: true, sort_order: 1 },
    ],
  }]);
}

test("Matrix Modular role survives Product Template save/reopen without gaining a Direct Modular pricing mode", () => {
  const groups = categoryPricingValue("", matrixModularWithRolesSubmission(), "");
  const group = findGroup(groups, "mod-composed");
  assert.ok(group, "Expected the Matrix Modular group to survive normalization");
  assert.equal("modular_pricing_mode" in group, false, "Expected Matrix Modular to remain matrix-mode by structure, never gaining modular_pricing_mode: \"direct\"");
  const starter = group.items.find((item) => item.id === "row-starter")!;
  const intermediate = group.items.find((item) => item.id === "row-intermediate")!;
  assert.equal(starter.modular_role, "starter");
  assert.equal(intermediate.modular_role, "intermediate");
});

test("Matrix Modular group composition survives Product Template save/reopen", () => {
  const groups = categoryPricingValue("", matrixModularWithRolesSubmission(), "");
  const group = findGroup(groups, "mod-composed");
  assert.deepEqual(group.modular_composition, { min_starters: 1, max_starters: 1 });
});

test("Matrix Modular price maps remain unchanged when role/composition are present", () => {
  const groups = categoryPricingValue("", matrixModularWithRolesSubmission(), "");
  const group = findGroup(groups, "mod-composed");
  const starter = group.items.find((item) => item.id === "row-starter")!;
  const intermediate = group.items.find((item) => item.id === "row-intermediate")!;
  assert.deepEqual(starter.prices, { Standard: 1310, Designs: 1874 });
  assert.deepEqual(intermediate.prices, { Standard: 1454, Designs: 2148 });
  assert.equal("price" in starter, false, "Expected a Matrix row to never gain a Direct Modular scalar price field");
});

test("Matrix Modular unavailableCategoryIds (unavailable_categories) remain unchanged when role/composition are present", () => {
  const groups = categoryPricingValue("", matrixModularWithRolesSubmission(), "");
  const group = findGroup(groups, "mod-composed");
  const starter = group.items.find((item) => item.id === "row-starter")!;
  const intermediate = group.items.find((item) => item.id === "row-intermediate")!;
  assert.deepEqual(starter.unavailable_categories, []);
  assert.deepEqual(intermediate.unavailable_categories, ["Designs"]);
});

test("Matrix Modular without role/composition remains backward compatible after the generic role/composition support", () => {
  const matrixSubmission = JSON.stringify([{
    id: "mod-plain", group_name: "Plain Matrix Group", pricing_type: "modular_group", is_active: true, sort_order: 0,
    price_categories: ["Cat A"],
    items: [{ id: "plain-row", display_name: "Plain Module", prices: { "Cat A": 500 }, is_active: true, sort_order: 0 }],
  }]);
  const groups = categoryPricingValue("", matrixSubmission, "");
  const group = findGroup(groups, "mod-plain");
  assert.equal("modular_pricing_mode" in group, false);
  assert.equal("modular_composition" in group, false);
  assert.equal("modular_role" in group.items[0], false, "Expected an old Matrix row with no role to stay exactly as before");
  assert.deepEqual(group.items[0].prices, { "Cat A": 500 });
});

/** Submitted "modular_item_pricing" FormData shape: an intentional Smart Setup replace/import carrying
 * exactly 2 matrix columns, with a role, composition, image-bearing row, unavailable category, and
 * specification/requirements — generic labels only, never a hardcoded brand name. */
function replacedMatrixModularSubmission(options: { extraStaleRowKeys?: boolean } = {}) {
  return JSON.stringify([{
    id: "mod-bench",
    group_name: "Bench Modules",
    pricing_type: "modular_group",
    modular_composition: { min_starters: 1, max_starters: 1 },
    is_active: true,
    sort_order: 0,
    price_categories: ["Column One", "Column Two"],
    items: [
      {
        id: "row-starter", display_name: "Starter Row", supplier_price_list_code: "ART.001", dimension: "120 cm",
        prices: { "Column One": 1310, "Column Two": 1874, ...(options.extraStaleRowKeys ? { "Cat A": null, "Cat B": null, "Cat C": null, "Cat D": null } : {}) },
        unavailable_categories: [], modular_role: "starter", specification: "Starter module note.", importantRequirements: ["Always complete with the extension row."],
        is_active: true, sort_order: 0,
      },
      {
        id: "row-intermediate", display_name: "Extension Row", supplier_price_list_code: "ART.002", dimension: "80 cm",
        prices: { "Column One": 1454, "Column Two": 2148, ...(options.extraStaleRowKeys ? { "Cat A": null, "Cat B": null, "Cat C": null, "Cat D": null } : {}) },
        unavailable_categories: ["Column Two"], modular_role: "intermediate", is_active: true, sort_order: 1,
      },
    ],
  }]);
}

test("1: an intentional Matrix Modular replacement with 2 incoming columns produces exactly 2 saved columns", () => {
  const groups = categoryPricingValue("", replacedMatrixModularSubmission(), "");
  const group = findGroup(groups, "mod-bench");
  assert.deepEqual(group.price_categories, ["Column One", "Column Two"]);
});

test("2: stale/default unrelated category columns baked into a row's own prices object are dropped on intentional replacement, never merged in", () => {
  const groups = categoryPricingValue("", replacedMatrixModularSubmission({ extraStaleRowKeys: true }), "");
  const group = findGroup(groups, "mod-bench");
  assert.deepEqual(group.price_categories, ["Column One", "Column Two"], "Expected the group's saved column set to stay exactly the incoming 2 columns");
  const starter = group.items.find((item) => item.id === "row-starter")!;
  assert.deepEqual(Object.keys(starter.prices as Record<string, unknown>).sort(), ["Column One", "Column Two"], "Expected stale Cat A-D keys present on the raw row to never survive into the saved prices map");
  assert.ok(!("Cat A" in (starter.prices as Record<string, unknown>)), "Expected no default Cat A-D column to leak in");
});

test("3: replaced column labels are whatever the source provides — no Terra or Cat A-D hardcoding in the normalizer", () => {
  const groups = categoryPricingValue("", replacedMatrixModularSubmission(), "");
  const group = findGroup(groups, "mod-bench");
  assert.ok(!group.price_categories!.some((label) => label.startsWith("Cat ")), "Expected no generic Cat A-D default label to appear for a fully-specified replacement");
  assert.ok(!group.price_categories!.some((label) => /terra/i.test(label)), "Expected no Terra-specific literal in generic normalization");
});

test("4: row prices remain bound to the correct incoming columns after replacement", () => {
  const groups = categoryPricingValue("", replacedMatrixModularSubmission(), "");
  const group = findGroup(groups, "mod-bench");
  const starter = group.items.find((item) => item.id === "row-starter")!;
  const intermediate = group.items.find((item) => item.id === "row-intermediate")!;
  assert.deepEqual(starter.prices, { "Column One": 1310, "Column Two": 1874 });
  assert.deepEqual(intermediate.prices, { "Column One": 1454, "Column Two": 2148 });
});

test("5: unavailable-category data remains correct after replacement", () => {
  const groups = categoryPricingValue("", replacedMatrixModularSubmission(), "");
  const group = findGroup(groups, "mod-bench");
  const starter = group.items.find((item) => item.id === "row-starter")!;
  const intermediate = group.items.find((item) => item.id === "row-intermediate")!;
  assert.deepEqual(starter.unavailable_categories, []);
  assert.deepEqual(intermediate.unavailable_categories, ["Column Two"]);
});

test("6: role and composition survive an intentional Matrix Modular replacement", () => {
  const groups = categoryPricingValue("", replacedMatrixModularSubmission(), "");
  const group = findGroup(groups, "mod-bench");
  assert.deepEqual(group.modular_composition, { min_starters: 1, max_starters: 1 });
  const starter = group.items.find((item) => item.id === "row-starter")!;
  const intermediate = group.items.find((item) => item.id === "row-intermediate")!;
  assert.equal(starter.modular_role, "starter");
  assert.equal(intermediate.modular_role, "intermediate");
});

test("7: reopening/saving an existing Matrix template with explicit price_categories does not drop valid columns (no Smart Setup replacement involved)", () => {
  // Simulates a manually-edited template being saved again: the same explicit columns submitted back
  // unchanged must survive, proving ordinary open/save is not treated as a lossy replacement.
  const groups = categoryPricingValue("", replacedMatrixModularSubmission(), "");
  const reopened = categoryPricingValue("", JSON.stringify(groups.filter((group) => (group as unknown as { pricing_type?: string }).pricing_type === "modular_group")), "");
  const group = findGroup(reopened, "mod-bench");
  assert.deepEqual(group.price_categories, ["Column One", "Column Two"]);
  assert.equal(group.items.length, 2);
});

test("regression documentation: omitting price_categories from the submission (the bug this fix prevents) is what previously let stale Cat A-D defaults merge into row prices", () => {
  const submissionWithoutPriceCategories = JSON.stringify([{
    id: "mod-bug-repro", group_name: "Bug Repro Modules", pricing_type: "modular_group", is_active: true, sort_order: 0,
    // price_categories intentionally omitted, reproducing the pre-fix client serialization bug.
    items: [{ id: "row-1", display_name: "Row", prices: { "Column One": 1310, "Column Two": 1874 }, is_active: true, sort_order: 0 }],
  }]);
  const groups = categoryPricingValue("", submissionWithoutPriceCategories, "");
  const group = findGroup(groups, "mod-bug-repro");
  // Documents the exact failure mode: with no explicit price_categories, the server falls back to the
  // generic Cat A-D defaults AND merges the row's real columns on top of them.
  assert.deepEqual((group.items[0].prices as Record<string, unknown>)["Cat A"], null);
  assert.deepEqual((group.items[0].prices as Record<string, unknown>)["Column One"], 1310);
});

test("empty submissions return an empty array without throwing", () => {
  assert.deepEqual(categoryPricingValue("", "", ""), []);
});

test("malformed JSON is handled gracefully and returns an empty array", () => {
  assert.deepEqual(categoryPricingValue("not json", "", ""), []);
  assert.deepEqual(categoryPricingValue("", "not json", ""), []);
});
