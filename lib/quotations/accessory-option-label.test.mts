import assert from "node:assert/strict";
import test from "node:test";
import { accessoryOptionLabel } from "./accessory-option-label.js";

test("accessory selector label includes a distinct code", () => assert.equal(accessoryOptionLabel({ item_name: "Standard Modesty Panel", supplier_price_list_code: "1AF 044" }, "EUR 154.00"), "1AF 044 — Standard Modesty Panel — EUR 154.00"));
test("accessory selector label deduplicates a code-only name", () => assert.equal(accessoryOptionLabel({ item_name: "1AF 090", supplier_price_list_code: "1AF 090" }, "EUR 1,042.00"), "1AF 090 — EUR 1,042.00"));
test("accessory selector label keeps name and price without a code", () => assert.equal(accessoryOptionLabel({ item_name: "Standard Modesty Panel" }, "EUR 154.00"), "Standard Modesty Panel — EUR 154.00"));
