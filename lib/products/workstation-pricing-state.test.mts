import assert from "node:assert/strict";
import test from "node:test";
import { hasMeaningfulWorkstationPricing } from "./workstation-pricing-state.js";

test("workstation replacement values preserve null and zero while detecting meaningful rows", () => {
  assert.equal(hasMeaningfulWorkstationPricing([]), false);
  assert.equal(hasMeaningfulWorkstationPricing([{ default_price: null, additional_price: null }]), false);
  const rows = [{ label: "Bench", default_price: null, additional_price: 0, base_supplier_price_list_code: "B-01" }];
  assert.equal(rows[0].default_price, null);
  assert.equal(rows[0].additional_price, 0);
  assert.equal(hasMeaningfulWorkstationPricing(rows), true);
});
