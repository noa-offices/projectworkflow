import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { normalizeSupplierRows, commercialSupplierIdentities, supplierImportChunks } from "./supplier-price-import.js";
import { parseSupplierCsv, parseSupplierJson, parseSupplierFile } from "./supplier-price-file.js";
import { brandPriceTargets } from "./supplier-price-targets.js";
import { matchSupplierPrices, sharedBaselineDrift, templateReviewUnits } from "./supplier-price-matching.js";
import { supplierRows, supplierMatchChunks } from "./supplier-price-repository.js";
import { assertSupplierProfile, type RawSupplierRow, type SupplierProfile, type ProductPriceInput, type SourceIdentity } from "./supplier-price-contracts.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const profile: SupplierProfile = { full_code_column: "CODE", article_code_column: "NOME_FILE", strategy: "article_plus_finish", article_length: 6, finish_length: 3, validated_article_fallback: true, category_column: "CATEGORIA_TESSUTO", currency: "EUR", basis: "unknown", price_columns: [{ column: "PREZZO_UNITARIO", price_field: "unit_price" }] };
const row = (code: unknown = "111001144", article: unknown = "111001", price: unknown = 152, extra: Record<string, unknown> = {}): RawSupplierRow => ({ unit_key: JSON.stringify(["Sheet1", code]), sheet: "Sheet1", row_number: 2, values: { CODE: code, NOME_FILE: article, PREZZO_UNITARIO: price, CATEGORIA_TESSUTO: "", ECOTAXE: 99, ...extra } });
const identities = (rows: RawSupplierRow[], p = profile) => commercialSupplierIdentities(normalizeSupplierRows(rows, p), p);
const template = (changes: Record<string, unknown> = {}): ProductPriceInput => ({ id: "template", brand_id: "brand", template_name: "Existing Template", pricing_version: 4, item_code: "111001", currency: "EUR", default_unit_price: 150, ...changes });
const source = (changes: Partial<SourceIdentity> = {}): SourceIdentity => ({ key: "source", code: "111001", price_field: "unit_price", dimension: "", finishes: [], currency: "EUR", price: 152, row_keys: ["row"], issues: [], ...changes });

test("LAS profile splits text, preserves article/finish and never changes ECOTAXE or basis", () => {
  const raw = row(); const before = structuredClone(raw); const cell = normalizeSupplierRows([raw], profile)[0];
  assert.equal(cell.code, "111001"); assert.equal(cell.raw_code, "111001144"); assert.equal(cell.raw_article, "111001"); assert.equal(cell.finish, "144"); assert.equal(cell.price, 152); assert.deepEqual(cell.issues, []); assert.deepEqual(raw, before); assert.equal(profile.basis, "unknown");
});
test("article agreement, missing validated fallback, disagreement and odd six-character row", () => {
  assert.deepEqual(normalizeSupplierRows([row()], profile)[0].issues, []);
  assert.equal(normalizeSupplierRows([row("111001144", undefined)], profile)[0].code, "111001");
  assert.ok(normalizeSupplierRows([row("111001144", "222222")], profile)[0].issues.includes("article_full_code_disagreement"));
  assert.ok(normalizeSupplierRows([row("111001", "111001")], profile)[0].issues.includes("unexpected_full_code_length"));
});
test("numeric code cells flagged, scientific-looking text / leading zeros / punctuation preserved", () => {
  const exact = { ...profile, strategy: "exact" as const, article_code_column: undefined };
  for (const code of ["001234", "1E0100", "CHR-220/01"]) assert.equal(normalizeSupplierRows([row(code)], exact)[0].raw_code, code);
  assert.ok(normalizeSupplierRows([row(111001144)], profile)[0].issues.includes("numeric_or_non_text_code"));
  assert.ok(normalizeSupplierRows([row("111001144", 111001)], profile)[0].issues.includes("numeric_or_non_text_article"));
});
test("finish collapse is whole-source, equal-price only; differing finish prices remain explicit tiers", () => {
  const equal = identities([row(), row("111001145"), row("111001146")]); assert.equal(equal.length, 1); assert.equal(equal[0].dimension, ""); assert.equal(equal[0].row_keys.length, 3);
  assert.deepEqual(equal[0].finishes, ["144", "145", "146"]); assert.equal(equal[0].price, 152);
  const varied = identities([row("146514144", "146514", 2046), row("146514145", "146514", 2046), row("146514999", "146514", 2436)]);
  assert.equal(varied.length, 2); assert.deepEqual(varied.map((identity) => identity.price), [2046, 2436]); assert.deepEqual(varied[0].finishes, ["144", "145"]); assert.ok(varied.every((identity) => identity.dimension));
  const conflict = identities([row(), { ...row(), unit_key: "other", values: { ...row().values, PREZZO_UNITARIO: 153 } }]); assert.ok(conflict.every((identity) => identity.issues.includes("conflicting_source_prices")));
});
test("wide price cells, raw fabric categories, price fields remain separate", () => {
  const p = { ...profile, strategy: "exact" as const, price_columns: [{ column: "A", price_field: "unit_price" as const, dimension: "Cat A" }, { column: "B", price_field: "unit_price" as const, dimension: "Cat B" }] };
  const normalized = normalizeSupplierRows([row("CHR-220", "", 0, { A: 420, B: 455 })], p); assert.equal(normalized.length, 2); assert.deepEqual(normalized.map((cell) => [cell.dimension, cell.price]), [["Cat A", 420], ["Cat B", 455]]);
  assert.equal(normalizeSupplierRows([row(undefined, undefined, 1, { CATEGORIA_TESSUTO: "Pelle 1" })], profile)[0].dimension, "Pelle 1");
});
test("strict profile currencies and price parsing; no locale or list/net guessing", () => {
  for (const currency of ["AED", "EUR", "USD"]) assert.doesNotThrow(() => assertSupplierProfile({ ...profile, currency }));
  for (const currency of ["GBP", "", undefined]) assert.throws(() => assertSupplierProfile({ ...profile, currency }));
  for (const price of ["1,234", "1.234,56", -1, Infinity]) assert.ok(normalizeSupplierRows([row(undefined, undefined, price)], profile)[0].issues.includes("invalid_price"));
});
test("CSV quoted/newline fields and JSON keep text vs numeric cell types", () => {
  const csv = parseSupplierCsv('CODE,PRICE,NOTES\r\n0012,42,"comma, quote ""value""\nline"'); assert.equal(csv[0].values.CODE, "0012"); assert.equal(csv[0].row_number, 2); assert.match(String(csv[0].values.NOTES), /line/);
  const json = parseSupplierJson('[{"CODE":"1E100","PRICE":2},{"CODE":1200,"PRICE":3}]'); assert.equal(typeof json[0].values.CODE, "string"); assert.equal(typeof json[1].values.CODE, "number");
  assert.equal(parseSupplierCsv('CODE,NOTES\n001,"two\nlines"\n002,next')[1].row_number, 4);
  assert.throws(() => parseSupplierCsv('CODE,CODE\n1,2')); assert.throws(() => parseSupplierCsv('CODE\n"unterminated'));
});
test("actual XLSX text/numeric cells are preserved and PDF rejected", async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Source"); sheet.addRow(["CODE", "PRICE"]); sheet.addRow(["001E100", 5]); sheet.addRow([1234000, 6]);
  const buffer = await workbook.xlsx.writeBuffer(); const rows = await parseSupplierFile(new File([buffer], "source.xlsx")); assert.equal(rows[0].values.CODE, "001E100"); assert.equal(typeof rows[1].values.CODE, "number"); assert.equal(rows[1].row_number, 3);
  await assert.rejects(parseSupplierFile(new File(["pdf"], "source.pdf")), /not supported/);
  await assert.rejects(parseSupplierFile(new File([buffer], "source.xlsx"), ["Missing"]), /sheet is missing/);
});
for (const count of [100, 500, 2500, 46108]) test(`${count} source rows: bounded chunks, complete unit counts, all identities`, () => {
  const rows = Array.from({ length: count }, (_value, index) => ({ ...row(String(index).padStart(6, "0") + "144", String(index).padStart(6, "0")), unit_key: `row-${index}`, row_number: index + 2 }));
  const chunks = supplierImportChunks(rows, 500, 600_000, profile); assert.equal(chunks.flat().length, count); assert.ok(chunks.every((chunk) => chunk.length * 2 <= 500)); assert.equal(identities(rows).length, count);
});
test("bounded database reads explicitly page beyond default 1000; no per-row query", async () => {
  const data = Array.from({ length: 2500 }, (_value, id) => ({ id })); let calls = 0;
  const query = { select() { return this; }, order() { return this; }, eq() { return this; }, range(from: number, to: number) { calls++; return Promise.resolve({ data: data.slice(from, to + 1), error: null }); } };
  const client = { from: () => query } as unknown as SupabaseClient;
  assert.equal((await supplierRows(client, "fixture", "id")).length, 2500); assert.equal(calls, 6);
});
test("target index supports every current architecture with stored stable identities", () => {
  const data = template({ variant_pricing: [{ id: "base-group", items: [{ id: "base-row", supplier_price_list_code: "BASE", price: 10 }] }], category_pricing: [{ id: "matrix-group", price_columns: [{ id: "frozen_a", label: "Changed display", dimension_code: "cat_a" }], items: [{ id: "matrix-row", supplier_price_list_code: "MATRIX", prices: { frozen_a: 20 } }] }, { id: "direct", pricing_type: "modular_group", modular_pricing_mode: "direct", items: [{ id: "direct-row", supplier_price_list_code: "DIRECT", price: 30 }] }, { id: "modular-matrix", pricing_type: "modular_group", price_columns: [{ id: "frozen_b", label: "B", dimension_code: "cat_b" }], items: [{ id: "mod-row", supplier_price_list_code: "MOD", prices: { frozen_b: 40 } }] }], desking_size_pricing: [{ id: "ws", items: [{ id: "ws-row", base_supplier_price_list_code: "WS", additional_supplier_price_list_code: "WS-ADD", default_price: 50, additional_price: 60 }] }], accessory_pricing: [{ id: "accessories", items: [{ id: "add", supplier_price_list_code: "ACC", price: 70 }] }] });
  const before = structuredClone(data); const targets = brandPriceTargets([data], [{ id: "comp", template_id: "template", component_code: "COMP", unit_price: 80, currency: "EUR" }]); assert.equal(targets.length, 8); assert.equal(targets.find((target) => target.code === "MATRIX")?.column_id, "frozen_a"); assert.equal(targets.find((target) => target.code === "MATRIX")?.dimension, "cat_a"); assert.equal(targets.find((target) => target.code === "WS-ADD")?.price_field, "additional_price"); assert.deepEqual(data, before);
  assert.throws(() => brandPriceTargets([template({ variant_pricing: [{ supplier_price_list_code: "NO-ID", price: 1 }] })]), /Persisted target identity missing/);
});
test("scalar exact matching, no fuzzy remap and direction classifications", () => {
  const targets = brandPriceTargets([template()]);
  for (const [price, classification] of [[152, "increased"], [150, "unchanged"], [149, "decreased"]] as const) assert.equal(matchSupplierPrices([source({ price })], targets)[0].classification, classification);
  assert.equal(matchSupplierPrices([source({ code: "111001-X" })], targets)[0].classification, "unmatched");
  assert.equal(matchSupplierPrices([], targets)[0].classification, "target_not_represented");
});
test("matrix needs explicit vocabulary; group overrides and finish sets are deterministic", () => {
  const target = { ...brandPriceTargets([template()])[0], dimension: "cat_a", column_id: "frozen" };
  const cell = source({ dimension: "CAT. A" });
  assert.equal(matchSupplierPrices([cell], [target])[0].classification, "needs_dimension_mapping");
  const rule = { id: "rule", brand_id: "brand", raw_labels: ["CAT. A"], finish_codes: [], dimension_code: "cat_a" };
  assert.equal(matchSupplierPrices([cell], [target], [rule])[0].classification, "increased");
  assert.equal(matchSupplierPrices([cell], [target], [rule, { ...rule, id: "override", template_id: "template", group_id: "default", dimension_code: "cat_b" }])[0].classification, "needs_dimension_mapping");
  assert.equal(matchSupplierPrices([source({ dimension: "tier", finishes: ["144", "145"] })], [target], [{ ...rule, raw_labels: [], finish_codes: ["144", "145"] }])[0].classification, "increased");
  assert.equal(matchSupplierPrices([cell], [target], [{ ...rule, raw_labels: [], finish_codes: ["144", "145"] }])[0].classification, "needs_dimension_mapping");
});
test("duplicate/shared bindings and baseline drift; selected scope only filters review", () => {
  const targets = brandPriceTargets([template(), template({ id: "other", template_name: "Other" })]);
  const ambiguous = matchSupplierPrices([source()], targets); assert.equal(ambiguous[0].classification, "ambiguous"); assert.equal(ambiguous[0].candidate_shared, true);
  assert.equal(templateReviewUnits(ambiguous, ["template"]).length, 1); assert.equal(ambiguous[0].targets.length, 2);
  const binding = { id: "binding", code: "111001", price_field: "unit_price", source_dimension: "", target_keys: targets.map((target) => target.key), kind: "shared" as const, confirmed: true };
  assert.equal(matchSupplierPrices([source()], targets, [], [binding])[0].classification, "shared");
  const drift = [targets[0], { ...targets[1], price: 155 }]; assert.equal(sharedBaselineDrift(drift), true); assert.equal(matchSupplierPrices([source()], drift, [], [binding])[0].classification, "baseline_drift");
  const alias = { ...binding, code: "NEW-CODE", kind: "alias" as const, target_keys: [targets[0].key] }; assert.equal(matchSupplierPrices([source({ code: "NEW-CODE" })], targets, [], [alias])[0].classification, "increased");
  assert.ok(supplierMatchChunks(ambiguous).every((chunk) => chunk.length <= 500));
});

test("collapsed blank-dimension finishes resolve explicit vocabulary and compare 81 against 92 as decreased", () => {
  const original = identities([row("103801170", "103801", 81), row("103801220", "103801", 81), row("103801331", "103801", 81)]);
  assert.equal(original.length, 1); assert.equal(original[0].dimension, ""); assert.deepEqual(original[0].finishes, ["170", "220", "331"]);
  const target = { ...brandPriceTargets([template({ item_code: "103801", default_unit_price: 92 })])[0], dimension: "melamine", column_id: "melamine-column" };
  const rule = { id: "melamine", brand_id: "brand", raw_labels: [], finish_codes: ["170", "220", "331"], dimension_code: "melamine" };
  const before = structuredClone({ original, target });
  const match = matchSupplierPrices(original, [target], [rule])[0];
  assert.equal(match.classification, "decreased"); assert.equal(match.comparison, "decreased"); assert.equal(match.targets[0].key, target.key);
  assert.deepEqual({ original, target }, before);
  assert.equal(matchSupplierPrices([{ ...original[0], finishes: [] }], [target], [rule])[0].classification, "needs_dimension_mapping");
  assert.equal(matchSupplierPrices(original, [target], [{ ...rule, finish_codes: ["170", "220"] }])[0].classification, "needs_dimension_mapping");
  assert.equal(matchSupplierPrices(original, [target], [{ ...rule, brand_id: "another-brand" }])[0].classification, "needs_dimension_mapping");
  assert.equal(matchSupplierPrices(original, [target], [{ ...rule, template_id: "another-template" }])[0].classification, "needs_dimension_mapping");
  assert.equal(matchSupplierPrices(original, [target], [{ ...rule, group_id: "another-group" }])[0].classification, "needs_dimension_mapping");
  assert.equal(matchSupplierPrices(original, [target], [rule, { ...rule, id: "conflict", dimension_code: "other" }])[0].classification, "needs_dimension_mapping");
  assert.equal(matchSupplierPrices(original, [target], [{ ...rule, dimension_code: "other" }, { ...rule, template_id: target.template_id, group_id: target.group_id }])[0].classification, "decreased");
});

test("label mappings remain eligible for collapsed finish evidence; price tiers still need finish evidence rules", () => {
  const cell = identities([row("111001170", "111001", 152, { CATEGORIA_TESSUTO: "B" }), row("111001220", "111001", 152, { CATEGORIA_TESSUTO: "B" })])[0];
  const target = { ...brandPriceTargets([template()])[0], dimension: "cat_b", column_id: "column-b" };
  const rule = { id: "B", brand_id: "brand", raw_labels: ["B"], finish_codes: [], dimension_code: "cat_b" };
  assert.equal(matchSupplierPrices([cell], [target], [rule])[0].classification, "increased");
  const tiers = identities([row("111001170", "111001", 152, { CATEGORIA_TESSUTO: "B" }), row("111001220", "111001", 190, { CATEGORIA_TESSUTO: "B" })]);
  assert.ok(tiers.every((tier) => matchSupplierPrices([tier], [target], [rule])[0].classification === "needs_dimension_mapping"));
  assert.equal(matchSupplierPrices([cell], brandPriceTargets([template()]))[0].classification, "needs_dimension_mapping");
  const scalar = identities([row(), row("111001145")])[0];
  assert.equal(matchSupplierPrices([scalar], brandPriceTargets([template()]))[0].classification, "increased");
});
