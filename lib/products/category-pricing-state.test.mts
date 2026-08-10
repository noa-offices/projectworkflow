import assert from "node:assert/strict";
import test from "node:test";
import { hasMeaningfulCategoryPricing } from "./category-pricing-state.js";

test("category replacement data keeps null/zero cells and detects meaningful matrices", () => {
  assert.equal(hasMeaningfulCategoryPricing([{ group_name: "Finish Category Pricing", price_categories: [], items: [] }]), false);
  assert.equal(hasMeaningfulCategoryPricing([{ group_name: "Finish Category Pricing", price_categories: ["Cat A", "Cat B"], items: [] }]), false);
  const groups = [{ group_name: "Fabric", price_categories: ["Cat A", "Cat B"], items: [{ variant_name: "Seat", supplier_price_list_code: "S-01", dimension: "60 cm", specification: "Test", prices: { "Cat A": null, "Cat B": 0 } }] }];
  assert.equal(groups[0].items[0].prices["Cat A"], null);
  assert.equal(groups[0].items[0].prices["Cat B"], 0);
  assert.equal(hasMeaningfulCategoryPricing(groups), true);
});
