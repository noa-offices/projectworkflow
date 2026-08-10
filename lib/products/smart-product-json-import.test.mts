import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SMART_PRODUCT_JSON_BYTES, parseSmartProductJsonImport } from "./smart-product-json-import.js";

function draft(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1, template: { templateName: "UAT Desk" }, defaultCurrency: "EUR",
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [], ...overrides,
  });
}

test("malformed, oversized, and unsupported-version JSON do not reach review", () => {
  assert.equal(parseSmartProductJsonImport("{").kind, "invalid_json");
  assert.equal(parseSmartProductJsonImport("x".repeat(MAX_SMART_PRODUCT_JSON_BYTES + 1)).kind, "oversized");
  assert.equal(parseSmartProductJsonImport(draft({ version: 2 })).kind, "validation");
});

test("valid workstation, base, matrix, modular, and options drafts reach review without changing prices", () => {
  const result = parseSmartProductJsonImport(draft({
    pricing: {
      workstationRows: [{ id: "desk", label: "Desk", price: null, additionalPrice: 0 }],
      baseModelRows: [{ id: "base", label: "Base", price: 0 }],
      priceMatrices: [{ id: "fabric", columns: [{ id: "a", label: "A" }], rows: [{ id: "seat", prices: { a: null } }] }],
      modularGroups: [{ id: "modular", matrix: { id: "modules", columns: [{ id: "a", label: "A" }], rows: [{ id: "module", prices: { a: 0 } }] } }],
    },
    optionGroups: [{ id: "power", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: ["socket"] }, items: [{ id: "socket", price: 0 }] }],
  }));
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") return;
  assert.equal(result.validation.draft?.pricing.workstationRows[0].price, null);
  assert.equal(result.validation.draft?.pricing.workstationRows[0].additionalPrice, 0);
  assert.equal(result.validation.draft?.pricing.priceMatrices[0].rows[0].prices.a, null);
  assert.equal(result.validation.draft?.pricing.modularGroups[0].matrix.rows[0].prices.a, 0);
});
