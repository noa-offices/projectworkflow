import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft, ProductTemplateDraftPriceMatrix } from "./product-template-draft.js";
import { routeDraftPriceMatrices } from "./product-template-draft-pricing-routing.js";

const matrix = (id: string, label: string, columns = [{ id: "price", label: "Price (EUR)" }], specification = "Desk configuration"): ProductTemplateDraftPriceMatrix => ({
  id, label, columns,
  rows: [{ id: `${id}-row`, label: "1AF 003", displayName: "Executive Desk", dimensions: { width: 210, depth: 100, height: 75, diameter: null, unit: "cm", rawText: "210 × 100 cm" }, currency: "EUR", specification, supplierCodes: ["1AF003"], referenceCodes: ["REF-3"], prices: Object.fromEntries(columns.map((column, index) => [column.id, index ? 200 : 0])) }],
});
const draft = (priceMatrices: ProductTemplateDraftPriceMatrix[]): ProductTemplateDraft => ({
  version: 1,
  template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
  defaultCurrency: null,
  pricing: { workstationRows: [], baseModelRows: [], priceMatrices, modularGroups: [] },
  optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
});

test("direct-price model matrices route independently while true matrices remain category pricing", () => {
  const arca = matrix("arca", "ARCA", [{ id: "com", label: "COM / S" }, { id: "t", label: "T" }, { id: "px", label: "PX" }]);
  const result = routeDraftPriceMatrices(draft([matrix("executive", "Executive Desks"), matrix("ceramic", "Ceramic Top Executive Desks"), arca]));
  assert.deepEqual(result.routes.map((route) => route.kind), ["base_model", "base_model", "category_matrix"]);
});

test("ambiguous one-column matrices remain category pricing while companion-like matrices route separately", () => {
  const ambiguous = matrix("ambiguous", "Special Family", [{ id: "a", label: "A" }]);
  const service = matrix("service", "Support Service Units for Executive Desks", undefined, "Must be completed with a desk");
  const result = routeDraftPriceMatrices(draft([ambiguous, service]));
  assert.deepEqual(result.routes.map((route) => route.kind), ["category_matrix", "companion"]);
  assert.equal(result.warnings.length, 1);
});
