import assert from "node:assert/strict";
import test from "node:test";
import { explicitCategoryPriceValue, explicitPricingCategoryLabels, manualDefaultPriceCategories } from "./pricing-category-columns.js";

const categories = ["Customer Material", "Fabric Cat. B-C", "Fabric Cat. D-E", "Fabric Cat. F-G", "Fabric Cat. H", "Leather Cat. Super", "Fabric Cat. I", "Leather Cat. Extra", "Leather Cat. Lusso"];
const prices = { "Customer Material": 7332, "Fabric Cat. B-C": 7648, "Fabric Cat. D-E": 8281, "Fabric Cat. F-G": 8912, "Fabric Cat. H": 9546, "Leather Cat. Super": 9620, "Fabric Cat. I": 10789, "Leather Cat. Extra": 10789, "Leather Cat. Lusso": 12348 };

test("explicit modular category labels preserve source order and equal-price columns independently", () => {
  assert.deepEqual(explicitPricingCategoryLabels(categories), categories);
  assert.equal(explicitCategoryPriceValue(prices, "Fabric Cat. I"), 10789);
  assert.equal(explicitCategoryPriceValue(prices, "Leather Cat. Extra"), 10789);
  assert.equal(explicitPricingCategoryLabels(categories).includes("Cat A"), false);
});

test("manual defaults and legacy row keys remain supported", () => {
  assert.deepEqual(manualDefaultPriceCategories, ["Cat A", "Cat B", "Cat C", "Cat D"]);
  assert.equal(explicitCategoryPriceValue({ "Cat B": 20, "Cat C": null }, "Cat B"), 20);
  assert.equal(explicitCategoryPriceValue({ "Cat B": 20, "Cat C": null }, "Cat C"), null);
});
