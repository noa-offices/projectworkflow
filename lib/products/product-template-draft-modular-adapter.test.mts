import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_TEMPLATE_DRAFT_VERSION, type ProductTemplateDraft } from "./product-template-draft.js";
import { mapDraftModularPricing } from "./product-template-draft-modular-adapter.js";

function draftWith(columnSets: Array<Array<{ id: string; label: string }>>): ProductTemplateDraft {
  return {
    version: PRODUCT_TEMPLATE_DRAFT_VERSION,
    template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: null,
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: columnSets.map((columns, groupIndex) => ({ id: `group-${groupIndex}`, label: `Group ${groupIndex}`, defaultDimensions: null, defaultSpecification: null, matrix: { id: `matrix-${groupIndex}`, label: null, columns, rows: [{ id: `row-${groupIndex}`, label: `Row ${groupIndex}`, displayName: null, dimensions: null, currency: "EUR", specification: "Test", supplierCodes: ["PRIMARY", "EXTRA"], referenceCodes: [], prices: Object.fromEntries(columns.map((column, index) => [column.id, index === 0 ? null : index === 1 ? 0 : 355])) }] } })) },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  };
}

test("compatible modular groups map separately and preserve shared price semantics", () => {
  const columns = [{ id: "b", label: "Cat B" }, { id: "c", label: "Cat C" }, { id: "d", label: "Cat D" }];
  const result = mapDraftModularPricing(draftWith([columns, [...columns].reverse()]));
  assert.equal(result.compatible, true);
  assert.deepEqual(result.priceCategories, ["Cat B", "Cat C", "Cat D"]);
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups[1].items[0].prices, { "Cat B": 355, "Cat C": 0, "Cat D": null });
  assert.match(result.warnings[0], /only the primary code/);
});

test("incompatible modular columns produce no replacement groups", () => {
  const result = mapDraftModularPricing(draftWith([
    [{ id: "b", label: "Cat B" }, { id: "c", label: "Cat C" }],
    [{ id: "b", label: "Cat B" }, { id: "e", label: "Cat E" }],
  ]));
  assert.equal(result.compatible, false);
  assert.deepEqual(result.groups, []);
});
