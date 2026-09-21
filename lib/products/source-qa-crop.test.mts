import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";
import { pendingRowImagesForSmartSetupApply, reviewedRowImageKey } from "./smart-product-row-images.js";
import { cropForZoom, existingSourceCropTargets, exportRenderScale, fitWidthZoom, mergeSourceCropTargetIds, nextSourceCropTarget, normalizeSourceCrop, removeSourceCropTargetIds, selectedSourceCropTargets, sourceCropSearchPages, sourceCropTargets, sourceQaTextGeometry, sourceQaTextGeometryMatch, sourceQaTextGeometryViewport, uniqueSourceCropTarget, validSourceCrop, type SourceCropTarget } from "./source-qa-crop.js";
const targets: SourceCropTarget[] = [
  { id: "one", sourceKey: "base_model:rows", rowId: "one", label: "IN120 — Table", codes: ["IN120"], kind: "Base / Model" },
  { id: "two", sourceKey: "base_model:rows", rowId: "two", label: "IN120E — Electrified", codes: ["IN120E"], kind: "Base / Model" },
  { id: "three", sourceKey: "matrix:rows", rowId: "three", label: "IN122 — Table", codes: ["IN122"], kind: "Category / Matrix" },
];
test("normalizes and validates source crop coordinates independently of zoom", () => { const crop = normalizeSourceCrop({ x: 100, y: 90, width: -40, height: -20 }); assert.deepEqual(crop, { x: 60, y: 70, width: 40, height: 20 }); assert.deepEqual(cropForZoom(crop, 2), { x: 120, y: 140, width: 80, height: 40 }); assert.equal(validSourceCrop(crop), true); assert.equal(validSourceCrop({ x: 0, y: 0, width: 1, height: 20 }), false); });
test("finds normalized code matches across PDF pages", () => { const pages = [{ pageNumber: 6, text: "ART. IN120E 173   477" }, { pageNumber: 7, text: "in120e" }]; assert.deepEqual(sourceCropSearchPages(pages, "in120e"), [6, 7]); assert.deepEqual(sourceCropSearchPages(pages, "173 477"), [6]); assert.deepEqual(sourceCropSearchPages(pages, "missing"), []); });
test("selects each crop target once and detects existing images across the selection", () => {
  assert.deepEqual(selectedSourceCropTargets(targets, ["one", "two", "one", "missing"]).map((target) => target.id), ["one", "two"]);
  assert.deepEqual(existingSourceCropTargets(targets, ["one", "two", "three"], new Set(["two", "three"])).map((target) => target.id), ["two", "three"]);
  assert.equal(uniqueSourceCropTarget(targets, "in120e")?.id, "two");
});
test("finds the next missing target in visible group order before moving groups", () => {
  const ordered = [...targets, { id: "four", sourceKey: "matrix:rows", rowId: "four", label: "IN124 — Table", codes: ["IN124"], kind: "Category / Matrix" as const }];
  assert.equal(nextSourceCropTarget(ordered, "one", new Set(["two"]), ["one"])?.id, "three");
  assert.equal(nextSourceCropTarget(ordered, "three", new Set(), ["one", "two", "three"])?.id, "four");
  assert.equal(nextSourceCropTarget(ordered, "four", new Set(), ordered.map((target) => target.id)), null);
});
test("keeps normal and electrified rows independently eligible after IN122", () => {
  const infinity: SourceCropTarget[] = ["IN120", "IN120E", "IN122", "IN122E", "IN124", "IN124E"].map((code) => ({ id: code, sourceKey: "matrix:infinity", rowId: code, label: code + " — Table", codes: [code], kind: "Category / Matrix" }));
  assert.equal(nextSourceCropTarget(infinity, "IN122", new Set(["IN120", "IN120E", "IN122"]), ["IN122"])?.id, "IN122E");
  assert.equal(nextSourceCropTarget(infinity, "IN122", new Set(["IN120", "IN120E", "IN122"]), ["IN122", "IN122E"])?.id, "IN124");
  assert.equal(nextSourceCropTarget(infinity, "IN124E", new Set(["IN120", "IN120E", "IN122", "IN122E", "IN124", "IN124E"]), ["IN124E"]), null);
});
test("resolves exact and split PDF text geometry at the active viewport scale", () => {
  const geometry = sourceQaTextGeometry([{ str: "IN122", transform: [1, 0, 0, 1, 100, 400], width: 30, height: 10 }, { str: "E", transform: [1, 0, 0, 1, 130, 400], width: 8, height: 10 }]);
  const match = sourceQaTextGeometryMatch(geometry, "in122e"); assert.deepEqual(match && { x: match.x, width: match.width }, { x: 100, width: 38 });
  assert.deepEqual(sourceQaTextGeometryViewport(match!, 600, 2), { x: 200, y: 380, width: 76, height: 20 });
  assert.equal(sourceQaTextGeometryMatch(geometry, "missing"), null);
});
test("merges and clears one displayed target group without affecting other selections", () => {
  assert.deepEqual(mergeSourceCropTargetIds(["one", "three"], ["one", "two"]), ["one", "three", "two"]);
  assert.deepEqual(removeSourceCropTargetIds(["one", "two", "three"], ["one", "two"]), ["three"]);
});
test("export render scale doubles the on-screen zoom for crop export, clamped to a sane maximum", () => {
  assert.equal(exportRenderScale(1), 2);
  assert.equal(exportRenderScale(0.5), 1);
  assert.equal(exportRenderScale(2), 4);
  assert.equal(exportRenderScale(3), 4, "Must never exceed the maximum export scale even at high on-screen zoom");
  assert.equal(exportRenderScale(2.5, 2, 4), 4);
  assert.ok(exportRenderScale(1) >= 1, "Export scale must never be lower than the current on-screen zoom");
});
test("fit-width zoom matches the container to the PDF page's native width within a safe zoom range", () => {
  assert.equal(fitWidthZoom(1000, 500), 2);
  assert.equal(fitWidthZoom(500, 1000), 0.5);
  assert.equal(fitWidthZoom(0, 500), 1, "Missing measurements must fall back to 100% rather than dividing by zero");
  assert.equal(fitWidthZoom(500, 0), 1);
  assert.equal(fitWidthZoom(10000, 500), 4, "Must clamp to the maximum zoom even for a very wide container");
  assert.equal(fitWidthZoom(50, 500), 0.5, "Must clamp to the minimum zoom even for a very narrow container");
});

// ---- native Base/Model groups (route key must match the review editor / Apply image key) ----
const nativeRow = (id: string, extra: Record<string, unknown> = {}) => ({ id, displayName: "Desk D70 W120 SIGMA_Q for Comby", label: null, price: 100, currency: "AED", supplierCodes: ["1AJ " + id], referenceCodes: [], ...extra });
const nativeDraft = () => {
  const result = normalizeProductTemplateDraft({
    version: 1, template: { templateName: "T" }, defaultCurrency: "AED",
    pricing: {
      workstationRows: [],
      baseModelRows: [
        nativeRow("sys-a", { groupId: "comby-system", groupLabel: "COMBY", role: "system_base" }),
        nativeRow("a1", { groupId: "comby-system", groupLabel: "COMBY" }),
        nativeRow("a2", { groupId: "comby-system", groupLabel: "COMBY" }),
        nativeRow("b1", { groupId: "p58-system", groupLabel: "P58" }),
        nativeRow("flat-1"),
      ],
      priceMatrices: [{ id: "mx", label: "Matrix", columns: [{ id: "c", label: "C" }], rows: [{ id: "mrow", label: "m", displayName: "m", supplierCodes: ["M1"], referenceCodes: [], prices: { c: 1 } }] }],
      modularGroups: [],
    },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 1, sources: [],
  });
  assert.ok(result.draft, JSON.stringify(result.errors));
  return result.draft as ProductTemplateDraft;
};

test("crop targets: ordinary Base/Model rows keep base_model:rows; native rows use their group route key; matrix unchanged", () => {
  const found = sourceCropTargets(nativeDraft());
  const byRow = (rowId: string) => found.find((target) => target.rowId === rowId);
  assert.equal(byRow("flat-1")?.sourceKey, "base_model:rows");
  assert.equal(byRow("a1")?.sourceKey, "base_model_group:comby-system");
  assert.equal(byRow("sys-a")?.sourceKey, "base_model_group:comby-system");
  assert.equal(byRow("b1")?.sourceKey, "base_model_group:p58-system");
  assert.equal(byRow("mrow")?.sourceKey, "matrix:mx");
  assert.equal(byRow("a1")?.kind, "Base / Model");
});

test("crop image keys cannot collide across groups and match the Apply-time route key", () => {
  const draft = nativeDraft();
  const found = sourceCropTargets(draft);
  const a1 = found.find((target) => target.rowId === "a1")!;
  const b1 = found.find((target) => target.rowId === "b1")!;
  assert.notEqual(a1.sourceKey + "\u0000" + a1.rowId, b1.sourceKey + "\u0000" + b1.rowId);
  // The panel writes the crop under target.sourceKey/rowId; Apply reads route.key/rowId for the same row.
  const staged = { [reviewedRowImageKey(a1.sourceKey, a1.rowId)]: { file: {}, previewUrl: "blob:a1", sourceKey: a1.sourceKey, sourceRowId: a1.rowId } };
  const applied = pendingRowImagesForSmartSetupApply(draft, createSmartSetupReviewRouting(draft), staged);
  assert.deepEqual(applied.map((image) => [image.pricingType, image.rowId, image.previewUrl]), [["base_model", "a1", "blob:a1"]]);
  // Assigning a crop is image-state only: the reviewed row keeps its group, label, role, price, code and dimensions.
  const row = draft.pricing.baseModelRows.find((entry) => entry.id === "sys-a")!;
  assert.deepEqual([row.groupId, row.groupLabel, row.role, row.price, row.supplierCodes[0]], ["comby-system", "COMBY", "system_base", 100, "1AJ sys-a"]);
});

test("next crop target progresses through native grouped rows before moving to another source", () => {
  const found = sourceCropTargets(nativeDraft());
  const ids = (list: SourceCropTarget[]) => list.map((target) => target.id);
  assert.deepEqual(ids(found.filter((target) => target.sourceKey === "base_model_group:comby-system")), ["base:sys-a", "base:a1", "base:a2"]);
  assert.equal(nextSourceCropTarget(found, "base:a1", new Set(), [])?.id, "base:a2");
  // Use Crop & Next: assign a1, then a2 becomes next; after a2 the flow leaves the group.
  assert.equal(nextSourceCropTarget(found, "base:sys-a", new Set(), ["base:sys-a"])?.id, "base:a1");
  assert.equal(nextSourceCropTarget(found, "base:a2", new Set(), ["base:a1", "base:a2"])?.sourceKey === "base_model_group:comby-system", false);
  // an existing image on the next row makes it ineligible, so the flow skips to the following row in the same group
  assert.equal(nextSourceCropTarget(found, "base:sys-a", new Set(["base:a1"]), [])?.id, "base:a2");
});

test("existing-image conflict detection sees native group rows through their scoped image key", () => {
  const found = sourceCropTargets(nativeDraft());
  const images: Record<string, unknown> = { "base_model_group:comby-system\u0000a1": {} };
  const existing = new Set(found.filter((target) => images[target.sourceKey + "\u0000" + target.rowId]).map((target) => target.id));
  assert.deepEqual([...existing], ["base:a1"]);
  assert.deepEqual(existingSourceCropTargets(found, ["base:a1", "base:a2"], existing).map((target) => target.id), ["base:a1"]);
});
