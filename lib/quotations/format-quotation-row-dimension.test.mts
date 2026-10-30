import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node runs this focused test with native TypeScript stripping.
import { specificationWithoutDuplicateDimension } from "./format-quotation-row.ts";

test("suppresses only an exact trailing overall dimension", () => {
  assert.equal(specificationWithoutDuplicateDimension("Seat height: 40-50 cm\nDimension: 120 x 60 cm", "120 x 60 cm"), "Seat height: 40-50 cm");
  assert.equal(specificationWithoutDuplicateDimension("Panel thickness: 18 mm\nDimension: 120 x 70 cm", "120 x 60 cm"), "Panel thickness: 18 mm\nDimension: 120 x 70 cm");
  assert.equal(specificationWithoutDuplicateDimension("Dimension: 120 x 60 cm\nOther detail", "120 x 60 cm"), "Dimension: 120 x 60 cm\nOther detail");
  assert.equal(specificationWithoutDuplicateDimension("Dimension: 120 x 60 cm", null), "Dimension: 120 x 60 cm");
});
