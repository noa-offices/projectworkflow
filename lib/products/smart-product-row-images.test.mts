import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft, ProductTemplateDraftPriceMatrix } from "./product-template-draft.js";
import { clipboardImageFile } from "./product-template-row-image-client.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";
import { baseModelSubgroupsForSmartSetupApply, disposeStagedReviewedRowImages, pendingRowImagesForSmartSetupApply, pendingSubgroupImagesForSmartSetupApply, reviewedRowImageKey, reviewedSubgroupImageKey, updateStagedReviewedRowImage, uploadPendingRowImagesAfterSave, type SmartReviewedPricingSubgroups, type StagedReviewedRowImage } from "./smart-product-row-images.js";

const pricedRow = (id: string) => ({ id, label: id, displayName: id, dimensions: null, currency: "EUR" as const, price: 10, specification: null, supplierCodes: [id], referenceCodes: [] });
const matrix = (id: string, columns = [{ id: "price", label: "Price" }]): ProductTemplateDraftPriceMatrix => ({ id, label: id, columns, rows: [{ ...pricedRow(`${id}-row`), prices: Object.fromEntries(columns.map((column) => [column.id, 10])) }] });
const draft: ProductTemplateDraft = {
  version: 1,
  template: { templateName: "Images", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
  defaultCurrency: "EUR",
  pricing: { workstationRows: [{ ...pricedRow("work-row"), additionalPrice: null, layoutType: null }], baseModelRows: [pricedRow("base-row")], priceMatrices: [matrix("matrix")], modularGroups: [{ id: "modules", label: "Modules", defaultDimensions: null, defaultSpecification: null, matrix: matrix("module-matrix") }], },
  optionGroups: [{ id: "options", label: "Options", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [pricedRow("option-row")] }],
  materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
};
const image = (sourceKey: string, rowId: string, previewUrl: string): StagedReviewedRowImage<string> => ({ file: `file:${rowId}`, previewUrl, sourceKey, sourceRowId: rowId });

test("staged placeholders isolate multiple rows and replace/remove only their target", () => {
  const revoked: string[] = [];
  let state = updateStagedReviewedRowImage({}, "base_model:rows", "base-row", image("base_model:rows", "base-row", "blob:1"), revoked.push.bind(revoked));
  state = updateStagedReviewedRowImage(state, "workstation:rows", "work-row", image("workstation:rows", "work-row", "blob:2"), revoked.push.bind(revoked));
  state = updateStagedReviewedRowImage(state, "base_model:rows", "base-row", image("base_model:rows", "base-row", "blob:3"), revoked.push.bind(revoked));
  assert.deepEqual(revoked, ["blob:1"]); assert.equal(Object.keys(state).length, 2); assert.equal(state[reviewedRowImageKey("workstation:rows", "work-row")].previewUrl, "blob:2");
  state = updateStagedReviewedRowImage(state, "base_model:rows", "base-row", null, revoked.push.bind(revoked));
  assert.deepEqual(revoked, ["blob:1", "blob:3"]); assert.equal(Object.keys(state).length, 1);
  disposeStagedReviewedRowImages(state, revoked.push.bind(revoked)); assert.deepEqual(revoked, ["blob:1", "blob:3", "blob:2"]);
});

test("non-image clipboard content is rejected before compression", () => {
  assert.equal(clipboardImageFile([{ type: "text/plain" } as File]), null);
  assert.equal(clipboardImageFile([{ type: "text/plain" } as File, { type: "image/png" } as File])?.type, "image/png");
});

test("staged images survive edits and follow stable rows through supported routing", () => {
  const plan = createSmartSetupReviewRouting(draft);
  const matrixRoute = plan.routes.find((route) => route.sourceId === "matrix")!; matrixRoute.destination = "base_model";
  const staged = {
    [reviewedRowImageKey("workstation:rows", "work-row")]: image("workstation:rows", "work-row", "blob:w"),
    [reviewedRowImageKey("base_model:rows", "base-row")]: image("base_model:rows", "base-row", "blob:b"),
    [reviewedRowImageKey("matrix:matrix", "matrix-row")]: image("matrix:matrix", "matrix-row", "blob:m"),
    [reviewedRowImageKey("modular:modules", "module-matrix-row")]: image("modular:modules", "module-matrix-row", "blob:mod"),
    [reviewedRowImageKey("option:options", "option-row")]: image("option:options", "option-row", "blob:o"),
  };
  const edited = { ...draft, template: { ...draft.template, description: "ordinary edit" } };
  const pending = pendingRowImagesForSmartSetupApply(edited, plan, staged);
  assert.deepEqual(pending.map((entry) => `${entry.pricingType}:${entry.rowId}`).sort(), ["accessory:option-row", "base_model:base-row", "base_model:matrix-row", "modular:module-matrix-row", "workstation:work-row"]);
  matrixRoute.destination = "skip";
  assert.equal(pendingRowImagesForSmartSetupApply(draft, plan, staged).some((entry) => entry.rowId === "matrix-row"), false);
  assert.equal(JSON.stringify(draft).includes("blob:"), false);
});

test("reviewed subgroups and their staged diagram follow Base/Model routing only", () => {
  const plan = createSmartSetupReviewRouting(draft);
  const route = plan.routes.find((item) => item.sourceKind === "base_model")!;
  const reviewed: SmartReviewedPricingSubgroups = {
    [route.key]: [{ id: "service", subgroup_name: "Desk for Service Unit", sort_order: 0, is_active: true, row_ids: ["base-row", "missing", "base-row"] }],
  };
  const staged = { [reviewedSubgroupImageKey(route.key, "service")]: image(`subgroup:${route.key}`, "service", "blob:subgroup") };
  assert.deepEqual(baseModelSubgroupsForSmartSetupApply(draft, plan, reviewed)[0].subgroups[0].row_ids, ["base-row"]);
  assert.deepEqual(pendingSubgroupImagesForSmartSetupApply(draft, plan, reviewed, staged).map((entry) => `${entry.pricingType}:${entry.subgroupId}`), ["base_model:service"]);
  route.destination = "skip";
  assert.deepEqual(baseModelSubgroupsForSmartSetupApply(draft, plan, reviewed), []);
  assert.deepEqual(pendingSubgroupImagesForSmartSetupApply(draft, plan, reviewed, staged), []);
});

test("final upload waits for template success and isolates partial failures", async () => {
  const entries = ["one", "missing", "two"];
  const uploaded: string[] = [];
  assert.deepEqual(await uploadPendingRowImagesAfterSave({ entries, templateSaved: false, resolveIdentity: (entry) => entry, upload: async (entry) => { uploaded.push(entry); } }), { attempted: 0, failed: 0 });
  assert.equal(uploaded.length, 0);
  const result = await uploadPendingRowImagesAfterSave<string, { rowId: string }>({ entries, templateSaved: true, resolveIdentity: (entry) => entry === "missing" ? null : { rowId: entry }, upload: async (entry) => { uploaded.push(entry); if (entry === "two") throw new Error("failed"); } });
  assert.deepEqual(result, { attempted: 2, failed: 1 }); assert.deepEqual(uploaded, ["one", "two"]);
});
