import assert from "node:assert/strict";
import test from "node:test";
import { hasMeaningfulBaseModelPricing } from "./base-model-pricing-state.js";

test("base/model replacement data preserves price semantics and meaningful rows", () => {
  assert.equal(hasMeaningfulBaseModelPricing([]), false);
  assert.equal(hasMeaningfulBaseModelPricing([{ price: null }]), false);
  const rows = [{ variant_name: "Model A", display_name: "Model A", supplier_price_list_code: "A-01", dimension: "140 x 70", price: 0, specification: "Test" }];
  assert.equal(rows[0].price, 0);
  assert.equal(hasMeaningfulBaseModelPricing(rows), true);
});
