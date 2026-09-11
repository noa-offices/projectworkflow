import assert from "node:assert/strict";
import test from "node:test";
import { cropForZoom, existingSourceCropTargets, normalizeSourceCrop, selectedSourceCropTargets, sourceCropSearchPages, uniqueSourceCropTarget, validSourceCrop, type SourceCropTarget } from "./source-qa-crop.js";
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
