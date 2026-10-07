import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertSupplierProfile, type RawSupplierRow, type SupplierProfile } from "./supplier-price-contracts";
import { compatibleProfile, mappingFromProfile, previewImport, profileFromMapping, suggestDefinition, suggestMapping, suggestedImportTitle } from "./supplier-import-wizard";

const wizard = readFileSync("components/products/supplier-import-wizard.tsx", "utf8");
const sources = readFileSync("app/products/price-updates/supplier-sources/page.tsx", "utf8");
const raw = (values: Record<string, unknown>, n = 1): RawSupplierRow => ({ unit_key: `u${n}`, row_number: n, sheet: "S", values });

test("headings are suggested, including matrix price columns", () => {
  const simple = suggestMapping(["Article No.", "Description", "Category", "EUR", "Code"]);
  assert.equal(simple.description, "Description"); assert.equal(simple.category, "Category"); assert.deepEqual(simple.priceColumns.map((c) => c.column), ["EUR"]);
  const tiers = suggestMapping(["Code", "Cat A", "Cat B", "Cat C"]);
  assert.deepEqual(tiers.priceColumns, [{ column: "Cat A", label: "Cat A" }, { column: "Cat B", label: "Cat B" }, { column: "Cat C", label: "Cat C" }]);
  assert.equal(suggestMapping(["Code", "120 x 145", "140 x 145", "160 x 145"]).priceColumns.length, 3);
});

test("a confirmed mapping generates the existing profile config, with column labels as dimensions", () => {
  const profile = profileFromMapping({ ...suggestMapping(["Code", "120 x 145", "140 x 145"]), fullCode: "Code", currency: "EUR", basis: "list" });
  assert.doesNotThrow(() => assertSupplierProfile(profile));
  assert.deepEqual(profile.price_columns, [{ column: "120 x 145", price_field: "unit_price", dimension: "120 x 145" }, { column: "140 x 145", price_field: "unit_price", dimension: "140 x 145" }]);
  assert.equal(profile.strategy, "exact"); assert.equal(profile.currency, "EUR");
  assert.throws(() => profileFromMapping({ ...suggestMapping(["Code"]), fullCode: "" }));
});

test("saved profiles are suggested only when every required column exists, and can be re-opened for review", () => {
  const saved: SupplierProfile = { strategy: "exact", full_code_column: "Code", price_columns: [{ column: "Price", price_field: "unit_price" }], currency: "AED", basis: "net", description_column: "Desc" };
  assert.equal(compatibleProfile([{ id: "p", title: "Old", config: saved }], ["Code", "Price", "Desc"])?.id, "p");
  assert.equal(compatibleProfile([{ id: "p", title: "Old", config: saved }], ["Code", "Other"]), null);
  const mapping = mappingFromProfile(saved); assert.equal(mapping.basis, "net"); assert.deepEqual(profileFromMapping(mapping), saved);
});

test("preview shows normalised code, dimension / tier and price from the real importer", () => {
  const profile = profileFromMapping({ ...suggestMapping(["Code", "120 x 145", "140 x 145"]), fullCode: "Code" });
  const preview = previewImport([raw({ Code: "111065", "120 x 145": 425, "140 x 145": 443 })], profile);
  assert.equal(preview.length, 2); assert.equal(preview[0].code, "111065"); assert.equal(preview[0].dimension, "120 × 145"); assert.equal(preview[0].price, "EUR 425");
  const tier = previewImport([raw({ Code: "141085", Cat: "H", Price: 1542 })], profileFromMapping({ ...suggestMapping(["Code"]), fullCode: "Code", category: "Cat", priceColumns: [{ column: "Price", label: "" }] }));
  assert.match(tier[0].price, /EUR 1,542/);
});

test("details prefill a title; a previous Source Definition is suggested but never guessed among several", () => {
  assert.equal(suggestedImportTitle("INTERSTUHL", new Date("2026-10-07T00:00:00Z")), "INTERSTUHL — October 2026");
  const a = { id: "a", name: "Furniture", profileId: "p1", familyIds: ["f1", "f2"] }, b = { id: "b", name: "Chairs", profileId: "p2", familyIds: ["f3"] };
  assert.equal(suggestDefinition([a, b], "p2")?.id, "b"); assert.equal(suggestDefinition([a, b], null), null); assert.equal(suggestDefinition([a], null)?.id, "a");
});

test("wizard keeps the five steps, reuses the existing import/review pipeline and exposes no JSON", () => {
  for (const step of ["Upload", "Match columns", "Details", "Families", "Review"]) assert.ok(wizard.includes(`"${step}"`), step);
  for (const action of ["saveSupplierProfile", "createSupplierSource(", "uploadSupplierChunk", "finalizeSupplierSource", "createSupplierSourceDefinition", "confirmSupplierCoverage", "linkSupplierSourceDefinition", 'createSupplierReviewBatch(result.id, "complete", [])']) assert.ok(wizard.includes(action), action);
  for (const text of ["Previous column mapping found", "Use previous mapping", "Review mapping", "Use previous Families", "Advanced import settings"]) assert.ok(wizard.includes(text), text);
  assert.doesNotMatch(wizard, /JSON\.stringify|<textarea/);
  for (const name of ["SupplierImportWizard", "SupplierAdvancedImportSettings", "SupplierImportFormatWizard"]) assert.ok(sources.includes(name), name);
});

test("import wizard never touches Product prices, pricing_version or quotations", () => {
  assert.doesNotMatch(wizard, /product_templates|pricing_version|quotation|applySupplierReviewedPrice/);
});
