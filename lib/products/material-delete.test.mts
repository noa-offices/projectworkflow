import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkMaterialIds, materialDeleteSummary, materialPictureAction, materialPicturePath, type MaterialDeleteResult } from "./material-delete";
test("chunks unique ids at 100", () => {
  const ids = Array.from({ length: 201 }, (_, i) => String(i));
  assert.deepEqual(chunkMaterialIds([...ids, "0"]).map((chunk) => chunk.length), [100, 100, 1]);
  assert.deepEqual(chunkMaterialIds(ids).flat(), ids);
  assert.deepEqual(chunkMaterialIds([]), []);
});
test("pictures are removed only for deleted rows with unshared paths", () => {
  assert.equal(materialPictureAction({ status: "in_use", imagePath: "path", pictureInUse: false }), "none");
  assert.equal(materialPictureAction({ status: "deleted", imagePath: null, pictureInUse: false }), "none");
  assert.equal(materialPictureAction({ status: "deleted", imagePath: "path", pictureInUse: true }), "keep");
  assert.equal(materialPictureAction({ status: "deleted", imagePath: "path", pictureInUse: false }), "remove");
  assert.equal(materialPicturePath("product-images:brand-materials/b/g/a.webp"), "brand-materials/b/g/a.webp");
  for (const path of ["quote-images:x", "https://example.com/a", "brand-materials/b/g/../a", "brand-materials/b/g/%2e%2e/a"]) assert.equal(materialPicturePath(path), null);
});
test("summary separates deleted rows, blocked rows and picture outcomes", () => {
  const rows: MaterialDeleteResult[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i), status: "deleted", ...(i < 3 ? { pictureKept: true } : i === 3 ? { pictureRemoved: false } : {}) }));
  rows.push({ id: "a", status: "in_use" }, { id: "b", status: "in_use" });
  assert.equal(materialDeleteSummary(rows), "Deleted 12. Skipped 2 (in use). 3 pictures kept. 1 picture could not be removed.");
});
