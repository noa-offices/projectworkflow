import assert from "node:assert/strict";
import test from "node:test";
import { mapDraftWorkstationRows } from "./product-template-draft-workstation-adapter.js";
test("workstation mapping preserves null and zero prices", () => {
  const result = mapDraftWorkstationRows({ pricing: { workstationRows: [{ id: "a", label: "Desk", displayName: null, dimensions: { width: 160, depth: 80, height: 75, diameter: null, unit: "cm", rawText: null }, supplierCodes: ["A"], referenceCodes: [], currency: "EUR", price: null, additionalPrice: 0, specification: "Spec", layoutType: null }], baseModelRows: [], priceMatrices: [], modularGroups: [] } } as never);
  assert.equal(result.rows[0].default_price, null); assert.equal(result.rows[0].additional_price, 0);
});
