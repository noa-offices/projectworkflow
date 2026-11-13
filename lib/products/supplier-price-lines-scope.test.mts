import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PriceTarget, SourceIdentity } from "./supplier-price-contracts";
import { matchSupplierPrices } from "./supplier-price-matching";
import { buildPriceLines, groupSharedLines, isPriceLineGroup } from "./supplier-price-lines";

// Joyce and Joyce flex grid: two separate products of one brand, both with rows for supplier code JC258 in tiers LG6 and LG7.
const row = (template: string, tier: string, price: number, rowId = `${template}-${tier}`): PriceTarget => ({ key: `${template}|${rowId}`, template_id: template, template_name: template === "J" ? "Joyce" : "Joyce flex grid", brand_id: "b", architecture: "accessory_pricing", group_id: "g", row_id: rowId, column_id: "", dimension: tier, dimension_label: tier, price_field: "unit_price", physical_field: "price", code: "JC258", raw_code: "JC258", price, currency: "EUR", pricing_version: "3", label: "Chair base" }) as PriceTarget;
const line = (tier: string, price: number): SourceIdentity => ({ key: `s:${tier}`, code: "JC258", price_field: "unit_price", dimension: tier, raw_dimension: tier, finishes: [], price, currency: "EUR", row_keys: [], issues: [] }) as unknown as SourceIdentity;
const targets = (jPrice = 1078) => [row("J", "LG6", jPrice), row("J", "LG7", 1100), row("F", "LG6", 1078), row("F", "LG7", 1100)];
const sources = [line("LG6", 1078), line("LG7", 1100)];
type Binding = { id: string; code: string; price_field: string; source_dimension: string; kind: "shared"; confirmed: boolean; target_keys: string[] };
const lines = (template: string, all = targets(), bindings: Binding[] = [], opened = template) => buildPriceLines(matchSupplierPrices(sources, all, [], bindings, undefined, opened), template, bindings).lines;

test("a: two products with the same supplier line: each window says Same for its own row and shows no foreign target", () => {
  for (const template of ["J", "F"]) {
    const result = lines(template);
    assert.equal(result.length, 2);
    assert.ok(result.every((l) => l.state === "same" && !l.shared && !l.apply && !l.mapping));
    assert.ok(result.every((l) => l.key.includes(`|${template}|`)), "only this product's rows");
  }
  // Without the opened product (today's behaviour, used by the review) the same lines are unclear.
  assert.ok(buildPriceLines(matchSupplierPrices(sources, targets()), "J").lines.every((l) => l.state === "ambiguous"));
});

test("b: a cross-product SHARED binding still shows as Shared in both windows", () => {
  const binding: Binding = { id: "sb", code: "JC258", price_field: "unit_price", source_dimension: "LG6", kind: "shared", confirmed: true, target_keys: ["J|J-LG6", "F|F-LG6"] };
  for (const template of ["J", "F"]) {
    const result = lines(template, targets(), [binding]);
    const shared = result.filter((l) => l.state === "shared");
    assert.equal(shared.length, 1);
    assert.equal(shared[0].binding?.id, "sb");
    assert.equal(result.filter((l) => l.state === "same").length, 1, "the unbound LG7 line is judged on its own row");
  }
});

test("c: two rows of the SAME template for one supplier line are still ambiguous", () => {
  const twice = [row("J", "LG6", 1078, "a"), row("J", "LG6", 1078, "b"), row("F", "LG6", 1078)];
  const result = buildPriceLines(matchSupplierPrices([line("LG6", 1078)], twice, [], [], undefined, "J"), "J").lines;
  assert.equal(result.length, 2);
  assert.ok(result.every((l) => l.state === "ambiguous" && l.shared?.targets.length === 2 && l.shared.targets.every((t) => t.templateId === "J")));
});

test("d: a changed price gives an Apply line only for the opened product's row; a stored 2-target match withholds it with the new sentence", () => {
  const changed = [line("LG6", 1200), line("LG7", 1100)];
  const result = buildPriceLines(matchSupplierPrices(changed, targets(), [], [], undefined, "F"), "F").lines;
  const apply = result.filter((l) => l.apply);
  assert.equal(apply.length, 1);
  assert.equal(apply[0].apply!.targetKey, "F|F-LG6", "never a row of the other product");
  const actions = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.match(actions, /supplierBrandMatches\(client, current\.id, templateId\)/);
  assert.match(actions, /stored\.targets\.length > 1 && stored\.targets\.some\(\(target\) => target\.key === line\.apply!\.targetKey\)\) otherProduct\.add\(line\.key\)/);
  assert.match(actions, /otherProduct\.has\(line\.key\) \? "other_product" as const : "old_review" as const/);
  assert.match(actions, /if \(!checked\.get\(line\.key\)\) return \{ \.\.\.line, apply: undefined/, "the button is still withheld");
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  assert.match(popup, /This supplier line also matches a row in another product in the Price updates review\. Apply it from Price updates\./);
});

test("e: no opened template id gives exactly today's matches", () => {
  const all = targets(1000);
  assert.deepEqual(matchSupplierPrices(sources, all, [], []), matchSupplierPrices(sources, all, [], [], undefined, undefined));
  const result = matchSupplierPrices(sources, targets(), []);
  assert.ok(result.filter((m) => m.source).every((m) => m.targets.length === 2 && m.classification === "ambiguous" && m.candidate_shared));
  assert.equal(result.filter((m) => m.classification === "target_not_represented").length, 0);
  // Scoped, the other product's rows are not even reported as missing from the list.
  assert.equal(matchSupplierPrices([], targets(), [], [], undefined, "J").filter((m) => m.classification === "target_not_represented").length, 2);
});

test("f: the group card shows the price category in its header and the row's own dimension label", () => {
  const two = [row("J", "LG6", 1078, "a"), row("J", "LG6", 1078, "b"), row("J", "LG7", 1100, "c"), row("J", "LG7", 1100, "d")];
  const built = buildPriceLines(matchSupplierPrices(sources, two, [], [], undefined, "J"), "J").lines;
  const groups = groupSharedLines(built).filter(isPriceLineGroup);
  assert.deepEqual(groups.map((g) => g.first.shared!.tierLabel).sort(), ["LG6", "LG7"]);
  assert.ok(groups.every((g) => g.first.shared!.targets.every((t) => t.dimensionLabel === g.first.shared!.tierLabel)));
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  assert.match(popup, /\{shared\?\.tierLabel \? <span[^>]*>· \{shared\.tierLabel\} ·<\/span> : null\}/);
  assert.match(popup, /item\.dimensionLabel\]\.filter\(Boolean\)\.join\(" · "\)/);
});
