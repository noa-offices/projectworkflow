import assert from "node:assert/strict";
import test from "node:test";
import { hasMeaningfulAccessoryPricing } from "./accessory-pricing-state.js";

test("accessory replacement data preserves grouped nullable prices and detects meaningful state", () => {
  assert.equal(hasMeaningfulAccessoryPricing([{ group_name: "Accessories", is_active: true, items: [] }]), false);

  const groups = [
    {
      group_name: "UAT Top Access",
      group_is_required: true,
      is_active: true,
      items: [{ item_name: "Top", supplier_price_list_code: "TOP-01", specification: "Walnut", price: null, is_active: true }],
    },
    {
      group_name: "UAT Pedestal",
      is_active: true,
      items: [
        { item_name: "Pedestal", supplier_price_list_code: "PED-00", specification: "Black", price: 0, is_active: true },
        { item_name: "Base", supplier_price_list_code: "BASE-221", specification: "Steel", price: 221, is_active: false },
      ],
    },
  ];

  assert.equal(groups.length, 2);
  assert.equal(groups[0].items[0].price, null);
  assert.equal(groups[1].items[0].price, 0);
  assert.equal(groups[1].items[1].price, 221);
  assert.equal(groups[0].group_is_required, true);
  assert.equal(groups[1].items[1].is_active, false);
  assert.equal(hasMeaningfulAccessoryPricing(groups), true);
});
