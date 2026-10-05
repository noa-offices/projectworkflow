import assert from "node:assert/strict";
import test from "node:test";
import { brandPriceTargets } from "./supplier-price-targets.js";
import { matchSupplierPrices } from "./supplier-price-matching.js";
import type { DimensionRule, PriceMatch, ProductPriceInput, SourceIdentity } from "./supplier-price-contracts.js";

const base = { id: "t", brand_id: "brand", template_name: "Template", pricing_version: 1, currency: "EUR", item_code: null, default_unit_price: null };
const row = (code: string, extra: Record<string, unknown> = {}) => ({ id: `row-${code}`, supplier_price_list_code: code, price: 100, is_active: true, ...extra });
const matrixColumns = [{ id: "c-a", label: "Cat A", dimension_code: "cat_a" }, { id: "c-m", label: "MELAMINE", dimension_code: "melamine" }];

type Case = { architecture: string; dimensioned: boolean; build: (code: string) => { template: ProductPriceInput; components?: Record<string, unknown>[] } };
const cases: Case[] = [
  { architecture: "simple", dimensioned: false, build: (code) => ({ template: { ...base, item_code: code, default_unit_price: 100 } }) },
  { architecture: "variant_pricing", dimensioned: false, build: (code) => ({ template: { ...base, variant_pricing: [{ id: "g", is_active: true, items: [row(code)] }] } }) },
  { architecture: "category_pricing", dimensioned: false, build: (code) => ({ template: { ...base, category_pricing: [{ id: "g", is_active: true, modular_pricing_mode: "direct", items: [row(code)] }] } }) },
  { architecture: "category_pricing", dimensioned: true, build: (code) => ({ template: { ...base, category_pricing: [{ id: "g", is_active: true, price_columns: matrixColumns, items: [row(code, { price: undefined, prices: { "c-a": 10, "c-m": 20 } })] }] } }) },
  { architecture: "desking_size_pricing", dimensioned: false, build: (code) => ({ template: { ...base, desking_size_pricing: [{ id: "g", is_active: true, items: [{ id: "d", is_active: true, base_supplier_price_list_code: code, default_price: 100, additional_supplier_price_list_code: `${code}9`, additional_price: 50 }] }] } }) },
  { architecture: "accessory_pricing", dimensioned: false, build: (code) => ({ template: { ...base, accessory_pricing: [{ id: "g", is_active: true, items: [row(code)] }] } }) },
  { architecture: "accessory_pricing", dimensioned: true, build: (code) => ({ template: { ...base, accessory_pricing: [{ id: "g", is_active: true, price_categories: [{ id: "a-1", dimension_code: "tier_one" }], items: [row(code, { price: undefined, prices: { "a-1": 5 } })] }] } }) },
  { architecture: "product_components", dimensioned: false, build: (code) => ({ template: { ...base }, components: [{ id: "comp", template_id: "t", component_code: code, unit_price: 100, currency: "EUR", is_active: true }] }) },
];

const source = (code: string, finishes: string[]): SourceIdentity => ({ key: `key-${code}`, code, price_field: "unit_price", dimension: "", finishes, price: 100, currency: "EUR", row_keys: ["r"], issues: [] });
const finishRule = (codes: string[]): DimensionRule => ({ id: "rule", brand_id: "brand", raw_labels: [], finish_codes: codes, dimension_code: "melamine" });
const run = (item: Case, productCode: string, supplierCode: string, rules: DimensionRule[]) => {
  const { template, components } = item.build(productCode);
  const targets = brandPriceTargets([template], components).filter((target) => target.architecture === item.architecture && target.physical_field !== "additional_price"); // the additional-price code is a different Supplier article
  return { targets, matches: matchSupplierPrices([source(supplierCode, ["500"])], targets, rules) as PriceMatch[] };
};
const missing = (matches: PriceMatch[]) => matches.filter((match) => match.classification === "target_not_represented");
const comparisons = ["increased", "decreased", "unchanged", "changed"];

for (const item of cases) {
  const label = `${item.architecture}${item.dimensioned ? " (dimensioned)" : ""}`;
  for (const [rulesLabel, rules] of [["finish rule active", [finishRule(["500", "170"])]], ["finish rule inactive", []]] as Array<[string, DimensionRule[]]>) {
    test(`${label}: code present is never Missing, ${rulesLabel}`, () => {
      const { targets, matches } = run(item, "1AJ M33", "1AJM33", rules);
      assert.ok(targets.length > 0);
      assert.equal(missing(matches).length, 0);
      const found = matches.filter((match) => match.source);
      assert.equal(found.length, 1);
      if (!item.dimensioned) assert.ok(comparisons.includes(found[0].classification), found[0].classification); // dimensionless targets are compared, not remapped
      else assert.ok([...comparisons, "needs_dimension_mapping"].includes(found[0].classification), found[0].classification);
    });
    test(`${label}: code absent stays Missing, ${rulesLabel}`, () => {
      const { targets, matches } = run(item, "1AJ M33", "9ZZ999", rules);
      assert.equal(missing(matches).length, targets.length);
      assert.equal(matches.filter((match) => match.source)[0].classification, "unmatched");
    });
  }
}

test("a finish rule does not remap a dimensionless target, so the result equals the rule-free result", () => {
  for (const item of cases.filter((entry) => !entry.dimensioned)) {
    const withRule = run(item, "1AG 207", "1AG207", [finishRule(["500"])]).matches.map((match) => match.classification);
    const without = run(item, "1AG 207", "1AG207", []).matches.map((match) => match.classification);
    assert.deepEqual(withRule, without, item.architecture);
  }
});

test("a finish rule still resolves a target that has a dimension", () => {
  const item = cases.find((entry) => entry.architecture === "category_pricing" && entry.dimensioned)!;
  const { matches } = run(item, "103888", "103888", [finishRule(["500"])]);
  const found = matches.find((match) => match.source)!;
  assert.deepEqual(found.targets.map((target) => target.dimension), ["melamine"]);
  assert.equal(missing(matches).length, 0); // the sibling Cat A column shares the article, so it is represented too
});

test("live LAS regressions: Sigma, Universal Cabinet, Universal Screen and OXI_P under the melamine finish rule", () => {
  const melamine = finishRule(["170", "220", "331", "380", "390", "404", "410", "460", "500", "630", "640", "680", "844", "M02", "M04"]);
  const accessory = cases.find((entry) => entry.architecture === "accessory_pricing" && !entry.dimensioned)!;
  const live: Array<[string, string, string[]]> = [
    ["1AJ M33", "1AJM33", ["170", "331", "380", "404", "500", "680", "M02", "M04"]], ["1AJ M34", "1AJM34", ["170", "331", "380", "404", "500"]], ["1AJ P58", "1AJP58", ["170", "331", "380", "404", "500"]],
    ["1AG 207", "1AG207", ["380", "500", "680", "844", "M02"]], ["1AG 208", "1AG208", ["380", "500", "680", "844", "M02"]], ["1AG 209", "1AG209", ["380", "500", "680"]], ["1AG 210", "1AG210", ["380", "500", "680"]],
    ["103888", "103888", ["500"]],
  ];
  for (const [productCode, supplierCode, finishes] of live) {
    const { template } = accessory.build(productCode);
    const targets = brandPriceTargets([template]).filter((target) => target.architecture === "accessory_pricing");
    const matches = matchSupplierPrices([source(supplierCode, finishes)], targets, [melamine]);
    assert.equal(missing(matches).length, 0, productCode);
    assert.equal(matches.find((match) => match.source)!.classification, "unchanged", productCode);
  }
  const oxi = ["111069", "111070", "111071", "111072"];
  const desking = cases.find((entry) => entry.architecture === "desking_size_pricing")!;
  for (const code of oxi) {
    const { template } = desking.build(code);
    const targets = brandPriceTargets([template]).filter((target) => target.physical_field === "default_price");
    const matches = matchSupplierPrices([source(code, ["144", "163", "164", "170", "171"])], targets, [melamine]);
    assert.equal(missing(matches).length, 0, code);
    assert.equal(matches.find((match) => match.source)!.classification, "unchanged", code);
  }
});
