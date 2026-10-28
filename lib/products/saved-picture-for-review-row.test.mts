import assert from "node:assert/strict";
import test from "node:test";
import { productTemplateRowReferenceKey } from "./product-template-row-references";
import { displayedReviewRowPicture, savedPictureForReviewRow } from "./smart-product-row-images";

const preview = (pricingType: "finish_category" | "modular" | "base_model", groupId: string, rowId: string) => ({ pricingType, groupId, rowId, previewUrl: `https://signed/${pricingType}/${groupId}/${rowId}` });
const refs = Object.fromEntries([preview("finish_category", "g", "r1"), preview("modular", "m", "r2"), preview("base_model", "b", "r3")].map((r) => [productTemplateRowReferenceKey(r.pricingType, r.groupId, r.rowId), r]));

test("matrix:<g> maps to finish_category and modular:<m> maps to modular", () => {
  assert.equal(savedPictureForReviewRow(refs, "matrix:g", "r1")?.previewUrl, "https://signed/finish_category/g/r1");
  assert.equal(savedPictureForReviewRow(refs, "modular:m", "r2")?.previewUrl, "https://signed/modular/m/r2");
});
test("an unknown row, an unknown group or the wrong type finds nothing", () => {
  assert.equal(savedPictureForReviewRow(refs, "matrix:g", "nope"), null);
  assert.equal(savedPictureForReviewRow(refs, "matrix:other", "r1"), null);
  assert.equal(savedPictureForReviewRow(refs, "modular:g", "r1"), null);
  assert.equal(savedPictureForReviewRow(refs, "matrix:m", "r2"), null);
});
test("other prefixes return nothing (no guessing)", () => {
  for (const key of ["base_model:rows", "base_model:b", "workstation:rows", "option:g", "matrix", "matrix:", "g", ""]) assert.equal(savedPictureForReviewRow(refs, key, "r3"), null, key);
  assert.equal(savedPictureForReviewRow(refs, "matrix:g", ""), null);
});
test("a staged picture takes priority over the saved one", () => {
  assert.equal(displayedReviewRowPicture({ previewUrl: "blob:staged" }, { previewUrl: "https://saved" }), "blob:staged");
  assert.equal(displayedReviewRowPicture(null, { previewUrl: "https://saved" }), "https://saved");
  assert.equal(displayedReviewRowPicture(null, { previewUrl: null }), null);
  assert.equal(displayedReviewRowPicture(null, null), null);
});
