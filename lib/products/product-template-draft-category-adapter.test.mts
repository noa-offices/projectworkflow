import assert from "node:assert/strict";
import test from "node:test";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter.js";

test("category draft mapping preserves source-driven columns, order, null, and zero", () => {
  const result = mapDraftPriceMatricesToCategoryGroups({
    version: 1,
    template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: null,
    pricing: {
      workstationRows: [], baseModelRows: [], modularGroups: [],
      priceMatrices: [{ id: "arca", label: "ARCA", columns: [{ id: "com-s", label: "COM / S" }, { id: "t", label: "T" }, { id: "m", label: "M" }, { id: "f", label: "F" }, { id: "l", label: "L" }, { id: "p", label: "P" }, { id: "px", label: "PX" }], rows: [{ id: "arca-seat", label: "Seat", displayName: null, dimensions: null, currency: "EUR", specification: null, supplierCodes: [], referenceCodes: [], prices: { "com-s": null, t: 0, m: 125, f: null, l: null, p: null, px: null } }] }],
    },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  });
  assert.deepEqual(result.groups[0].price_categories, ["COM / S", "T", "M", "F", "L", "P", "PX"]);
  assert.equal(result.groups[0].items[0].prices?.["COM / S"], null);
  assert.equal(result.groups[0].items[0].prices?.T, 0);
  assert.equal(result.groups[0].items[0].prices?.M, 125);
});

test("direct-price matrices are excluded while ambiguous one-column matrices remain with warnings", () => {
  const base = {
    version: 1 as const,
    template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: null,
    pricing: { workstationRows: [], baseModelRows: [], modularGroups: [], priceMatrices: [
      { id: "desks", label: "Executive Desks", columns: [{ id: "price", label: "Price" }], rows: [{ id: "desk", label: "Desk", displayName: null, dimensions: null, currency: "EUR" as const, specification: null, supplierCodes: ["1AF003"], referenceCodes: [], prices: { price: 100 } }] },
      { id: "ambiguous", label: "Ambiguous", columns: [{ id: "a", label: "A" }], rows: [{ id: "a-row", label: "A", displayName: null, dimensions: null, currency: "EUR" as const, specification: null, supplierCodes: ["A"], referenceCodes: [], prices: { a: 50 } }] },
    ] },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  };
  const result = mapDraftPriceMatricesToCategoryGroups(base);
  assert.deepEqual(result.groups.map((group) => group.group_name), ["Ambiguous"]);
  assert.equal(result.warnings.some((warning) => warning.includes("could not be confirmed")), true);
});
