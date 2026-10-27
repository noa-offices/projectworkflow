import assert from "node:assert/strict";
import test from "node:test";
import { defaultProductAccessoryQuantities } from "./product-accessory-configuration";

test("saved option defaults preselect active quotation items once", () => {
  const groups = [
    { id: "colours", default_item_ids: ["black", "missing"], items: [{ id: "black", item_name: "Black", is_active: true }, { id: "missing", is_active: false }] },
    { id: "extras", default_item_ids: ["feet"], items: [{ id: "feet", item_name: "Feet" }] },
    { id: "inactive", is_active: false, default_item_ids: ["old"], items: [{ id: "old" }] },
  ];
  assert.deepEqual(defaultProductAccessoryQuantities(groups), { black: 1, feet: 1 });
});
