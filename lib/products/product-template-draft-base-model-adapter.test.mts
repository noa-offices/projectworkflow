import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft, ProductTemplateDraftPriceMatrix } from "./product-template-draft.js";
import { mapDraftBaseModelPricing, mapDraftBaseModelRows } from "./product-template-draft-base-model-adapter.js";

const matrix = (id: string, price: number | null): ProductTemplateDraftPriceMatrix => ({ id, label: id === "executive" ? "Executive Desks" : "Ceramic Top Executive Desks", columns: [{ id: "price", label: "Direct Price" }], rows: [{ id: `${id}-row`, label: `${id}-code`, displayName: `${id} display`, dimensions: { width: 210, depth: 100, height: 75, diameter: null, unit: "cm", rawText: "210 × 100 cm" }, currency: "EUR", specification: `${id} specification`, supplierCodes: [`${id}-supplier`], referenceCodes: [], prices: { price } }] });
const makeDraft = (priceMatrices: ProductTemplateDraftPriceMatrix[] = []): ProductTemplateDraft => ({ version: 1, template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: null, pricing: { workstationRows: [], baseModelRows: [{ id: "existing", label: "Existing", displayName: "Existing model", dimensions: null, currency: "EUR", price: 10, specification: "Existing spec", supplierCodes: ["EX"], referenceCodes: [] }], priceMatrices, modularGroups: [] }, optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [] });

test("existing flat baseModelRows mapping remains unchanged", () => {
  assert.deepEqual(mapDraftBaseModelPricing(makeDraft()).rows, mapDraftBaseModelRows(makeDraft()).rows);
});

test("direct-price matrices become separate ordered Base/Model groups with source fields and price semantics", () => {
  const result = mapDraftBaseModelPricing(makeDraft([matrix("executive", null), matrix("ceramic", 0)]));
  assert.deepEqual(result.groups.map((group) => group.group_name), ["Executive Desks", "Ceramic Top Executive Desks"]);
  assert.equal(result.groups[0].items[0].supplier_price_list_code, "executive-supplier");
  assert.equal(result.groups[0].items[0].dimension, "210 × 100 cm");
  assert.equal(result.groups[0].items[0].specification, "executive specification");
  assert.equal(result.groups[0].items[0].price, null);
  assert.equal(result.groups[1].items[0].price, 0);
  assert.equal("conditional_configuration" in result.groups[0], false);
});

test("stable row IDs prevent deterministic duplicates across flat and converted sources", () => {
  const duplicate = matrix("executive", 20);
  duplicate.rows[0] = { ...duplicate.rows[0], id: "existing" };
  const result = mapDraftBaseModelPricing(makeDraft([duplicate]));
  assert.equal(result.groups.length, 0);
  assert.equal(result.warnings.some((warning) => warning.includes("not duplicated")), true);
});
