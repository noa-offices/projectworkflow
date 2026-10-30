import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { settleSupplierPresentations } from "./supplier-presentation-timeout";

test("Product Management and Local Builder load one shared Supplier Family status map", () => {
  const management = readFileSync("app/products/templates/page.tsx", "utf8");
  const builder = readFileSync("app/quotations/[id]/local-builder/page.tsx", "utf8");
  assert.ok(management.includes("loadSupplierFamilyPriceStatusMap(supabase, activeTemplateList)"));
  assert.ok(management.includes("supplierFamilyStatusPresentation(supplierStatus)"));
  assert.ok(builder.includes("loadSupplierFamilyPriceStatusMap(supabase, productTemplates ?? [])"));
  assert.ok(builder.includes("supplierStatus.status === \"legacy_manual\" && !supplierStatus.brandHasCurrentSource ? null"));
});

test("Product Library renders the shared presentation without changing legacy warning or selection behavior", () => {
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(selector.includes("supplier_family_price_presentation"));
  assert.ok(selector.includes("const supplierPresentation = template.supplier_family_price_presentation ?? null;"));
  assert.ok(selector.includes("priceCheckState(template).tone === \"warning\""));
  assert.ok(selector.includes("disabled={missingExchangeRate || missingRequiredWorkstationSelection || missingRequiredSystemSelection || missingRequiredModularSelection || missingRequiredAccessorySelection || needsUpdatedPriceDecision || hasUnavailableSelectedPrice}"));
});


test("local builder accepts plain status values and fails closed when absent", () => {
  const local = readFileSync("components/quotations/local-quotation-builder.tsx", "utf8");
  const page = readFileSync("app/quotations/[id]/local-builder/page.tsx", "utf8");
  assert.doesNotMatch(local, /supplierPresentationsPromise/);
  assert.doesNotMatch(page, /supplierPresentationsPromise=/);
  assert.match(local, /supplierLoadState = "unavailable"/);
  assert.match(local, /Object\.hasOwn\(supplierPresentations, template.id\)/);
  assert.match(page, /settleSupplierPresentations/);
});

test("a timeout or rejected load gives unavailable without an unhandled late rejection", async () => {
  assert.deepEqual(await settleSupplierPresentations(Promise.reject(new Error("offline")), 10), { supplierPresentations: null, supplierLoadState: "unavailable" });
  let rejectLater!: (error: Error) => void;
  const late = new Promise<Record<string, null>>((_, reject) => { rejectLater = reject; });
  assert.deepEqual(await settleSupplierPresentations(late, 1), { supplierPresentations: null, supplierLoadState: "unavailable" });
  rejectLater(new Error("late failure"));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("a successful load returns plain loaded presentations unchanged", async () => {
  const record = { legacy: null, covered: { label: "Price checked" }, uncovered: { label: "Not covered by a Supplier price list" } };
  assert.deepEqual(await settleSupplierPresentations(Promise.resolve(record), 100), { supplierPresentations: record, supplierLoadState: "loaded" });
});

test("legacy-only quotation builder supplies no supplier status and keeps its legacy path", () => {
  const legacy = readFileSync("app/quotations/[id]/builder/page.tsx", "utf8");
  assert.match(legacy, /<ProductLibrarySelector/);
  assert.doesNotMatch(legacy, /loadSupplierFamilyPriceStatusMap/);
});


test("loaded legacy without a source falls back while covered and unavailable states stay distinct", () => {
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  const local = readFileSync("components/quotations/local-quotation-builder.tsx", "utf8");
  assert.match(selector, /const health = supplierPresentation \?\? legacyHealth/);
  assert.ok(selector.indexOf('supplier_family_price_load_state === "unavailable"') < selector.indexOf('const legacyHealth = friendlyPriceHealth'));
  assert.match(local, /supplierPresentations\?\.\[template.id\] \?\? undefined/);
  assert.match(selector, /supplierPresentation\?\.actionHref/);
});
