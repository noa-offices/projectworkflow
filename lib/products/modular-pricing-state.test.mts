import assert from "node:assert/strict";
import test from "node:test";
import { hasMeaningfulModularPricing } from "./modular-pricing-state.js";

test("modular replacement data preserves grouped nullable matrices and detects meaningful state", () => {
  assert.equal(hasMeaningfulModularPricing([{ group_name: "Modular Items", items: [] }], ["Cat A", "Cat B"]), false);

  const groups = [
    {
      group_name: "Pouf Rectangular",
      items: [{ variant_name: "Module A", supplier_price_list_code: "RECT-A", dimension: "90 cm", specification: "Seat", prices: { "Cat A": null, "Cat B": 0 } }],
    },
    {
      group_name: "Pouf Round",
      items: [{ variant_name: "Module B", supplier_price_list_code: "ROUND-B", dimension: "80 cm", specification: "Corner", prices: { "Cat A": 355, "Cat B": null } }],
    },
  ];

  assert.equal(groups.length, 2);
  assert.equal(groups[0].items[0].prices["Cat A"], null);
  assert.equal(groups[0].items[0].prices["Cat B"], 0);
  assert.equal(groups[1].items[0].prices["Cat A"], 355);
  assert.equal(hasMeaningfulModularPricing(groups, ["Cat A", "Cat B"]), true);
  assert.equal(hasMeaningfulModularPricing([{ group_name: "Modular Items", items: [] }], ["Cat A", "Custom"]), true);
});
