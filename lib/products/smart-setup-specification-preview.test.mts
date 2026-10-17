import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { smartSetupSpecificationPreview } from "./smart-setup-specification-preview.js";

test("empty or missing specification yields no preview", () => {
  assert.equal(smartSetupSpecificationPreview(null), null);
  assert.equal(smartSetupSpecificationPreview("   "), null);
});

test("existing specification is shown as one line, unchanged apart from display collapsing", () => {
  assert.equal(smartSetupSpecificationPreview("Melamine top, 25mm\nSteel legs"), "Melamine top, 25mm · Steel legs");
});

test("product name and dimensions already shown in other columns are left out of the preview only", () => {
  const spec = "Executive Desk W210 - Without Hole. W 210 x D 105 x H 76 cm. Melamine top";
  assert.equal(smartSetupSpecificationPreview(spec, ["Executive Desk W210 - Without Hole", "W 210 x D 105 x H 76 cm"]), "Melamine top");
  // A specification that only repeats the name/dimensions has nothing new to preview.
  assert.equal(smartSetupSpecificationPreview("W 210 x D 105 x H 76 cm", ["W 210 x D 105 x H 76 cm"]), null);
  // The caller's original string is never mutated.
  assert.ok(spec.includes("Executive Desk"));
});

test("short or empty hide fragments do not eat specification text", () => {
  assert.equal(smartSetupSpecificationPreview("Oak veneer", ["", "a", null, undefined]), "Oak veneer");
});

test("every Smart Setup table renders the single-line preview without changing row layout elements", () => {
  const source = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
  assert.equal(source.split("<SpecificationPreviewCell row={row} />").length - 1, 4, "dense, matrix, direct modular and accessory category tables");
  assert.ok(source.includes("truncate whitespace-nowrap") && source.includes("max-w-0 overflow-hidden"));
  assert.equal(source.includes("line-clamp-2\">{row.specification"), false, "no multi-line specification previews remain");
  // Details colSpans cover the added column.
  assert.ok(source.includes("matrix.columns.length + 3") && source.includes("colSpan={8}") && source.includes("priceCategories.length + 5"));
  // Full specification remains editable in Edit / Details.
  assert.ok(source.split('label="Product Specification"').length > 4);
});
