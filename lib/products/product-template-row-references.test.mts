import assert from "node:assert/strict";
import test from "node:test";
import { compressedImageDimensions, persistedProductTemplatePricingRowKeys, productTemplateRowReferenceKey, productTemplateRowReferencePath, resolveProductTemplatePricingRowIdentity, staleProductTemplateRowReferences, type ProductTemplateRowReferenceRow } from "./product-template-row-references.js";

test("row identity isolates pricing type, group, and stable row id", () => {
  assert.notEqual(productTemplateRowReferenceKey("base_model", "a", "same"), productTemplateRowReferenceKey("base_model", "b", "same"));
  assert.notEqual(productTemplateRowReferenceKey("base_model", "a", "same"), productTemplateRowReferenceKey("workstation", "a", "same"));
  assert.equal(productTemplateRowReferenceKey("accessory", "g", "item"), productTemplateRowReferenceKey("accessory", "g", "item"));
});

test("all supported pricing rows produce stable keys independent of name and order", () => {
  const group = (id: string, rowId: string) => [{ id, items: [{ id: rowId, label: "Renamed" }] }];
  const pricing = { deskingSizePricing: group("w", "wr"), variantPricing: group("b", "br"), categoryPricing: [{ id: "c", items: [{ id: "cr" }] }, { id: "m", pricing_type: "modular_group", items: [{ id: "mr" }] }], accessoryPricing: group("a", "ar") };
  const keys = persistedProductTemplatePricingRowKeys(pricing);
  [productTemplateRowReferenceKey("workstation", "w", "wr"), productTemplateRowReferenceKey("base_model", "b", "br"), productTemplateRowReferenceKey("finish_category", "c", "cr"), productTemplateRowReferenceKey("modular", "m", "mr"), productTemplateRowReferenceKey("accessory", "a", "ar")].forEach((key) => assert.ok(keys.has(key)));
  assert.equal(keys.size, 5);
});

test("removed rows become stale while retained IDs survive rename and reorder", () => {
  const reference = { id: "ref", template_id: "t", pricing_type: "base_model", group_id: "g", row_id: "r", storage_path: "p", caption: null, created_at: "", updated_at: "" } satisfies ProductTemplateRowReferenceRow;
  assert.deepEqual(staleProductTemplateRowReferences([reference], new Set([productTemplateRowReferenceKey("base_model", "g", "r")])), []);
  assert.deepEqual(staleProductTemplateRowReferences([reference], new Set()), [reference]);
});

test("compression preserves aspect ratio and caps oversized images", () => {
  assert.deepEqual(compressedImageDimensions(2000, 1000), { width: 500, height: 250 });
  assert.deepEqual(compressedImageDimensions(120, 240), { width: 120, height: 240 });
});

test("storage paths preserve the compressed browser output type", () => {
  assert.match(productTemplateRowReferencePath("t", "base_model", "g", "r", "ref"), /ref\.webp$/);
  assert.match(productTemplateRowReferencePath("t", "base_model", "g", "r", "ref", "image\/png"), /ref\.png$/);
});

test("pending save resolves the final persisted group from pricing type and stable row id", () => {
  const pricing = { deskingSizePricing: [{ id: "wg", items: [{ id: "same" }] }], variantPricing: [{ id: "bg", items: [{ id: "same" }] }], categoryPricing: [{ id: "cg", items: [{ id: "same" }] }, { id: "mg", pricing_type: "modular_group", items: [{ id: "same" }] }], accessoryPricing: [{ id: "ag", items: [{ id: "same" }] }] };
  assert.deepEqual(resolveProductTemplatePricingRowIdentity(pricing, "workstation", "same"), { groupId: "wg", rowId: "same" });
  assert.deepEqual(resolveProductTemplatePricingRowIdentity(pricing, "base_model", "same"), { groupId: "bg", rowId: "same" });
  assert.deepEqual(resolveProductTemplatePricingRowIdentity(pricing, "finish_category", "same"), { groupId: "cg", rowId: "same" });
  assert.deepEqual(resolveProductTemplatePricingRowIdentity(pricing, "modular", "same"), { groupId: "mg", rowId: "same" });
  assert.deepEqual(resolveProductTemplatePricingRowIdentity(pricing, "accessory", "same"), { groupId: "ag", rowId: "same" });
});
