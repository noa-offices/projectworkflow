import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_TEMPLATE_DRAFT_VERSION, type ProductTemplateDraft } from "./product-template-draft.js";
import { mapDraftWorkstationRows } from "./product-template-draft-workstation-adapter.js";
import { mapDraftBaseModelRows } from "./product-template-draft-base-model-adapter.js";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter.js";
import { mapDraftModularPricing } from "./product-template-draft-modular-adapter.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";

const references = { supplierCodes: ["PRIMARY"], referenceCodes: [] };
const pricedRow = (id: string, price: number | null) => ({
  id, label: id, displayName: id, dimensions: null, currency: "EUR" as const,
  price, specification: "Test", ...references,
});

function fullDraft(): ProductTemplateDraft {
  const columns = [{ id: "b", label: "Cat B" }, { id: "c", label: "Cat C" }, { id: "d", label: "Cat D" }];
  const matrixRow = { ...pricedRow("matrix-row", null), prices: { b: null, c: 0, d: 355 } };
  return {
    version: PRODUCT_TEMPLATE_DRAFT_VERSION,
    template: { templateName: "Five sections", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: "EUR",
    pricing: {
      workstationRows: [{ ...pricedRow("workstation", null), additionalPrice: 0, layoutType: "linear" }],
      baseModelRows: [pricedRow("base", 0)],
      priceMatrices: [{ id: "finish", label: "Finish", columns, rows: [matrixRow] }],
      modularGroups: [
        { id: "modular-a", label: "Modular A", defaultDimensions: null, defaultSpecification: null, matrix: { id: "modular-a-matrix", label: null, columns, rows: [matrixRow] } },
        { id: "modular-b", label: "Modular B", defaultDimensions: null, defaultSpecification: null, matrix: { id: "modular-b-matrix", label: null, columns: [...columns].reverse(), rows: [{ ...matrixRow, prices: { b: 355, c: 0, d: null } }] } },
      ],
    },
    optionGroups: [{ id: "options", label: "Options", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [pricedRow("option-free", 0), pricedRow("option-paid", 75)] }],
    materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  };
}

test("all five adapters independently preserve null, zero, numbers, and hierarchy", () => {
  const draft = fullDraft();
  const workstation = mapDraftWorkstationRows(draft);
  const base = mapDraftBaseModelRows(draft);
  const category = mapDraftPriceMatricesToCategoryGroups(draft);
  const modular = mapDraftModularPricing(draft);
  const accessories = mapDraftOptionGroupsToAccessories(draft);
  assert.equal(workstation.rows[0].default_price, null);
  assert.equal(workstation.rows[0].additional_price, 0);
  assert.equal(base.rows[0].price, 0);
  assert.deepEqual(category.groups[0].items[0].prices, { "Cat B": null, "Cat C": 0, "Cat D": 355 });
  assert.equal(modular.compatible, true);
  assert.equal(modular.groups.length, 2);
  assert.deepEqual(modular.groups[0].items[0].prices, { "Cat B": null, "Cat C": 0, "Cat D": 355 });
  assert.equal(accessories.groups[0].items[0].price, 0);
  assert.equal(accessories.groups[0].items[1].price, 75);
});

test("unsafe modular and accessory sections yield no replacement payload", () => {
  const draft = fullDraft();
  draft.pricing.modularGroups[1].matrix.columns = [{ id: "e", label: "Cat E" }];
  draft.optionGroups[0].selection = { mode: "required_choose_one", minSelections: 1, maxSelections: 1, defaultItemIds: ["option-free"] };
  assert.equal(mapDraftModularPricing(draft).compatible, false);
  assert.deepEqual(mapDraftModularPricing(draft).groups, []);
  assert.deepEqual(mapDraftOptionGroupsToAccessories(draft).groups, []);
});
