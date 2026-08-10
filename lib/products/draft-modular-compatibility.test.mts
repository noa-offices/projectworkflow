import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDraftModularCompatibility } from "./draft-modular-compatibility.js";
import { PRODUCT_TEMPLATE_DRAFT_VERSION, type ProductTemplateDraft } from "./product-template-draft.js";

const base = (columns: Array<{ id: string; label: string }>): ProductTemplateDraft => ({
  version: PRODUCT_TEMPLATE_DRAFT_VERSION,
  template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
  defaultCurrency: null,
  pricing: { modularGroups: [{ id: "a", label: "A", matrix: { id: "matrix-a", label: "A", columns, rows: [{ id: "r", label: "R", displayName: null, dimensions: null, currency: null, specification: null, supplierCodes: [], referenceCodes: [], prices: Object.fromEntries(columns.map((column, index) => [column.id, index === 0 ? null : index === 1 ? 0 : 355])) }] }, defaultDimensions: null, defaultSpecification: null }], workstationRows: [], baseModelRows: [], priceMatrices: [] },
  optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
});
test("modular compatibility preserves nullable cells and rejects incompatible columns", () => {
  const draft = base([{ id: "b", label: "Cat B" }, { id: "c", label: "Cat C" }, { id: "d", label: "Cat D" }]);
  const result = analyzeDraftModularCompatibility(draft); assert.equal(result.compatible, true); assert.equal(result.groups[0].matrix.rows[0].prices.b, null); assert.equal(result.groups[0].matrix.rows[0].prices.c, 0); assert.equal(result.groups[0].matrix.rows[0].prices.d, 355);
  const incompatible = base([{ id: "b", label: "Cat B" }, { id: "e", label: "Cat E" }, { id: "f", label: "Cat F" }]);
  assert.equal(analyzeDraftModularCompatibility({ ...draft, pricing: { ...draft.pricing, modularGroups: [...draft.pricing.modularGroups, ...incompatible.pricing.modularGroups] } }).compatible, false);
});
