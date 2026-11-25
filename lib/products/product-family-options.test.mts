import assert from "node:assert/strict";
import test from "node:test";
import { groupedStandardCategoryPricingRows } from "./category-pricing-groups";
import { resolveMainAccessoryTargets } from "./main-accessory-targets";
import { familyKey, MATRIX_FAMILY_MISSING_MESSAGE, mixedProductFamilies, productFamilyOptions, selectedProductFamily } from "./product-family-options";

import { baseGroups, CATEGORIES, matrixGroups } from "./testing/universal-screen-fixture";

test("Universal Screen: the family list holds all 11 Base/Model and all 15 matrix groups, in saved order", () => {
  assert.equal(mixedProductFamilies(baseGroups, matrixGroups), true);
  const options = productFamilyOptions(baseGroups, matrixGroups);
  assert.equal(options.length, 26);
  assert.equal(options.filter((o) => o.kind === "base_model").length, 11);
  assert.equal(options.filter((o) => o.kind === "price_matrix").length, 15);
  assert.deepEqual(options.slice(0, 4).map((o) => o.id), ["b0", "m0", "b1", "m1"], "sorted by sort_order across both kinds");
  assert.equal(options.find((o) => o.id === "m0")!.label, "S2 Fabric Front 25 mm (price by category)");
  assert.equal(options.find((o) => o.id === "b0")!.label, "S1 Melamine Front");
});

test("a group id present in both lists is listed once; empty or inactive matrix groups are not offered", () => {
  const options = productFamilyOptions(baseGroups, [{ ...matrixGroups[0], id: "b0" }, { ...matrixGroups[1], items: [] }, { ...matrixGroups[2], is_active: false }, matrixGroups[3]]);
  assert.deepEqual(options.map((o) => o.id).sort(), [...baseGroups.map((g) => g.id), "m3"].sort());
});

test("Base/Model-only and matrix-only templates are not mixed: their UI stays as before", () => {
  assert.equal(mixedProductFamilies(baseGroups, []), false);
  assert.equal(mixedProductFamilies([], matrixGroups), false);
});

test("family selection: explicit choice, then restored matrix row, then restored base group, then the first family", () => {
  const options = productFamilyOptions(baseGroups, matrixGroups);
  const none = { matrixGroupId: null, matrixRowSelected: false, baseGroupId: null };
  assert.equal(selectedProductFamily(options, undefined, none)?.id, "b0");
  assert.equal(selectedProductFamily(options, familyKey("price_matrix", "m4"), none)?.id, "m4");
  assert.equal(selectedProductFamily(options, undefined, { matrixGroupId: "m2", matrixRowSelected: true, baseGroupId: "b1" })?.id, "m2");
  assert.equal(selectedProductFamily(options, undefined, { matrixGroupId: "m2", matrixRowSelected: false, baseGroupId: "b1" })?.id, "b1");
  assert.equal(selectedProductFamily(options, "price_matrix:gone", none)?.id, "b0");
  assert.equal(MATRIX_FAMILY_MISSING_MESSAGE, "Select a model and a price category.");
});

test("a matrix family shows its own rows and categories B..I, and the price is the existing lookup for the chosen category", () => {
  const groups = groupedStandardCategoryPricingRows(matrixGroups as never);
  const group = groups.find((g) => g.id === "m4")!;
  assert.deepEqual(group.items.map((r) => r.id), ["mr4"]);
  assert.deepEqual(group.price_categories, CATEGORIES);
  const row = group.items[0] as unknown as { prices: Record<string, number> };
  assert.equal(row.prices.E, 530, "same lookup the selector and the server use: row.prices[category]");
});

test("price_matrix targets still resolve for a matrix row, and a Base/Model pick still resolves its own target", () => {
  const matrix = [{ kind: "price_matrix" as const, group_id: "m4", row_id: "mr4" }];
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: [], usesModularPricing: false, modular: [], baseModel: [], priceMatrix: matrix }), matrix);
  const base = [{ kind: "base_model" as const, group_id: "b0", row_id: "br0" }];
  assert.deepEqual(resolveMainAccessoryTargets({ workstation: [], usesModularPricing: false, modular: [], baseModel: base, priceMatrix: [] }), base);
});
