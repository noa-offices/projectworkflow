import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft, ProductTemplateDraftPriceMatrix } from "./product-template-draft.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { mapDraftBaseModelPricing } from "./product-template-draft-base-model-adapter.js";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter.js";

const desk = (id: string, label: string, specification: string, price: number | null): ProductTemplateDraftPriceMatrix => ({ id, label, columns: [{ id: "col-price", label: "Price" }], rows: [{ id: `${id}-row`, label: `${id}-code`, displayName: label, dimensions: { width: 210, depth: 100, height: 75, diameter: null, unit: "cm", rawText: "210 × 100 cm" }, currency: "EUR", specification, supplierCodes: [`${id}-supplier`], referenceCodes: [], prices: { "col-price": price } }] });
const draft: ProductTemplateDraft = {
  version: 1,
  template: { templateName: "MONOLITH", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
  defaultCurrency: "EUR",
  pricing: {
    workstationRows: [], baseModelRows: [], modularGroups: [],
    priceMatrices: [
      desk("executive", "Executive Desks", "Always complete with 1 top-access.", null),
      desk("ceramic", "Executive Desks with Ceramic Top Marble Effect", "Always complete with 1 service unit on adjustable feet.", 0),
      desk("foil", "Executive Desks with 3D-Foil Insert Element", "Always complete with 1 top-access and 1 service unit on adjustable feet.", 100),
      desk("leather", "Executive Desks with Eco-Leather Insert Element", "No required companion.", 200),
      { id: "service", label: "Support Service Units for Executive Desks", columns: [{ id: "col-price", label: "Price" }], rows: [{ id: "service-row", label: "Service Unit", displayName: "Service Unit", dimensions: null, currency: "EUR", specification: "Support unit", supplierCodes: ["SU-1"], referenceCodes: [], prices: { "col-price": 50 } }] },
      { id: "arca", label: "ARCA", columns: [{ id: "com", label: "COM / S" }, { id: "t", label: "T" }], rows: [{ id: "arca-row", label: "ARCA", displayName: null, dimensions: null, currency: "EUR", specification: null, supplierCodes: ["ARCA"], referenceCodes: [], prices: { com: null, t: 125 } }] },
    ],
  },
  optionGroups: [
    { id: "top", label: "Top-Access for Executive Desks", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] }, items: [{ id: "top-row", label: "Top Access", displayName: null, dimensions: null, currency: "EUR", price: 20, specification: "Top", supplierCodes: ["TA-1"], referenceCodes: [] }] },
    { id: "modesty", label: "Modesty Panels for Executive Desks", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] }, items: [{ id: "modesty-standard", label: "Standard Modesty Panel", displayName: null, dimensions: null, currency: "EUR", price: 0, specification: "Standard", supplierCodes: ["MP-0"], referenceCodes: [] }, { id: "modesty-privacy", label: "Privacy Modesty Panel", displayName: null, dimensions: null, currency: "EUR", price: 25, specification: "Privacy", supplierCodes: ["MP-1"], referenceCodes: [] }] },
  ], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
};

test("MONOLITH routes desks, companions, optional exactly-one groups, and explicit model rules without duplicates", () => {
  const base = mapDraftBaseModelPricing(draft);
  const category = mapDraftPriceMatricesToCategoryGroups(draft);
  const accessories = mapDraftOptionGroupsToAccessories(draft);
  assert.deepEqual(base.groups.map((group) => group.group_name), ["Executive Desks", "Executive Desks with Ceramic Top Marble Effect", "Executive Desks with 3D-Foil Insert Element", "Executive Desks with Eco-Leather Insert Element"]);
  assert.deepEqual(category.groups.map((group) => group.group_name), ["ARCA"]);
  assert.equal(base.groups[0].items[0].price, null);
  assert.equal(base.groups[1].items[0].price, 0);
  const top = accessories.groups.find((group) => group.id === "top");
  const service = accessories.groups.find((group) => group.id === "service");
  const modesty = accessories.groups.find((group) => group.id === "modesty");
  assert.deepEqual(top?.conditional_configuration?.applicability.map((rule) => rule.base_model_row_id), ["executive-row", "foil-row"]);
  assert.deepEqual(service?.conditional_configuration?.applicability.map((rule) => rule.base_model_row_id), ["ceramic-row", "foil-row"]);
  assert.deepEqual(service?.conditional_configuration?.role, "companion");
  assert.deepEqual(modesty?.conditional_configuration, { role: "accessory", selection: "exactly_one", applicability: [] });
  assert.equal(modesty?.items[0].price, 0);
  assert.equal(accessories.errors.length, 0);
});
