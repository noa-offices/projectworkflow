import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft, ProductTemplateDraftPricedRow } from "./product-template-draft.js";
import {
  applyBatchSpecificationSuggestions,
  batchSpecificationChunks,
  batchSpecificationFingerprint,
  flattenBatchSpecificationTargets,
  prepareBatchSpecificationEnrichment,
  processSpecificationBatchesSequentially,
  summarizeBatchSpecificationSuggestions,
} from "./specification-enrichment-batch.js";

const priced = (id: string, code: string): ProductTemplateDraftPricedRow => ({ id, label: id, displayName: id, dimensions: null, currency: "AED", price: 10, specification: `Current ${id}`, supplierCodes: [code], referenceCodes: [] });
const draft: ProductTemplateDraft = {
  version: 1,
  template: { templateName: "Range", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: "Excluded", origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
  defaultCurrency: "AED",
  pricing: {
    baseModelRows: [priced("base", "BASE")],
    workstationRows: [{ ...priced("work", "WORK"), additionalPrice: null, layoutType: null }],
    priceMatrices: [{ id: "matrix", label: "Matrix", columns: [{ id: "cat", label: "Cat" }], rows: [{ ...priced("matrix-row", "MATRIX"), prices: { cat: 10 }, unavailableCategoryIds: [] }] }],
    modularGroups: [{ id: "module", label: "Module", defaultDimensions: null, defaultSpecification: "Excluded", matrix: { id: "module-matrix", label: "Module", columns: [{ id: "cat", label: "Cat" }], rows: [{ ...priced("module-row", "MODULE"), prices: { cat: 10 }, unavailableCategoryIds: [] }] } }],
  },
  optionGroups: [{ id: "options", label: "Options", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("option-row", "OPTION")] }],
  materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
};

test("flattens all five structures with unique composite target IDs", () => {
  const targets = flattenBatchSpecificationTargets(draft);
  assert.deepEqual(targets.map((item) => item.targetId), ["baseModel:base", "workstation:work", "matrix:matrix:matrix-row", "modular:module:module-row", "option:options:option-row"]);
  assert.equal(new Set(targets.map((item) => item.targetId)).size, 5);
});

test("plans stable batches of at most six in order", () => {
  const values = Array.from({ length: 14 }, (_, index) => index);
  assert.deepEqual(batchSpecificationChunks(values), [[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11], [12, 13]]);
});

test("processes planned batches sequentially in order", async () => {
  const calls: number[] = [];
  let active = 0;
  let maximumActive = 0;
  await processSpecificationBatchesSequentially([[1], [2], [3]], async ([value]) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    calls.push(value);
    active -= 1;
  });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(maximumActive, 1);
});

test("skips no-context targets before provider payload planning", () => {
  const sources = [{ id: "source", rawJson: JSON.stringify({ rows: ["BASE", "WORK", "MATRIX", "MODULE"].map((code) => ({ code })) }) }];
  const prepared = prepareBatchSpecificationEnrichment(flattenBatchSpecificationTargets(draft), sources);
  assert.equal(prepared.eligible.length, 4);
  assert.deepEqual(prepared.skippedTargetIds, ["option:options:option-row"]);
});

test("apply all changes only matching specification fields and never mutates input", () => {
  const before = structuredClone(draft);
  const next = applyBatchSpecificationSuggestions(draft, [{ targetId: "baseModel:base", specificationSuggestion: "Improved base" }, { targetId: "matrix:matrix:matrix-row", specificationSuggestion: "Improved matrix" }]);
  assert.deepEqual(draft, before);
  assert.equal(next.pricing.baseModelRows[0].specification, "Improved base");
  assert.equal(next.pricing.priceMatrices[0].rows[0].specification, "Improved matrix");
  assert.equal(next.pricing.baseModelRows[0].price, draft.pricing.baseModelRows[0].price);
  assert.deepEqual(next.pricing.baseModelRows[0].supplierCodes, draft.pricing.baseModelRows[0].supplierCodes);
  assert.deepEqual(applyBatchSpecificationSuggestions(draft, []), draft);
});

test("null is unchanged, skipped is separate, and input changes stale the fingerprint", () => {
  const targets = flattenBatchSpecificationTargets(draft);
  assert.deepEqual(summarizeBatchSpecificationSuggestions(targets, [{ targetId: "baseModel:base", specificationSuggestion: null }], ["option:options:option-row"]), { changed: 0, unchanged: 1, skipped: 1, changedItems: [] });
  const sources = [{ id: "source", rawJson: "{}" }];
  const fingerprint = batchSpecificationFingerprint(draft, sources);
  assert.notEqual(fingerprint, batchSpecificationFingerprint({ ...draft, pricing: { ...draft.pricing, baseModelRows: [{ ...draft.pricing.baseModelRows[0], specification: "Edited" }] } }, sources));
  assert.notEqual(fingerprint, batchSpecificationFingerprint(draft, [{ id: "source", rawJson: "{ }" }]));
});
