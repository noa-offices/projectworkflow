import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { serializeAccessoryConfigurationGroups } from "./accessory-conditional-configuration.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import type { ProductTemplateDraft } from "./product-template-draft.js";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace.js";
import { reviewedProductTemplateDraftForApply } from "./smart-product-review.js";
import { createSmartSetupReviewRouting, draftForSmartSetupReviewApply } from "./smart-product-review-routing.js";

const categories = ["b", "c", "d", "e", "f", "g", "supreme"].map((id) => ({ id: `cat-${id}`, label: id === "b" ? "B" : id.toUpperCase() }));
const categoryPrices = (values: number[]) => Object.fromEntries(categories.map((category, index) => [category.id, values[index]]));

function sourceDraft(): ProductTemplateDraft {
  return {
    version: 1,
    template: { templateName: "Pedestals", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: "LAS", dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: "EUR",
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] },
    optionGroups: [
      { id: "cushions", label: "Cushions for Pedestals and Service Units", priceCategories: categories, selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [
        { id: "958", label: "Cushion for pedestals", displayName: "Cushion for pedestals", supplierCodes: ["1AG 958"], referenceCodes: [], dimensions: { width: null, depth: null, height: null, diameter: null, unit: null, rawText: "L.42,1 x p.55,2 x H.3" }, currency: "EUR", price: null, prices: categoryPrices([93, 101, 105, 110, 115, 121, 162]), specification: "Pedestal cushion.", importantRequirements: ["Match the selected fabric category."] },
        { id: "959", label: "Cushion for service unit", displayName: "Cushion for service unit", supplierCodes: ["1AG 959"], referenceCodes: [], dimensions: null, currency: "EUR", price: null, prices: categoryPrices([107, 114, 121, 128, 133, 142, 189]), specification: "Service-unit cushion." },
      ] },
      { id: "pedestal-accessories", label: "Accessories for Pedestals", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [
        { id: "wheel", label: "Fifth optional wheel", displayName: "Fifth optional wheel", supplierCodes: ["175 105"], referenceCodes: [], dimensions: null, currency: "EUR", price: 35, specification: "Applicable to file pedestals." },
      ] },
    ],
    materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  };
}

test("actual Smart Setup Apply flow preserves category accessories through receiver, editor, save, and reopen", () => {
  const reviewedDraft = reviewedProductTemplateDraftForApply(sourceDraft());
  const plan = createSmartSetupReviewRouting(reviewedDraft);
  const applyPayload = draftForSmartSetupReviewApply(reviewedDraft, plan);
  assert.equal(applyPayload.optionGroups[0].priceCategories?.length, 7);
  assert.equal(applyPayload.optionGroups[0].priceCategories?.[0].id, "cat-b");
  assert.equal(applyPayload.optionGroups[0].priceCategories?.[0].label, "B");
  assert.equal(applyPayload.optionGroups[0].items[0].prices?.["cat-c"], 101);
  assert.equal(applyPayload.optionGroups[0].items[1].prices?.["cat-c"], 114);

  const receiverGroups = mapDraftOptionGroupsToAccessories(applyPayload, plan).groups;
  const categoryGroup = receiverGroups.find((group) => group.id === "cushions")!;
  const scalarGroup = receiverGroups.find((group) => group.id === "pedestal-accessories")!;
  assert.deepEqual(categoryGroup.price_categories, categories);
  assert.equal(categoryGroup.items[0].prices?.["cat-c"], 101);
  assert.equal(categoryGroup.items[1].prices?.["cat-c"], 114);
  assert.equal(scalarGroup.price_categories, undefined);
  assert.equal(scalarGroup.items[0].price, 35);

  const editorSource = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(editorSource.includes("row.price_categories?.length ? { price_categories: row.price_categories.map((category) => ({ ...category })) }"));
  assert.ok(editorSource.includes("(group.price_categories ?? []).length"));
  assert.ok(editorSource.includes("item.prices?.[category.id] ?? \"\""));

  const savedGroups = serializeAccessoryConfigurationGroups(receiverGroups);
  const reopened = productTemplateFormSmartWorkspace({ desking_size_pricing: "[]", variant_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: JSON.stringify(savedGroups) });
  const reopenedCategory = reopened.draft.optionGroups.find((group) => group.id === "cushions")!;
  const reopenedScalar = reopened.draft.optionGroups.find((group) => group.id === "pedestal-accessories")!;
  assert.deepEqual(reopenedCategory.priceCategories, categories);
  assert.equal(reopenedCategory.items[0].prices?.["cat-c"], 101);
  assert.equal(reopenedCategory.items[1].prices?.["cat-c"], 114);
  assert.deepEqual(reopenedCategory.items[0].importantRequirements, ["Match the selected fabric category."]);
  assert.equal(reopenedScalar.priceCategories, undefined);
  assert.equal(reopenedScalar.items[0].price, 35);
});
