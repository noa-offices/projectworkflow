import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { baseModelPricingGroups, flattenBaseModelPricingRows } from "./base-model-pricing-groups";
import { groupedStandardCategoryPricingRows } from "./category-pricing-groups";
import { linkedProductFamilyChange, linkedProductNeedsLocalBuilder, resolveLinkedProductFamily, type LinkedFamilyStored } from "./linked-product-family";
import { productFamilyOptions } from "./product-family-options";
import { baseGroups, CATEGORIES, matrixGroups } from "./testing/universal-screen-fixture";

type VariantRow = { id: string; variant_name: string; price: number; is_active?: boolean };
const variantGroups = baseModelPricingGroups<VariantRow>(baseGroups);
const variantRows = flattenBaseModelPricingRows<VariantRow>(baseGroups, { activeGroupsOnly: true });
const categoryGroups = groupedStandardCategoryPricingRows(matrixGroups as never) as unknown as Array<{ id: string; group_name: string; sort_order: number; price_categories: string[]; items: Array<{ id: string; is_active?: boolean; prices: Record<string, number> }> }>;
const data = { variantGroups, categoryGroups, variantRows, nativeSystemActive: false };

const resolve = (stored: LinkedFamilyStored = {}) => resolveLinkedProductFamily({ ...data, stored });
/** The builder's linked unit price lookup (unchanged): matrix row category cell, else the Base / Model row price. */
const linkedPrice = (result: ReturnType<typeof resolve>, category = "B") => result.categoryRow ? result.categoryRow.prices[category] : result.variantRow!.price;
const change = (kind: "base_model" | "price_matrix", id: string) => linkedProductFamilyChange(resolve().options.find((option) => option.kind === kind && option.id === id)!, data);

test("golden: the linked panel lists the same 11 + 15 families, order and labels as the standalone page", () => {
  const result = resolve();
  assert.equal(result.mixed, true);
  assert.deepEqual(result.options, productFamilyOptions(variantGroups, categoryGroups));
  assert.equal(result.options.filter((option) => option.kind === "base_model").length, 11);
  assert.equal(result.options.filter((option) => option.kind === "price_matrix").length, 15);
});

test("golden: an untouched linked line keeps its previous default (first matrix group, first row), so no price moves", () => {
  const result = resolve();
  assert.equal(result.selected?.key, "price_matrix:m0");
  assert.equal(result.categoryRow?.id, "mr0");
  assert.equal(result.variantRow, null);
  assert.equal(linkedPrice(result), 100);
});

test("golden: every Base / Model family prices from its own row, equal to the standalone row price", () => {
  baseGroups.forEach((group, index) => {
    const result = resolve(change("base_model", group.id));
    assert.equal(result.selected?.id, group.id);
    assert.equal(result.categoryRow, null);
    assert.deepEqual(result.variantRows.map((row) => row.id), [`br${index}`]);
    assert.equal(linkedPrice(result), group.items[0]!.price);
  });
});

test("golden: every matrix family and each category B..I prices from the standalone row cell", () => {
  matrixGroups.forEach((group) => {
    const result = resolve(change("price_matrix", group.id));
    assert.equal(result.selected?.id, group.id);
    assert.equal(result.variantRow, null);
    assert.deepEqual(result.categoryGroup?.price_categories, CATEGORIES);
    for (const category of CATEGORIES) assert.equal(linkedPrice(result, category), (group.items[0]!.prices as Record<string, number>)[category]);
  });
});

test("golden: changing family clears the other pricing source and the price category", () => {
  const base = change("base_model", "b3");
  assert.deepEqual(base, { variantRowId: "br3", categoryGroupId: undefined, categoryId: undefined, fabricCategory: undefined });
  const matrix = change("price_matrix", "m4");
  assert.deepEqual(matrix, { variantRowId: undefined, categoryGroupId: "m4", categoryId: "mr4", fabricCategory: undefined });
  for (const stored of [base, matrix]) {
    const result = resolve(stored);
    assert.equal(Number(Boolean(result.categoryRow)) + Number(Boolean(result.variantRow)), 1, "exactly one price source");
  }
});

test("a restored selection returns to its family; a stored matrix row wins over a stale base row", () => {
  assert.equal(resolve({ variantRowId: "br7" }).selected?.id, "b7");
  assert.equal(resolve({ categoryGroupId: "m2", categoryId: "mr2", variantRowId: "br7" }).selected?.id, "m2");
  assert.equal(resolve({ categoryGroupId: "m2" }).selected?.id, "m2");
  assert.equal(resolve({ variantRowId: "gone" }).selected?.id, "m0");
});

test("templates without a mixed structure behave exactly as before", () => {
  // matrix only
  const matrixOnly = resolveLinkedProductFamily({ ...data, variantGroups: [], variantRows: [], stored: { categoryGroupId: "m3" } });
  assert.deepEqual([matrixOnly.mixed, matrixOnly.options.length, matrixOnly.categoryRow?.id, matrixOnly.variantRow], [false, 0, "mr3", null]);
  // Base / Model only: every row of every group stays in the one list
  const baseOnly = resolveLinkedProductFamily({ ...data, categoryGroups: [], stored: { variantRowId: "br5" } });
  assert.deepEqual([baseOnly.mixed, baseOnly.categoryRow, baseOnly.variantRow?.id, baseOnly.variantRows.length], [false, null, "br5", 11]);
  // native System / Base templates are never mixed
  const native = resolveLinkedProductFamily({ ...data, nativeSystemActive: true, stored: { variantRowId: "br5" } });
  assert.deepEqual([native.mixed, native.categoryRow?.id, native.variantRow], [false, "mr0", null]);
});

test("the server builder is blocked only for a linked Base / Model pick on a mixed product (the server would price a matrix row)", () => {
  const line = (stored: LinkedFamilyStored, qty = 1) => ({ qty, family: resolve(stored) });
  assert.equal(linkedProductNeedsLocalBuilder([line({})]), false);
  assert.equal(linkedProductNeedsLocalBuilder([line({ variantRowId: "br0" })]), true);
  assert.equal(linkedProductNeedsLocalBuilder([line({ variantRowId: "br0" }, 0)]), false);
  assert.equal(linkedProductNeedsLocalBuilder([{ qty: 1, family: resolveLinkedProductFamily({ ...data, categoryGroups: [], stored: {} }) }]), false);
});

test("builder wiring: the resolver picks the rows and the existing price, total and snapshot code is untouched", () => {
  const selector = readFileSync(new URL("../../components/quotations/product-library-selector.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const pricing = readFileSync(new URL("./configuration-price.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  [
    "resolveLinkedProductFamily({",
    `const unitPrice = childCategoryRow
    ? numberValue(childCategoryRow.prices?.[childCategory])
    : childVariantRow
      ? numberValue(childVariantRow.price)
      : numberValue(childTemplate.default_unit_price);`,
    "const currency = childCategoryRow?.currency ?? childVariantRow?.currency ?? childTemplate.currency;",
    "const baseLineTotal = qty * unitPrice;",
    ".reduce((total, line) => total + line.baseLineTotal + line.matchingAccessoryTotal, 0);",
  ].forEach((expected) => assert.ok(pricing.includes(expected), `Expected linked family pricing: ${expected}`));
  [
    "linkedProductFamilyChange(option, {",
    "selected_category: line.childCategoryRow ? line.childCategory : null,",
    "unit_price: line.unitPrice,",
    'categoryRowId: line.childCategoryRow?.id ?? "",',
    'variantRowId: line.childVariantRow?.id ?? "",',
    "!isLocalMode && !reconfigure && linkedProductNeedsLocalBuilder(",
  ].forEach((expected) => assert.ok(selector.includes(expected), `Expected linked family wiring: ${expected}`));
});
