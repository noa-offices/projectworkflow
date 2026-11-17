import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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

test("grouped base-model and ordinary accessory pictures use saved reference identities", () => {
  for (const [prefix, pricingType, groupId, rowId] of [
    ["base_model_group", "base_model", "legacy-base-model-main", "oxi-q-desk-60-599"],
    ["option", "accessory", "oxi-q-modesty-panels", "oxi-q-panel-445"],
  ] as const) {
    const saved = { previewUrl: "https://saved.example/row.webp" };
    const references = { [productTemplateRowReferenceKey(pricingType, groupId, rowId)]: saved };
    assert.equal(savedPictureForReviewRow(references, `${prefix}:${groupId}`, rowId), saved);
    assert.equal(displayedReviewRowPicture({ previewUrl: "blob:staged" }, savedPictureForReviewRow(references, `${prefix}:${groupId}`, rowId)), "blob:staged");
    assert.equal(savedPictureForReviewRow(references, `${prefix}:`, rowId), null);
    assert.equal(savedPictureForReviewRow(references, `${prefix}:${groupId}`, ""), null);
    assert.equal(savedPictureForReviewRow({}, `${prefix}:${groupId}`, rowId), null);
    const colonGroup = `${groupId}:suffix`;
    assert.equal(savedPictureForReviewRow({ [productTemplateRowReferenceKey(pricingType, colonGroup, rowId)]: saved }, `${prefix}:${colonGroup}`, rowId), saved);
  }
});

test("saved picture lookup is display-only and absent from save, upload and delete actions", () => {
  for (const file of ["../../app/products/templates/actions.ts", "../../app/products/templates/row-reference-actions.ts", "../../components/products/product-template-form.tsx"]) {
    assert.equal(readFileSync(new URL(file, import.meta.url), "utf8").includes("savedPictureForReviewRow"), false, file);
  }
  const display = readFileSync(new URL("../../components/products/staged-pricing-row-reference-image.tsx", import.meta.url), "utf8");
  assert.ok(display.includes("const shownUrl = displayedReviewRowPicture(image, savedPictureForReviewRow("));
});
