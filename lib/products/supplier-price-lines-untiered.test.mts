import assert from "node:assert/strict";
import test from "node:test";
import type { PriceTarget, SourceIdentity } from "./supplier-price-contracts";
import { matchSupplierPrices } from "./supplier-price-matching";
import { buildPriceLines, summarizePriceLines } from "./supplier-price-lines";
import { supplierFamilyKey } from "./supplier-price-import";

// Joyce code 608: two rows (EUR 49 and EUR 17), 12 tiers at 49 linked to row A, 12 tiers at 17 linked to row B,
// and ONE untiered family line ("JOYCE", no tier letters) at 49.
const dim = (tier: string) => JSON.stringify([tier, "series", "JOYCE", "JOYCE"]);
const row = (key: string, price: number): PriceTarget => ({ key, template_id: "T1", template_name: "Joyce", brand_id: "b", architecture: "accessory_pricing", group_id: "g", row_id: key, column_id: "", dimension: "", price_field: "unit_price", physical_field: "price", code: "608", raw_code: "608", price, currency: "EUR", pricing_version: "3", label: "608 - Seat depth and lumbar support adjustment" }) as PriceTarget;
const src = (tier: string, price: number): SourceIdentity => ({ key: `s:${tier || "untiered"}`, code: "608", price_field: "unit_price", dimension: dim(tier), raw_dimension: tier, finishes: [], price, currency: "EUR", row_keys: [], issues: [] }) as unknown as SourceIdentity;
const high = Array.from({ length: 12 }, (_, i) => `JC${200 + i}`), low = Array.from({ length: 12 }, (_, i) => `JD${200 + i}`);
type Binding = { id: string; code: string; price_field: string; source_dimension: string; kind: "alias"; confirmed: boolean; target_keys: string[] };
const bind = (tier: string, key: string): Binding => ({ id: tier, code: "608", price_field: "unit_price", source_dimension: dim(tier), kind: "alias", confirmed: true, target_keys: [key] });
const scope = new Map([["T1", new Set([supplierFamilyKey("JOYCE")])]]);
function run(over: { untieredPrice?: number; unlink?: string; bindings?: Binding[]; chosen?: boolean } = {}) {
  const targets = [row("A", 49), row("B", 17)];
  const sources = [...high.map((t) => src(t, 49)), ...low.map((t) => src(t, 17)), src("", over.untieredPrice ?? 49)];
  const bindings = over.bindings ?? [...high.map((t) => bind(t, "A")), ...low.map((t) => bind(t, "B"))].filter((b) => b.id !== over.unlink);
  const matches = matchSupplierPrices(sources, targets, [], bindings, over.chosen === false ? undefined : scope);
  return { matches, bindings, ...buildPriceLines(matches, "T1", bindings, {}) };
}

test("study: the untiered line is matched to BOTH rows of the code, so the matcher calls it ambiguous", () => {
  const { matches } = run();
  const match = matches.find((m) => m.key === "s:untiered")!;
  assert.deepEqual(match.targets.map((t) => t.key), ["A", "B"]);
  assert.ok(["ambiguous", "baseline_drift"].includes(match.classification));
  assert.equal(match.source!.price, 49, "the supplier price shown on every row line comes from this one source");
});

test("all tiers linked and the untiered price equals a tier group: covered, resolved, nothing left in Needs attention", () => {
  const { lines } = run();
  const covered = lines.filter((l) => l.state === "covered");
  assert.equal(covered.length, 2, "one summary line per row, as before");
  for (const line of covered) {
    assert.equal(line.supplierPrice, null, "never another row's supplier price on a row");
    assert.equal(line.difference, null);
    assert.ok(!line.apply && !line.applyHint && !line.mapping && !line.shared && !line.link && !line.matchHint && !line.linkedTiers);
  }
  assert.equal(lines.length, 26);
  assert.ok(lines.filter((l) => l.state !== "covered").every((l) => l.state === "same"), "the 24 tier lines are Same");
  assert.deepEqual(summarizePriceLines(lines), { same: 26, changed: 0, needsMapping: 0, other: 0, shared: 0 });
});

test("one tier still unlinked: the untiered line keeps showing as a problem", () => {
  const { lines } = run({ unlink: "JD205" });
  assert.equal(lines.filter((l) => l.state === "covered").length, 0);
  assert.ok(lines.some((l) => l.state === "ambiguous" && l.supplierPrice === 49));
  assert.ok(summarizePriceLines(lines).other >= 2);
});

test("untiered price that matches no linked tier group: still a problem", () => {
  const { lines } = run({ untieredPrice: 55 });
  assert.equal(lines.filter((l) => l.state === "covered").length, 0);
  assert.ok(summarizePriceLines(lines).other >= 2);
});

test("a tier saved as shared (not a single alias) does not cover the untiered line", () => {
  const bindings = [...high.map((t) => bind(t, "A")), ...low.map((t) => bind(t, "B"))].map((b) => b.id === "JC200" ? { ...b, kind: "shared" as never } : b);
  const { lines } = run({ bindings: bindings as Binding[] });
  assert.equal(lines.filter((l) => l.state === "covered").length, 0);
});

test("no family chosen yet (family required): nothing is covered, lines wait for a family as before", () => {
  const targets = [row("A", 49), row("B", 17)];
  const sources = [...high.map((t) => src(t, 49)), src("", 49)];
  const bindings = high.map((t) => bind(t, "A"));
  const { lines } = buildPriceLines(matchSupplierPrices(sources, targets, [], bindings), "T1", bindings, { familyRequired: true });
  assert.equal(lines.filter((l) => l.state === "covered").length, 0);
});

test("lines without family tags (the Silver kind) are never treated as untiered family lines", () => {
  const plain = (tier: string, price: number): SourceIdentity => ({ key: `p:${tier}`, code: "608", price_field: "unit_price", dimension: tier, raw_dimension: tier, finishes: [], price, currency: "EUR", row_keys: [], issues: [] }) as unknown as SourceIdentity;
  const { lines } = buildPriceLines(matchSupplierPrices([plain("", 49), plain("T1", 49)], [row("A", 49), row("B", 17)]), "T1", [], {});
  assert.ok(lines.every((l) => l.state !== "covered"));
});

test("consequence: a product whose only open lines were covered summaries can now pass the check; an open problem still blocks it", async () => {
  const { evaluateTemplateCheck } = await import("./supplier-template-check");
  const input = (lines: ReturnType<typeof run>["lines"]) => ({ lines, truncated: false, families: [{ family: "JOYCE", key: "joyce", count: 25 }], chosen: [{ family: "JOYCE", key: "joyce" }], missing: [] });
  assert.equal(evaluateTemplateCheck(input(run().lines) as never).ok, true);
  assert.equal(evaluateTemplateCheck(input(run({ unlink: "JD205" }).lines) as never).ok, false);
});
