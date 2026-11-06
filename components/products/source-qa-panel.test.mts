import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { productTemplateFormSmartWorkspace } from "../../lib/products/product-template-form-smart-workspace.js";
import { reviewedRowImageKey } from "../../lib/products/smart-product-row-images.js";

// The real action needs server credentials; rendering the crop UI must never call it.
mock.module("@/app/products/templates/source-qa-actions", { namedExports: { runSourceQaAi: async () => { throw new Error("Source QA must not run while rendering"); } } });
const { SourceQaPanel, sourceQaAiDisplaySeverity, sourceQaAiIssueDetails, sourceQaAiIssueGroups, sourceQaAiIssueLabel, sourceQaAiSummary } = await import("./source-qa-panel.js");
const { SmartSetupCropAvailableContext, SmartSetupSavedPicturesContext, StagedPricingRowReferenceImage } = await import("./staged-pricing-row-reference-image.js");
const workspace = productTemplateFormSmartWorkspace({ desking_size_pricing: "[]", variant_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]", currency: "EUR" });

test("edit mode renders local PDF cropping and its paste guidance without Source QA", () => {
  const html = renderToStaticMarkup(createElement(SourceQaPanel, { draft: workspace.draft, originalImportedJsonSources: [], images: {}, editMode: true, onImageChange() {} }));
  for (const text of ["PDF Crop", "Choose PDF", "Crop Images", "Choose the price list PDF to crop pictures onto rows. The PDF is not uploaded.", "Rows without a Crop link can still be filled by pasting an image (Ctrl+V)."] ) assert.ok(html.includes(text), text);
  for (const text of ["Source QA", "Run Source QA", "Missing from supplied pages", "Referenced pages not supplied", "compare JSON"]) assert.ok(!html.includes(text), text);
});

test("add mode retains Source QA and has no edit-only guidance", () => {
  const html = renderToStaticMarkup(createElement(SourceQaPanel, { draft: workspace.draft, originalImportedJsonSources: [], images: {}, onImageChange() {} }));
  assert.ok(html.includes("Source QA (optional)"));
  assert.ok(html.includes("Run Source QA"));
  assert.ok(!html.includes("Rows without a Crop link"));
});

test("only eligible edit targets get a Crop link after a local PDF is ready; paste stays available", () => {
  const targets = new Set([reviewedRowImageKey("matrix:buddy", "220B"), reviewedRowImageKey("modular:chair", "m1"), reviewedRowImageKey("subgroup:matrix:buddy", "mesh")]);
  const render = (available: boolean | ReadonlySet<string>, sourceKey: string, rowId: string) => renderToStaticMarkup(createElement(SmartSetupCropAvailableContext.Provider, { value: available }, createElement(StagedPricingRowReferenceImage, { sourceKey, rowId, image: null, onChange() {} })));
  assert.ok(!render(false, "matrix:buddy", "220B").includes("Crop from PDF"));
  for (const [sourceKey, rowId] of [["matrix:buddy", "220B"], ["modular:chair", "m1"], ["subgroup:matrix:buddy", "mesh"]]) assert.ok(render(targets, sourceKey, rowId).includes("Crop from PDF"));
  for (const sourceKey of ["workstation:rows", "modular:direct", "base_model:rows", "option:kit"]) {
    const html = render(targets, sourceKey, "unsupported");
    assert.ok(!html.includes("Crop from PDF"));
    assert.ok(html.includes("Ctrl+V"));
  }
  assert.ok(render(true, "base_model:rows", "a1").includes("Crop from PDF"), "add-mode availability is unchanged");
});

test("a saved matrix picture supports replacement and returns when the staged crop is removed", () => {
  const saved = { "finish_category\u0000buddy\u0000220B": { id: "picture", pricingType: "finish_category" as const, groupId: "buddy", rowId: "220B", previewUrl: "https://saved.example/chair.webp", caption: null } };
  const staged = { file: new File(["crop"], "source-p1.webp", { type: "image/webp" }), previewUrl: "blob:crop", sourceKey: "matrix:buddy", sourceRowId: "220B" };
  const render = (image: typeof staged | null) => renderToStaticMarkup(createElement(SmartSetupSavedPicturesContext.Provider, { value: saved }, createElement(StagedPricingRowReferenceImage, { sourceKey: "matrix:buddy", rowId: "220B", image, onChange() {} })));
  assert.ok(render(null).includes('alt="Saved row reference"'));
  assert.ok(render(null).includes("Paste to replace"));
  assert.ok(render(staged).includes('alt="Pending row reference"'));
  assert.ok(render(null).includes('src="https://saved.example/chair.webp"'));
  assert.equal(saved["finish_category\u0000buddy\u0000220B"].previewUrl, "https://saved.example/chair.webp");
});

const issue = { id: "issue", type: "price_value_mismatch" as const, severity: "critical" as const, confidence: "high" as const, supplierModelCode: "9MU201", sourcePage: 1, sourceEvidence: "Fabric Cat. D-E 5800", sourceValue: 5800, jsonLocation: "pricing.priceMatrices[0].rows[0]", jsonValue: 5700, explanation: "Price differs." };

test("returns all present Source QA AI issue evidence fields", () => {
  assert.deepEqual(sourceQaAiIssueDetails(issue), [["Code", "9MU201"], ["Page", 1], ["Source", "Fabric Cat. D-E 5800"], ["Source value", 5800], ["JSON value", 5700], ["JSON location", "pricing.priceMatrices[0].rows[0]"]]);
});

test("omits null optional Source QA AI issue evidence fields safely", () => {
  assert.deepEqual(sourceQaAiIssueDetails({ ...issue, supplierModelCode: null, sourcePage: null, sourceEvidence: null, sourceValue: null, jsonLocation: null, jsonValue: null }), []);
});

test("groups related issues, retains unrelated rows, and deduplicates display rows without mutation", () => {
  const issues = [issue, { ...issue, id: "code", type: "supplier_model_code_mismatch" as const }, { ...issue, id: "other", supplierModelCode: "9MU202" }, { ...issue, id: "duplicate" }];
  const before = structuredClone(issues);
  const groups = sourceQaAiIssueGroups(issues);
  assert.equal(groups.length, 2); assert.equal(groups[0].issues.length, 2); assert.deepEqual(issues, before);
});

test("uses safe fallback grouping, readable labels, and severity summary", () => {
  const uncoded = { ...issue, id: "uncoded", supplierModelCode: null, sourcePage: 3, jsonLocation: "pricing.priceMatrices[0].rows[1].prices.open", severity: "warning" as const };
  const info = { ...issue, id: "info", supplierModelCode: "9MU203", severity: "info" as const };
  const summary = sourceQaAiSummary([issue, uncoded, info]);
  assert.equal(summary.groups.length, 3); assert.equal(summary.findings, 3); assert.deepEqual(summary.counts, { critical: 1, warning: 1, info: 1 }); assert.equal(summary.status, "REVIEW REQUIRED"); assert.equal(sourceQaAiIssueLabel(uncoded), "Price mismatch");
});

test("keeps equal-value price findings visible as review items and sorts findings", () => {
  const equal = { ...issue, id: "equal", sourceValue: 6430, jsonValue: 6430, explanation: "Row binding needs review." };
  const code = { ...issue, id: "code", type: "supplier_model_code_mismatch" as const };
  const category = { ...issue, id: "category", type: "row_binding_mismatch" as const };
  const before = structuredClone([equal, code, category]); const groups = sourceQaAiIssueGroups([equal, category, code]);
  assert.equal(sourceQaAiIssueLabel(equal), "Row/code binding issue"); assert.deepEqual(groups[0].issues.map((entry) => entry.id), ["code", "category", "equal"]); assert.deepEqual([equal, code, category], before);
});

test("renders equal-value review items neutrally without changing their report severity", () => {
  const review = { ...issue, id: "review", sourceValue: 6430, jsonValue: 6430, explanation: "Formatting only." };
  const before = structuredClone(review); const summary = sourceQaAiSummary([review]);
  assert.equal(sourceQaAiIssueLabel(review), "Review item"); assert.equal(sourceQaAiDisplaySeverity(review), "review"); assert.deepEqual(summary.counts, { critical: 0, warning: 0, info: 0 }); assert.equal(review.severity, "critical"); assert.deepEqual(review, before);
  assert.equal(sourceQaAiDisplaySeverity(issue), "critical");
});
