import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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


test("local supplier failures and missing statuses cannot fall through to legacy wording", () => {
  const local = readFileSync("components/quotations/local-quotation-builder.tsx", "utf8");
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(local, /supplierPresentationsPromise \? "loading" : "unavailable"/);
  assert.match(local, /catch \{\s*if \(!cancelled\) setSupplierLoadState\("unavailable"\)/);
  assert.match(local, /Object\.hasOwn\(supplierPresentations, template.id\) \? "loaded" as const : "unavailable" as const/);
  assert.match(selector, /supplier_family_price_load_state === "unavailable"/);
  assert.match(selector, /Supplier price status unavailable/);
  assert.match(selector, /Reload the page to try again/);
  assert.match(selector, /supplier_family_price_load_state\?: "loaded" \| "unavailable"/);
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
