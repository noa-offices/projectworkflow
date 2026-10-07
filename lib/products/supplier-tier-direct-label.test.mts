import assert from "node:assert/strict";
import test from "node:test";
import { brandPriceTargets } from "./supplier-price-targets.js";
import { matchSupplierPrices } from "./supplier-price-matching.js";
import { sourceTierPanel } from "./supplier-price-repository.js";
import type { DimensionRule, ProductPriceInput, SourceIdentity } from "./supplier-price-contracts.js";

// EVERY-style Category pricing: stable internal codes (cat_a…) with the real price-list labels shown to users (SG1…).
const tiers: Array<[string, string, string]> = [["Cat A", "SG1", "cat_a"], ["Cat B", "SG2", "cat_b"], ["Cat C", "SG3", "cat_c"], ["Cat D", "HP4", "cat_d"], ["Cat E", "LG6", "cat_e"], ["Cat F", "LG7", "cat_f"]];
const columns = (list = tiers) => list.map(([id, label, dimension_code]) => ({ id, label, dimension_code }));
const prices = Object.fromEntries(tiers.map(([id], index) => [id, 100 + index]));
const template = (over: Record<string, unknown> = {}): ProductPriceInput => ({ id: "every", brand_id: "brand", template_name: "Every", pricing_version: 1, currency: "EUR", item_code: null, default_unit_price: null,
  category_pricing: [{ id: "g", is_active: true, price_columns: columns(), items: [{ id: "row", supplier_price_list_code: "EV211", is_active: true, prices }] }], ...over } as ProductPriceInput);
const source = (dimension: string, price = 100, raw = dimension): SourceIdentity => ({ key: `k-${dimension}`, code: "EV211", price_field: "unit_price", dimension, raw_dimension: raw, finishes: [], price, currency: "EUR", row_keys: ["r"], issues: [] });
const targets = brandPriceTargets([template()]);
const targetFor = (code: string) => targets.find((target) => target.dimension === code)!;
const rule = (raw: string, dimension_code: string): DimensionRule => ({ id: `r-${raw}`, brand_id: "brand", raw_labels: [raw], finish_codes: [], dimension_code });
const only = (matches: ReturnType<typeof matchSupplierPrices>) => matches.filter((match) => match.source);

test("target builder carries the displayed pricing-column label next to the unchanged internal code", () => {
  assert.deepEqual(targets.map((target) => [target.dimension, target.dimension_label]), tiers.map(([, label, code]) => [code, label]));
});

test("Supplier SG1 / SG2 / LG7 match their own column directly, with no vocabulary rule", () => {
  for (const [, label, code] of tiers) {
    const [match] = only(matchSupplierPrices([source(label, 100 + tiers.findIndex((item) => item[1] === label))], targets, []));
    assert.equal(match.targets.length, 1, label); assert.equal(match.targets[0].dimension, code); assert.equal(match.classification, "unchanged", label);
  }
});

test("exact comparison trims and ignores case only", () => {
  const [match] = only(matchSupplierPrices([source("  sg1 ", 100)], targets, []));
  assert.equal(match.targets[0]?.dimension, "cat_a");
  for (const near of ["SG", "SG 1", "SG1A", "sg-1"]) assert.equal(only(matchSupplierPrices([source(near)], targets, []))[0].classification, "needs_dimension_mapping", near);
});

test("different labels still need mapping: H and Grade 6 do not guess SG3 or LG6", () => {
  for (const label of ["H", "CAT H", "Grade 6"]) {
    const [match] = only(matchSupplierPrices([source(label)], targets, []));
    assert.equal(match.classification, "needs_dimension_mapping", label); assert.equal(match.targets.length, targets.length);
  }
});

test("an explicit vocabulary mapping still wins, including over a label that would also match", () => {
  const [mapped] = only(matchSupplierPrices([source("H", 102)], targets, [rule("H", "cat_c")]));
  assert.equal(mapped.targets[0].dimension, "cat_c"); assert.equal(mapped.classification, "unchanged");
  // SG1 explicitly mapped to cat_b: the saved rule is authoritative, label equality is not consulted.
  const [override] = only(matchSupplierPrices([source("SG1", 101)], targets, [rule("SG1", "cat_b")]));
  assert.equal(override.targets[0].dimension, "cat_b");
});

test("existing internal-code matching still works", () => {
  const [match] = only(matchSupplierPrices([source("cat_b", 101)], targets, []));
  assert.equal(match.targets[0].dimension, "cat_b"); assert.equal(match.classification, "unchanged");
});

test("two columns of one row with the same label are never auto-selected", () => {
  const duplicate = brandPriceTargets([template({ category_pricing: [{ id: "g", is_active: true, price_columns: columns([["Cat A", "SG1", "cat_a"], ["Cat B", "SG1", "cat_b"]]), items: [{ id: "row", supplier_price_list_code: "EV211", is_active: true, prices: { "Cat A": 100, "Cat B": 110 } }] }] })]);
  const [match] = only(matchSupplierPrices([source("SG1")], duplicate, []));
  assert.equal(match.classification, "ambiguous"); assert.equal(match.targets.length, 2);
  assert.ok(!["unchanged", "increased", "decreased", "changed"].includes(match.classification));
});

test("generic labels work (A/B, CAT 1, sizes) and a new Supplier category is shown as unmatched work, not guessed", () => {
  const generic = brandPriceTargets([template({ category_pricing: [{ id: "g", is_active: true, price_columns: columns([["x", "CAT 1", "c1"], ["y", "120x145", "d1"]]), items: [{ id: "row", supplier_price_list_code: "EV211", is_active: true, prices: { x: 100, y: 200 } }] }] })]);
  assert.equal(only(matchSupplierPrices([source("cat 1")], generic, []))[0].targets[0].dimension, "c1");
  assert.equal(only(matchSupplierPrices([source("120X145", 200)], generic, []))[0].targets[0].dimension, "d1");
  assert.equal(only(matchSupplierPrices([source("CAT 2")], generic, []))[0].classification, "needs_dimension_mapping");
});

test("EVERY: SG1…LG7 all match directly, so Supplier tier mapping shows 0 unmapped and no rule is created", () => {
  const rules: DimensionRule[] = [];
  const matches = matchSupplierPrices(tiers.map(([, label], index) => source(label, 100 + index)), targets, rules);
  assert.equal(matches.filter((match) => match.classification === "needs_dimension_mapping").length, 0);
  assert.equal(only(matches).filter((match) => match.targets.length === 1).length, 6);
  const panel = sourceTierPanel(matches, targets, rules, [template()]);
  assert.equal(panel.unmapped.length, 0); assert.equal(panel.ambiguous.length, 0); assert.equal(panel.mapped.length, 0); assert.equal(rules.length, 0);
  assert.equal(targetFor("cat_a").dimension, "cat_a"); // stored codes untouched
});

test("a legacy target without a stored label falls back to mapping, never to a guess", () => {
  const legacy = targets.map((target) => { const copy = { ...target }; delete copy.dimension_label; return copy; });
  assert.equal(only(matchSupplierPrices([source("SG1")], legacy, []))[0].classification, "needs_dimension_mapping");
});
