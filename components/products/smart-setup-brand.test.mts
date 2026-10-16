import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { effectiveSmartSetupBrandId, jsonManufacturerHint, smartSetupBrandChangeNeedsConfirmation, smartSetupBrandToCommit } from "../../lib/products/smart-setup-brand.js";
import { checkFingerprint } from "../../lib/products/smart-setup-supplier-verification.js";

const importer = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
const form = readFileSync("components/products/product-template-form.tsx", "utf8");
const fields = readFileSync("components/products/template-category-fields.tsx", "utf8");

test("new template: the pending Smart Setup brand is handed to the editor only when it differs", () => {
  assert.equal(effectiveSmartSetupBrandId(null, "editor"), "editor");           // starts from the editor's brand, no second source of truth
  assert.equal(effectiveSmartSetupBrandId("smart", "editor"), "smart");
  assert.equal(smartSetupBrandToCommit("smart", ""), "smart");                  // new template, editor had none: user need not select again
  assert.equal(smartSetupBrandToCommit("smart", "smart"), null);
  assert.equal(smartSetupBrandToCommit(null, "editor"), null);                  // closing/cancelling leaves nothing pending
  assert.equal(smartSetupBrandToCommit("", "editor"), null);
});

test("existing template: saved brand is the start; changing away needs explicit confirmation", () => {
  assert.equal(effectiveSmartSetupBrandId(null, "saved"), "saved");
  assert.equal(smartSetupBrandChangeNeedsConfirmation("saved", "other"), true);
  assert.equal(smartSetupBrandChangeNeedsConfirmation("saved", "saved"), false);
  assert.equal(smartSetupBrandChangeNeedsConfirmation(undefined, "other"), false); // new template: nothing saved to protect
  assert.match(importer, /smartSetupBrandChangeNeedsConfirmation\(savedBrandId, next\) && !window\.confirm\(/);
});

test("a JSON manufacturer name is only a hint and never selects a brand", () => {
  assert.equal(jsonManufacturerHint("Interstuhl", ""), "Interstuhl");
  assert.equal(jsonManufacturerHint("interstuhl", "Interstuhl"), null);
  assert.equal(jsonManufacturerHint(null, "X"), null);
  assert.doesNotMatch(importer, /setPendingBrandId\([^)]*supplierName/);
});

test("changing the brand changes the supplier check identity, so earlier results become stale", () => {
  const draft = { pricing: {}, optionGroups: [], defaultCurrency: "EUR" } as never;
  const fp = (brandId: string) => checkFingerprint({ draft, routingPlan: null, brandId, definitionId: "", versionId: "" });
  assert.notEqual(fp("b1"), fp("b2"));
  // The verification section is remounted per brand: selected source and results cannot leak across brands.
  assert.match(importer, /<SmartSetupSupplierVerification key=\{brandId\} draft=\{reviewedDraft\} routingPlan=\{routingPlan\} brandId=\{brandId\}/);
});

test("wiring: one editor-owned brand state, selector in the header beside Currency, commit only on Apply", () => {
  assert.equal((form.match(/onBrandChange=\{setSelectedBrandId\}/g) ?? []).length, 4); // category fields + 3 Smart Setup entries
  assert.equal((form.match(/savedBrandId=\{template\?\.brand_id\}/g) ?? []).length, 3);
  assert.equal((form.match(/useState\([^)]*brand_id/g) ?? []).length, 1);
  assert.ok(importer.indexOf("Imported pricing currency") < importer.indexOf('aria-label="Manufacturer / Brand"'));
  assert.match(importer, /const clearReview = \(\) => \{ setOpen\(false\); setPendingBrandId\(null\);/);       // close/cancel discards the pending brand
  assert.match(importer, /else \{ commitBrand\(\);[^}]*transferAndClearImages/);                                  // Apply (not conflicts) commits
  assert.match(importer, /onRequestApply\?\.\([^;]*true[^;]*\); commitBrand\(\); \}/);                             // confirmed Apply commits
  assert.equal((importer.match(/setPendingBrandId\(/g) ?? []).length, 2);                                        // chooseBrand + clear; Add More never resets it
  assert.doesNotMatch(importer.slice(importer.indexOf("const chooseBrand"), importer.indexOf("const labels =")), /setReviewedDraft|setRoutingPlan/); // reviewed prices untouched
});

test("the editor's category fields follow an externally changed brand and drop the old brand's categories", () => {
  assert.match(fields, /defaultBrandId !== undefined && defaultBrandId !== selectedBrandId\) \{ setSelectedBrandId\(defaultBrandId\); setSelectedMainCategoryId\(""\); setSelectedSubCategoryId\(""\);/);
});

test("Apply does not save the template", () => {
  const apply = importer.slice(importer.indexOf("const requestApply"), importer.indexOf("const routingValidation"));
  assert.doesNotMatch(apply, /fetch\(|createClient|\.insert\(|\.update\(|\.rpc\(|requestSubmit/);
});
