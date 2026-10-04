import assert from "node:assert/strict";
import test from "node:test";
import { brandPriceTargets } from "./supplier-price-targets.js";
import { comparisonCode, matchSupplierPrices } from "./supplier-price-matching.js";
import { normalizeSupplierRows, commercialSupplierIdentities } from "./supplier-price-import.js";
import type { ProductPriceInput, SourceIdentity, SupplierProfile } from "./supplier-price-contracts.js";

const template = (id: string, item_code: string, price = 100): ProductPriceInput => ({ id, brand_id: "brand", template_name: `Template ${id}`, pricing_version: 1, item_code, currency: "EUR", default_unit_price: price });
const supplier = (code: string, price = 100): SourceIdentity => ({ key: `key-${code}`, code, price_field: "unit_price", dimension: "", finishes: ["144"], price, currency: "EUR", row_keys: ["row"], issues: [] });
const match = (codes: string[], sourceCode: string, price = 100) => {
  const targets = brandPriceTargets(codes.map((code, index) => template(`t${index}`, code)));
  return { targets, result: matchSupplierPrices([supplier(sourceCode, price)], targets).filter((item) => item.source) };
};

test("comparison code ignores all whitespace and nothing else", () => {
  assert.equal(comparisonCode("1AF 044"), "1AF044"); assert.equal(comparisonCode("1AF044"), "1AF044"); assert.equal(comparisonCode("  1AF \t 044  "), "1AF044");
  assert.equal(comparisonCode("111069"), "111069"); assert.equal(comparisonCode("CHR-220/01"), "CHR-220/01"); assert.equal(comparisonCode("001234"), "001234"); // leading zeros, punctuation and case are untouched
});

test("real LAS base articles match the compact Supplier article, with codes left as stored", () => {
  for (const [productCode, supplierCode] of [["111069", "111069"], ["1AF 044", "1AF044"], ["1AF 045", "1AF045"], ["1AF 090", "1AF090"], ["1AF 091", "1AF091"], ["1AF 092", "1AF092"]]) {
    const { targets, result } = match([productCode], supplierCode);
    assert.equal(result.length, 1, productCode); assert.equal(result[0].classification, "unchanged", productCode);
    assert.equal(result[0].targets[0].key, targets[0].key); assert.equal(result[0].targets[0].raw_code, productCode); // stored Product code unchanged
    assert.equal(result[0].source!.code, supplierCode); // Supplier identity unchanged
  }
  assert.equal(match(["1AF 044"], "1AF044", 120).result[0].classification, "increased"); // price comparison still works after matching
  assert.equal(match(["  1AF044  "], "1AF 044").result[0].classification, "unchanged"); // leading/trailing whitespace on either side
});

test("no target is reported missing for an equivalent code, and unrelated codes still do not match", () => {
  const targets = brandPriceTargets([template("a", "1AF 044"), template("b", "111069")]);
  const all = matchSupplierPrices([supplier("1AF044"), supplier("111069")], targets);
  assert.equal(all.filter((item) => item.classification === "target_not_represented").length, 0);
  const other = matchSupplierPrices([supplier("1AF046")], brandPriceTargets([template("a", "1AF 044")]));
  assert.deepEqual(other.map((item) => item.classification).sort(), ["target_not_represented", "unmatched"]);
  assert.equal(matchSupplierPrices([supplier("111069144")], brandPriceTargets([template("a", "111069")])).some((item) => item.classification === "unchanged"), false); // numeric full codes are not prefix-matched
});

test("two Product codes that collapse to one comparison code stay ambiguous, never silently merged", () => {
  const { result } = match(["1AF 044", "1AF044"], "1AF044");
  assert.equal(result.length, 1); assert.equal(result[0].classification, "ambiguous"); assert.equal(result[0].targets.length, 2);
  assert.deepEqual(result[0].targets.map((target) => target.raw_code).sort(), ["1AF 044", "1AF044"]);
});

test("a durable binding on the compact Supplier code still applies to a spaced Product code", () => {
  const targets = brandPriceTargets([template("a", "1AF 044"), template("b", "1AF 044")]);
  const binding = { id: "b1", code: "1AF044", price_field: "unit_price", source_dimension: "", target_keys: targets.map((target) => target.key), kind: "shared" as const, confirmed: true };
  const found = matchSupplierPrices([supplier("1AF044")], targets, [], [binding]).filter((item) => item.source);
  assert.equal(found[0].classification, "shared"); assert.equal(found[0].targets.length, 2);
});

test("the October LAS profile still yields compact article identities that match spaced Product codes", () => {
  const profile: SupplierProfile = { full_code_column: "CODE", article_code_column: "NOME_FILE", strategy: "article_plus_finish", article_length: 6, finish_length: 3, validated_article_fallback: true, price_columns: [{ column: "PRICE", price_field: "unit_price" }], currency: "EUR", basis: "list" };
  const rows = [["1AF044500", "1AF044"], ["1AF044330", "1AF044"], ["111069144", "111069"], ["111069163", "111069"]].map(([code, article], index) => ({ unit_key: String(index), row_number: index + 2, sheet: "S", values: { CODE: code, NOME_FILE: article, PRICE: 100 } }));
  const identities = commercialSupplierIdentities(normalizeSupplierRows(rows, profile), profile);
  assert.deepEqual(identities.map((item) => item.code).sort(), ["111069", "1AF044"]);
  const targets = brandPriceTargets([template("a", "1AF 044"), template("b", "111069")]);
  const results = matchSupplierPrices(identities, targets);
  assert.equal(results.filter((item) => item.classification === "target_not_represented").length, 0);
  assert.deepEqual(results.map((item) => item.classification).sort(), ["unchanged", "unchanged"]);
});

// ---- Phase 2H: one comparison rule for every matcher path ----
const one = (productCode: string, supplierCode: string) => match([productCode], supplierCode).result;
const matched = (productCode: string, supplierCode: string) => one(productCode, supplierCode).some((item) => item.source && item.targets.length === 1 && item.classification === "unchanged");

test("real LAS formatting differences match (spaces only), and the stored codes stay as they are", () => {
  for (const [product, supplierCode] of [["1AF 044", "1AF044"], ["1AJ M33", "1AJM33"], ["1AG 207", "1AG207"], ["111071", "111071"], [" 1AF   044 ", "1AF044"], ["001 045", "001045"], ["1AF044", "1AF 044"]]) assert.equal(matched(product, supplierCode), true, `${product} / ${supplierCode}`);
  const result = one("1AG 207", "1AG207")[0];
  assert.equal(result.targets[0].raw_code, "1AG 207"); assert.equal(result.source!.code, "1AG207");
  assert.equal(comparisonCode("001 045"), "001045");
});

test("only whitespace is ignored: punctuation, zeros, extra digits and neighbours stay different", () => {
  for (const [product, supplierCode] of [["1AG207", "1AG-207"], ["ABC01", "ABC001"], ["111071", "1110711"], ["1AF045", "1AF046"], ["1AF 044", "1AF04"], ["1AF 04", "1AF044"], ["1AG 207", "1AG.207"], ["1AG 207", "1AG/207"]]) assert.equal(matched(product, supplierCode), false, `${product} / ${supplierCode}`);
  assert.equal(comparisonCode("1AG-207"), "1AG-207");
});

test("the live regression families resolve with one common rule, without brand-specific logic", () => {
  const families: Record<string, string[]> = { MONOLITH: ["1AF 044", "1AF 045"], Sigma: ["1AJ M33", "1AJ M34", "1AJ P58"], "Universal Cabinet": ["1AG 207", "1AG 208", "1AG 209", "1AG 210"], OXI_P: ["111069", "111070", "111071", "111072"] };
  for (const [family, codes] of Object.entries(families)) {
    const targets = brandPriceTargets(codes.map((code, index) => template(`${family}-${index}`, code)));
    const results = matchSupplierPrices(codes.map((code) => supplier(code.replace(/\s+/g, ""))), targets);
    assert.equal(results.filter((item) => item.classification === "target_not_represented").length, 0, family);
    assert.equal(results.filter((item) => item.classification === "unchanged").length, codes.length, family);
  }
});

test("collisions and conflicting bindings never resolve silently", () => {
  const collided = one("1AF 044", "1AF044").concat(match(["1AF 044", "1AF044"], "1AF044").result);
  assert.ok(collided.some((item) => item.classification === "ambiguous" && item.targets.length === 2));
  const targets = brandPriceTargets([template("a", "1AF 044"), template("b", "1AF 044")]);
  const keys = targets.map((target) => target.key);
  const binding = (id: string, code: string, target_keys: string[]) => ({ id, code, price_field: "unit_price", source_dimension: "", target_keys, kind: "disambiguation" as const, confirmed: true });
  const resolved = matchSupplierPrices([supplier("1AF044")], targets, [], [binding("one", "1AF 044", [keys[0]])]).find((item) => item.source)!; // spaced binding code, compact Supplier code
  assert.deepEqual([resolved.classification, resolved.targets.map((target) => target.key)], ["unchanged", [keys[0]]]);
  const conflicting = matchSupplierPrices([supplier("1AF044")], targets, [], [binding("one", "1AF 044", [keys[0]]), binding("two", "1AF044", [keys[1]])]).find((item) => item.source)!;
  assert.equal(conflicting.classification, "ambiguous"); // two bindings for one comparison identity: neither wins
});

test("an article present in the Supplier source is never reported as missing when it needs another mapping", () => {
  const tiered = [{ ...supplier("111070", 100), dimension: JSON.stringify(["", "finish_set", ["331"]]), raw_dimension: "", finishes: ["331"] }, { ...supplier("111070", 120), key: "k2", dimension: JSON.stringify(["", "finish_set", ["337"]]), raw_dimension: "", finishes: ["337"] }];
  const results = matchSupplierPrices(tiered, brandPriceTargets([template("1", "111070")]));
  assert.deepEqual(results.map((item) => item.classification), ["needs_dimension_mapping", "needs_dimension_mapping"]);
  assert.equal(results.some((item) => item.classification === "target_not_represented"), false);
  const absent = matchSupplierPrices([supplier("999999")], brandPriceTargets([template("1", "111070")])); // genuinely absent stays missing
  assert.ok(absent.some((item) => item.classification === "target_not_represented"));
});
