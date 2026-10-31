import assert from "node:assert/strict";
import test from "node:test";
import { assertSupplierProfile, type RawSupplierRow, type SupplierProfile } from "./supplier-price-contracts";
import { commercialSupplierIdentities, normalizeSupplierRows, plainSupplierDimension, supplierSeriesDimension } from "./supplier-price-import";
import { mappingFromProfile, profileFromMapping, profileRequiredColumns } from "./supplier-import-wizard";

const base: SupplierProfile = { full_code_column: "supplier_code", strategy: "exact", currency: "EUR", basis: "list", category_column: "category", price_columns: [{ column: "price", price_field: "unit_price" }] };
const withFamily: SupplierProfile = { ...base, series_column: "family" };
const withSub: SupplierProfile = { ...withFamily, subfamily_column: "subfamily" };
const row = (index: number, code: string, price: unknown, extra: Record<string, unknown> = {}): RawSupplierRow => ({ unit_key: `r${index}`, row_number: index + 1, sheet: "S", values: { supplier_code: code, price, category: "", ...extra } });
const identities = (rows: RawSupplierRow[], profile: SupplierProfile) => commercialSupplierIdentities(normalizeSupplierRows(rows, profile), profile);

test("a profile without the family settings behaves exactly as before, whatever extra columns the file has", () => {
  const rows = [row(1, "521234", 58, { family: "EVERY", subfamily: "Silver" }), row(2, "521234", 60, { family: "AIM" }), row(3, "999001", 10, { category: "SG3" })];
  const plain = identities(rows, base);
  // Same rows with the family columns removed from the file: identical identities, so the unused columns changed nothing.
  assert.deepEqual(plain, identities(rows.map((item) => ({ ...item, values: { supplier_code: item.values.supplier_code, price: item.values.price, category: item.values.category } })), base));
  assert.deepEqual(plain.map((item) => item.key), [JSON.stringify(["521234", "unit_price", ""]), JSON.stringify(["999001", "unit_price", "SG3"])]);
  // As today: two prices for one code with no family are merged and flagged.
  const merged = plain.find((item) => item.code === "521234")!;
  assert.equal(merged.price, null);
  assert.ok(merged.issues.includes("conflicting_source_prices"));
  assert.deepEqual(plain.map((item) => item.raw_dimension), ["", "SG3"]);
});

test("a family column set but empty on a row leaves that row exactly as before", () => {
  const rows = [row(1, "521234", 58, { family: "" }), row(2, "521234", 58, { family: "  " })];
  assert.deepEqual(identities(rows, withFamily), identities(rows, base));
});

test("Every case: 521234 under AIM 57, EVERY 58 and Goal-Air 57 gives three identities and none is a conflict", () => {
  const rows = [row(1, "521234", 57, { family: "AIM" }), row(2, "521234", 58, { family: "EVERY" }), row(3, "521234", 57, { family: "Goal-Air" })];
  const result = identities(rows, withFamily);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.price).sort(), [57, 57, 58]);
  assert.ok(result.every((item) => !item.issues.includes("conflicting_source_prices")));
  for (const item of result) {
    assert.equal(JSON.parse(item.key).length, 3, "keys stay three parts");
    assert.equal(item.raw_dimension, "", "raw_dimension keeps the plain category");
  }
  assert.deepEqual(result.map((item) => item.dimension).sort(), [JSON.stringify(["", "series", "AIM"]), JSON.stringify(["", "series", "EVERY"]), JSON.stringify(["", "series", "Goal-Air"])].sort());
});

test("a real price conflict inside ONE family is still flagged", () => {
  const result = identities([row(1, "521234", 58, { family: "EVERY" }), row(2, "521234", 60, { family: "EVERY" }), row(3, "521234", 57, { family: "AIM" })], withFamily);
  assert.equal(result.length, 2);
  const every = result.find((item) => item.dimension.includes("EVERY"))!;
  assert.equal(every.price, null);
  assert.ok(every.issues.includes("conflicting_source_prices"));
  assert.ok(!result.find((item) => item.dimension.includes("AIM"))!.issues.includes("conflicting_source_prices"));
});

test("same code and price in two sub-families of one family resolves; without a sub-family column they merge cleanly", () => {
  const rows = [row(1, "521234", 58, { family: "Silver", subfamily: "Silver" }), row(2, "521234", 58, { family: "Silver", subfamily: "Plain" })];
  const split = identities(rows, withSub);
  assert.equal(split.length, 2);
  assert.ok(split.every((item) => item.price === 58 && !item.issues.length));
  assert.deepEqual(split.map((item) => JSON.parse(JSON.parse(item.key)[2])).map((part: string[]) => part.length), [4, 4]);
  const merged = identities(rows, withFamily);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].price, 58);
  assert.ok(!merged[0].issues.includes("conflicting_source_prices"));
});

test("the plain category survives for category-price rows and for explicit price-column labels", () => {
  const result = identities([row(1, "162S", 13, { category: "SG3", family: "Goal-Air" })], withFamily);
  assert.equal(result[0].raw_dimension, "SG3");
  assert.equal(plainSupplierDimension(result[0].dimension), "SG3");
  assert.equal(plainSupplierDimension("SG3"), "SG3");
  assert.equal(plainSupplierDimension('["broken'), '["broken');
  assert.equal(plainSupplierDimension(JSON.stringify(["x", "finish_set", ["a"]])), JSON.stringify(["x", "finish_set", ["a"]]));
  assert.equal(supplierSeriesDimension("5 mm", { ...withFamily, price_columns: [{ column: "price", price_field: "unit_price", dimension: "5 mm" }] }, "AIM", ""), JSON.stringify(["5 mm", "series", "AIM"]));
});

test("profile validation and the wizard carry the optional settings, off by default", () => {
  assert.throws(() => assertSupplierProfile({ ...base, subfamily_column: "subfamily" }), /sub-family column needs a family column/);
  assert.throws(() => assertSupplierProfile({ ...withFamily, subfamily_column: "family" }), /different columns/);
  assert.throws(() => assertSupplierProfile({ ...withFamily, strategy: "article_plus_finish", article_length: 6, finish_length: 3 }), /cannot be combined with article \+ finish/);
  assertSupplierProfile(withSub);
  assert.deepEqual(profileRequiredColumns(withSub).slice(-2).sort(), ["family", "subfamily"]);
  assert.equal(profileRequiredColumns(base).includes("family"), false);
  const mapping = mappingFromProfile(withSub);
  assert.equal(mapping.series, "family");
  assert.equal(profileFromMapping(mapping).subfamily_column, "subfamily");
  const off = profileFromMapping({ ...mappingFromProfile(base) });
  assert.equal("series_column" in off || "subfamily_column" in off, false);
  assert.equal("series_column" in profileFromMapping({ ...mappingFromProfile(base), subfamily: "subfamily" }), false, "a sub-family alone is ignored");
});

test("a non-text family value is reported on the row's cells", () => {
  const cells = normalizeSupplierRows([row(1, "521234", 58, { family: 7 })], withFamily);
  assert.ok(cells[0].issues.includes("non_text_family"));
  assert.equal(cells[0].dimension, "");
});
