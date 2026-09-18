import assert from "node:assert/strict";
import test from "node:test";
import { cropForZoom, existingSourceCropTargets, exportRenderScale, fitWidthZoom, mergeSourceCropTargetIds, nextSourceCropTarget, normalizeSourceCrop, removeSourceCropTargetIds, selectedSourceCropTargets, sourceCropSearchPages, sourceQaTextGeometry, sourceQaTextGeometryMatch, sourceQaTextGeometryViewport, uniqueSourceCropTarget, validSourceCrop, type SourceCropTarget } from "./source-qa-crop.js";
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
