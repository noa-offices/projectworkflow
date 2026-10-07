import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Product Management and Local Builder load one shared Supplier Family status map", () => {
  const management = readFileSync("app/products/templates/page.tsx", "utf8");
  const builder = readFileSync("app/quotations/[id]/local-builder/page.tsx", "utf8");
  assert.ok(management.includes("loadSupplierFamilyPriceStatusMap(supabase, activeTemplateList)"));
  assert.ok(management.includes("supplierFamilyStatusPresentation(supplierStatus)"));
  assert.ok(builder.includes("loadSupplierFamilyPriceStatusMap(supabase, productTemplates ?? [])"));
  assert.ok(builder.includes("supplier_family_price_presentation"));
});

test("Product Library renders the shared presentation without changing legacy warning or selection behavior", () => {
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.ok(selector.includes("supplier_family_price_presentation"));
  assert.ok(selector.includes("const supplierPresentation = template.supplier_family_price_presentation ?? null;"));
  assert.ok(selector.includes("!template.supplier_family_price_presentation && priceCheckState(template).tone === \"warning\""));
  assert.ok(selector.includes("disabled={missingExchangeRate || missingRequiredWorkstationSelection || missingRequiredSystemSelection || missingRequiredModularSelection || missingRequiredAccessorySelection || needsUpdatedPriceDecision || hasUnavailableSelectedPrice}"));
});
