import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft, ProductTemplateDraftPriceMatrix } from "./product-template-draft.js";
import { mapDraftBaseModelPricing } from "./product-template-draft-base-model-adapter.js";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { createSmartSetupReviewRouting, draftForSmartSetupReviewApply, reorderSmartSetupReviewRoutes, smartReviewMatrixOverrides, validateSmartSetupReviewRouting } from "./smart-product-review-routing.js";

const row = (id: string, prices: Record<string, number | null>) => ({ id, label: id, displayName: id, dimensions: null, currency: "EUR" as const, specification: null, supplierCodes: [`code-${id}`], referenceCodes: [], prices });
const matrix = (id: string, columns = [{ id: "price", label: "Price" }], prices: Record<string, number | null> = { price: 0 }): ProductTemplateDraftPriceMatrix => ({ id, label: id, columns, rows: [row(`${id}-row`, prices)] });
const draft: ProductTemplateDraft = {
  version: 1, template: { templateName: "MONOLITH", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: "EUR",
  pricing: { workstationRows: [], baseModelRows: [], modularGroups: [], priceMatrices: [matrix("Executive Desks", undefined, { price: null }), matrix("Ceramic Executive Desks"), matrix("ARCA", [{ id: "com", label: "COM/S" }, { id: "t", label: "T" }], { com: 0, t: 10 })] },
  optionGroups: [{ id: "top", label: "Top Access", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] }, items: [{ id: "top-item", label: "Top", displayName: null, dimensions: null, currency: "EUR", price: 0, specification: null, supplierCodes: ["TOP"], referenceCodes: [] }] }],
  materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
};

test("recommendations are editable and reviewed destinations are authoritative", () => {
  const plan = createSmartSetupReviewRouting(draft);
  assert.deepEqual(plan.routes.filter((route) => route.sourceKind === "matrix").map((route) => route.destination), ["base_model", "base_model", "category_matrix"]);
  const executive = plan.routes.find((route) => route.sourceId === "Executive Desks")!;
  executive.destination = "category_matrix";
  const ceramic = plan.routes.find((route) => route.sourceId === "Ceramic Executive Desks")!;
  ceramic.destination = "skip";
  const applied = draftForSmartSetupReviewApply(draft, plan);
  const overrides = smartReviewMatrixOverrides(plan);
  assert.deepEqual(mapDraftBaseModelPricing(applied, overrides).groups, []);
  assert.deepEqual(mapDraftPriceMatricesToCategoryGroups(applied, overrides).groups.map((group) => group.group_name), ["Executive Desks", "ARCA"]);
  assert.equal(mapDraftPriceMatricesToCategoryGroups(applied, overrides).groups[0].items[0].prices?.Price, null);
  assert.equal(mapDraftPriceMatricesToCategoryGroups(applied, overrides).groups[1].items[0].prices?.["COM/S"], 0);
});

test("review route reordering preserves route data and applies relative destination order", () => {
  const plan = createSmartSetupReviewRouting(draft);
  const moved = reorderSmartSetupReviewRoutes(plan, "matrix:Ceramic Executive Desks", "up");
  assert.deepEqual(moved.routes.map((route) => route.sourceId), ["Ceramic Executive Desks", "Executive Desks", "ARCA", "top"]);
  assert.equal(moved.routes[0].groupName, "Ceramic Executive Desks");
  assert.equal(reorderSmartSetupReviewRoutes(moved, "matrix:Ceramic Executive Desks", "up"), moved);
  const applied = draftForSmartSetupReviewApply(draft, moved);
  assert.deepEqual(applied.pricing.priceMatrices.map((item) => item.id), ["Ceramic Executive Desks", "Executive Desks", "ARCA"]);
  assert.deepEqual(applied.optionGroups.map((item) => item.id), ["top"]);
});

test("reviewed accessory contract preserves role, selection, stable IDs, allowed items, and fixed quantity", () => {
  const plan = createSmartSetupReviewRouting(draft);
  const top = plan.routes.find((route) => route.sourceId === "top")!;
  top.accessory = { role: "conditional_option", selection: "required_exactly_one", rules: [{ baseModelGroupId: "Executive Desks", baseModelRowId: "Executive Desks-row", required: true, allowedItemIds: ["top-item"], fixedQuantity: 1 }] };
  assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, true);
  const group = mapDraftOptionGroupsToAccessories(draftForSmartSetupReviewApply(draft, plan), plan).groups.find((item) => item.id === "top")!;
  assert.equal(group.group_is_required, true);
  assert.deepEqual(group.conditional_configuration, { role: "conditional_option", selection: "exactly_one", applicability: [{ base_model_group_id: "Executive Desks", base_model_row_id: "Executive Desks-row", required: true, visible: true, allowed_item_ids: ["top-item"], fixed_quantity: 1 }] });
});

test("unsupported routes, duplicate model rules, unknown items, and invalid quantities block apply", () => {
  const plan = createSmartSetupReviewRouting(draft);
  const arca = plan.routes.find((route) => route.sourceId === "ARCA")!;
  arca.destination = "base_model";
  const top = plan.routes.find((route) => route.sourceId === "top")!;
  const rule = { baseModelGroupId: "Executive Desks", baseModelRowId: "Executive Desks-row", required: true, allowedItemIds: ["missing"], fixedQuantity: 2 };
  top.accessory = { role: "companion", selection: "required_exactly_one", rules: [rule, { ...rule }] };
  const validation = validateSmartSetupReviewRouting(draft, plan);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /cannot be applied|duplicate|allowed item|fixed quantity 1/i);
});

test("review routing accepts stable Category / Matrix targets and preserves pricing authority", () => {
  const plan = createSmartSetupReviewRouting(draft);
  const top = plan.routes.find((route) => route.sourceId === "top")!;
  top.accessory = { role: "conditional_option", selection: "optional_multiple", rules: [{ target: { kind: "price_matrix", group_id: "ARCA", row_id: "ARCA-row" }, required: false, allowedItemIds: ["top-item"] }] };
  assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, true);
  const applied = draftForSmartSetupReviewApply(draft, plan);
  const mapped = mapDraftOptionGroupsToAccessories(applied, plan).groups.find((group) => group.id === "top")!;
  assert.deepEqual(mapped.conditional_configuration?.applicability[0], { target: { kind: "price_matrix", group_id: "ARCA", row_id: "ARCA-row" }, required: false, visible: true, allowed_item_ids: ["top-item"] });
  assert.equal(mapDraftBaseModelPricing(applied, smartReviewMatrixOverrides(plan)).groups.some((group) => group.id === "ARCA"), false);
  assert.equal(mapDraftPriceMatricesToCategoryGroups(applied, smartReviewMatrixOverrides(plan)).groups.filter((group) => group.id === "ARCA").length, 1);
});

test("review routing rejects nonexistent Category / Matrix targets", () => {
  const plan = createSmartSetupReviewRouting(draft);
  const top = plan.routes.find((route) => route.sourceId === "top")!;
  top.accessory = { role: "conditional_option", selection: "optional_multiple", rules: [{ target: { kind: "price_matrix", group_id: "ARCA", row_id: "missing" }, required: false }] };
  const validation = validateSmartSetupReviewRouting(draft, plan);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /not routed to Base \/ Model or Category \/ Matrix Pricing/i);
});
