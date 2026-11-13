import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PriceTarget, SourceIdentity } from "./supplier-price-contracts";
import { matchSupplierPrices } from "./supplier-price-matching";
import { buildPriceLines, groupSharedLines, isPriceLineGroup, summarizePriceLines, filterAndOrderPriceLines, type PriceLine } from "./supplier-price-lines";

// Joyce: one supplier line read by two product rows. 521304H, 521304N, 532217H and 3217K each match two rows at one price.
const row = (key: string, code: string, price: number, label: string, template = "T1"): PriceTarget => ({ key, template_id: template, template_name: template === "T1" ? "Chair" : "Other", brand_id: "b", architecture: "accessory_pricing", group_id: "g", row_id: key, column_id: "", dimension: "", price_field: "unit_price", physical_field: "price", code, raw_code: code, price, currency: "EUR", pricing_version: "3", label }) as PriceTarget;
const supplierLine = (code: string, price: number): SourceIdentity => ({ key: `s:${code}`, code, price_field: "unit_price", dimension: "", raw_dimension: "", finishes: [], price, currency: "EUR", row_keys: [], issues: [] }) as unknown as SourceIdentity;
const targets = () => [
  row("a1", "521304H", 174, "Chair column, high 490 - 620 mm - Aluminium polished"), row("a2", "521304H", 174, "Chair column, high 520 - 615 mm - Aluminium polished"),
  row("b1", "521304N", 150, "Chair column, low 490 - 620 mm"), row("b2", "521304N", 150, "Chair column, low 520 - 615 mm"),
  row("c1", "532217H", 90, "Gas lift H 1"), row("c2", "532217H", 90, "Gas lift H 2"),
  row("d1", "3217K", 12, "Coat hanger left"), row("d2", "3217K", 12, "Coat hanger right"),
  row("z1", "999", 5, "Plain row"),
];
const sources = () => [supplierLine("521304H", 174), supplierLine("521304N", 150), supplierLine("532217H", 90), supplierLine("3217K", 12), supplierLine("999", 5)];
type Binding = { id: string; code: string; price_field: string; source_dimension: string; kind: "shared"; confirmed: boolean; target_keys: string[] };
const build = (bindings: Binding[] = []) => buildPriceLines(matchSupplierPrices(sources(), targets(), [], bindings), "T1", bindings).lines;

test("one group per supplier line with its rows; one button source (first line); state counts still count lines", () => {
  const lines = build();
  assert.equal(lines.filter((l) => l.shared).length, 8, "eight lines today: two per supplier line");
  const before = summarizePriceLines(lines);
  const items = groupSharedLines(lines);
  const groups = items.filter(isPriceLineGroup);
  assert.deepEqual(groups.map((g) => g.first.code).sort(), ["3217K", "521304H", "521304N", "532217H"]);
  for (const g of groups) {
    assert.equal(g.kind, "unmapped"); assert.equal(g.lines.length, 2);
    assert.deepEqual(g.first.shared!.targets.map((t) => t.key).sort(), g.lines.map((l) => l.key.split("|").at(-1)).sort(), "the group rows are exactly the binding's targets");
    for (const l of g.lines) assert.deepEqual(l.shared, g.first.shared, "every line of the group would save the same shared binding");
  }
  assert.equal(items.filter((i) => !isPriceLineGroup(i)).length, 1, "the plain row stays a normal line");
  assert.deepEqual(summarizePriceLines(lines), before, "grouping never changes the lines or the counts");
  assert.equal(filterAndOrderPriceLines(lines, "attention").length, 8, "the Needs attention count is still per line");
  const flat = groupSharedLines(filterAndOrderPriceLines(lines, "attention")).flatMap((i) => isPriceLineGroup(i) ? i.lines : [i as PriceLine]);
  assert.equal(flat.length, 8, "no line is lost or doubled by grouping");
});

test("after mapping, the group is Shared (N rows) with the existing remove binding; counts update as before", () => {
  const bindings: Binding[] = [{ id: "sb", code: "521304H", price_field: "unit_price", source_dimension: "", kind: "shared", confirmed: true, target_keys: ["a1", "a2"] }];
  const lines = build(bindings);
  const group = groupSharedLines(lines).filter(isPriceLineGroup).find((g) => g.kind === "mapped")!;
  assert.equal(group.lines.length, 2);
  assert.ok(group.lines.every((l) => l.state === "shared" && l.binding?.id === "sb" && !l.shared));
  assert.equal(group.first.binding?.kind, "shared");
  assert.equal(summarizePriceLines(lines).shared, 2);
  assert.equal(groupSharedLines(lines).filter(isPriceLineGroup).filter((g) => g.kind === "unmapped").length, 3);
});

test("a cross-product shared line is still one group; a lone saved shared line stays a normal line", () => {
  const cross = [row("a1", "521304H", 174, "Column", "T1"), row("a2", "521304H", 174, "Column", "T2")];
  const lines = buildPriceLines(matchSupplierPrices([supplierLine("521304H", 174)], cross), "T1").lines;
  const [group] = groupSharedLines(lines).filter(isPriceLineGroup);
  assert.equal(group.lines.length, 1);
  assert.equal(group.first.shared!.targets.length, 2, "the card shows all rows the link covers");
  const bound: Binding[] = [{ id: "sb", code: "521304H", price_field: "unit_price", source_dimension: "", kind: "shared", confirmed: true, target_keys: ["a1", "a2"] }];
  const mapped = buildPriceLines(matchSupplierPrices([supplierLine("521304H", 174)], cross, [], bound), "T1", bound).lines;
  assert.ok(groupSharedLines(mapped).every((i) => !isPriceLineGroup(i)));
});

test("the group button reuses the existing share confirm step and save; no new save path", () => {
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  assert.match(popup, /onClick=\{\(\) => onShare\(first\)\}[^>]*>Map these \{count\} rows as shared</);
  assert.match(popup, /onShare=\{\(line\) => \{ setError\(""\); setPending\(\{ kind: "share", line \}\); \}\}/);
  assert.equal((popup.match(/confirmSupplierBindings\(/g) ?? []).length, 2, "still one save for Map this line and one for shared");
  assert.match(popup, /Brand price approver permission required\./);
  assert.match(popup, /One supplier price covers these \{count\} rows\. They will share the same price\./);
});
