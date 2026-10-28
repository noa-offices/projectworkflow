import assert from "node:assert/strict";
import test from "node:test";
import { productTemplateRowReferenceKey, selectedRowReferencePreview } from "./product-template-row-references";

const preview = (pricingType: "finish_category" | "base_model" | "modular", groupId: string, rowId: string) => ({ id: `${pricingType}-${rowId}`, pricingType, groupId, rowId, previewUrl: `https://signed/${rowId}`, caption: null });
const refs = Object.fromEntries([preview("finish_category", "mesh-backrest", "X"), preview("base_model", "main", "B"), preview("modular", "mod-1", "M")].map((r) => [productTemplateRowReferenceKey(r.pricingType, r.groupId, r.rowId), r]));

test("a finish_category reference is found for a finish-category variant row", () => {
  assert.equal(selectedRowReferencePreview(refs, "finish_category", "mesh-backrest", "X")?.previewUrl, "https://signed/X");
});
test("a modular reference is found for a modular row, and base_model still works", () => {
  assert.equal(selectedRowReferencePreview(refs, "modular", "mod-1", "M")?.previewUrl, "https://signed/M");
  assert.equal(selectedRowReferencePreview(refs, "base_model", "main", "B")?.previewUrl, "https://signed/B");
});
test("a base_model lookup does not find a finish_category reference, and a missing reference gives no picture", () => {
  assert.equal(selectedRowReferencePreview(refs, "base_model", "mesh-backrest", "X"), null);
  assert.equal(selectedRowReferencePreview(refs, "finish_category", "mesh-backrest", "nope"), null);
  assert.equal(selectedRowReferencePreview(refs, "finish_category", null, "X"), null);
  assert.equal(selectedRowReferencePreview(refs, "finish_category", "mesh-backrest", undefined), null);
});
test("the fallback (subgroup picture) is used only when the row has no picture of its own", () => {
  const fallback = preview("base_model", "main", "sub");
  assert.equal(selectedRowReferencePreview(refs, "base_model", "main", "other", () => fallback), fallback);
  assert.equal(selectedRowReferencePreview(refs, "finish_category", "mesh-backrest", "X", () => fallback)?.previewUrl, "https://signed/X");
  assert.equal(selectedRowReferencePreview(refs, "base_model", "main", "other"), null);
});
