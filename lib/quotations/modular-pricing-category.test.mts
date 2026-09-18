import assert from "node:assert/strict";
import test from "node:test";
import { resolvedMatrixModularPricingCategory } from "./modular-pricing-category.js";

const matrix = [{ id: "terra", pricing_type: "modular_group", items: [{ id: "bench", prices: { "BL / AN": 1310, Designs: 1874 } }] }];

test("Matrix Modular accepts a submitted stored category, including a real Cat A", () => {
  assert.equal(resolvedMatrixModularPricingCategory(matrix, "BL / AN"), "BL / AN");
  assert.equal(resolvedMatrixModularPricingCategory([{ ...matrix[0], items: [{ id: "bench", prices: { "Cat A": 1310 } }] }], "Cat A"), "Cat A");
});

test("Matrix Modular never invents Cat A for missing or invalid categories", () => {
  assert.equal(resolvedMatrixModularPricingCategory(matrix, null), null);
  assert.equal(resolvedMatrixModularPricingCategory(matrix, "Cat A"), null);
});
