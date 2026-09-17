import assert from "node:assert/strict";
import test from "node:test";
import { mapDraftBaseModelPricing } from "./product-template-draft-base-model-adapter.js";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { createSmartSetupReviewRouting, draftForSmartSetupReviewApply, reorderSmartSetupReviewRoutes, smartReviewMatrixOverrides, validateSmartSetupReviewRouting } from "./smart-product-review-routing.js";
const row = (id, prices) => ({ id, label: id, displayName: id, dimensions: null, currency: "EUR", specification: null, supplierCodes: [`code-${id}`], referenceCodes: [], prices });
const matrix = (id, columns = [{ id: "price", label: "Price" }], prices = { price: 0 }) => ({ id, label: id, columns, rows: [row(`${id}-row`, prices)] });
const draft = {
    version: 1, template: { templateName: "MONOLITH", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: "EUR",
    pricing: { workstationRows: [], baseModelRows: [], modularGroups: [], priceMatrices: [matrix("Executive Desks", undefined, { price: null }), matrix("Ceramic Executive Desks"), matrix("ARCA", [{ id: "com", label: "COM/S" }, { id: "t", label: "T" }], { com: 0, t: 10 })] },
    optionGroups: [{ id: "top", label: "Top Access", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] }, items: [{ id: "top-item", label: "Top", displayName: null, dimensions: null, currency: "EUR", price: 0, specification: null, supplierCodes: ["TOP"], referenceCodes: [] }] }],
    materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
};
test("recommendations are editable and reviewed destinations are authoritative", () => {
    const plan = createSmartSetupReviewRouting(draft);
    assert.deepEqual(plan.routes.filter((route) => route.sourceKind === "matrix").map((route) => route.destination), ["base_model", "base_model", "category_matrix"]);
    const executive = plan.routes.find((route) => route.sourceId === "Executive Desks");
    executive.destination = "category_matrix";
    const ceramic = plan.routes.find((route) => route.sourceId === "Ceramic Executive Desks");
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
    const top = plan.routes.find((route) => route.sourceId === "top");
    top.accessory = { role: "conditional_option", selection: "required_exactly_one", rules: [{ baseModelGroupId: "Executive Desks", baseModelRowId: "Executive Desks-row", required: true, allowedItemIds: ["top-item"], fixedQuantity: 1 }] };
    assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, true);
    const group = mapDraftOptionGroupsToAccessories(draftForSmartSetupReviewApply(draft, plan), plan).groups.find((item) => item.id === "top");
    assert.equal(group.group_is_required, true);
    assert.deepEqual(group.conditional_configuration, { role: "conditional_option", selection: "exactly_one", applicability: [{ base_model_group_id: "Executive Desks", base_model_row_id: "Executive Desks-row", required: true, visible: true, allowed_item_ids: ["top-item"], fixed_quantity: 1 }] });
});
test("unsupported routes, duplicate model rules, unknown items, and invalid quantities block apply", () => {
    const plan = createSmartSetupReviewRouting(draft);
    const arca = plan.routes.find((route) => route.sourceId === "ARCA");
    arca.destination = "base_model";
    const top = plan.routes.find((route) => route.sourceId === "top");
    const rule = { baseModelGroupId: "Executive Desks", baseModelRowId: "Executive Desks-row", required: true, allowedItemIds: ["missing"], fixedQuantity: 2 };
    top.accessory = { role: "companion", selection: "required_exactly_one", rules: [rule, { ...rule }] };
    const validation = validateSmartSetupReviewRouting(draft, plan);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(" "), /cannot be applied|duplicate|allowed item|fixed quantity 1/i);
});
test("review routing accepts stable Category / Matrix targets and preserves pricing authority", () => {
    const plan = createSmartSetupReviewRouting(draft);
    const top = plan.routes.find((route) => route.sourceId === "top");
    top.accessory = { role: "conditional_option", selection: "optional_multiple", rules: [{ target: { kind: "price_matrix", group_id: "ARCA", row_id: "ARCA-row" }, required: false, allowedItemIds: ["top-item"] }] };
    assert.equal(validateSmartSetupReviewRouting(draft, plan).valid, true);
    const applied = draftForSmartSetupReviewApply(draft, plan);
    const mapped = mapDraftOptionGroupsToAccessories(applied, plan).groups.find((group) => group.id === "top");
    assert.deepEqual(mapped.conditional_configuration?.applicability[0], { target: { kind: "price_matrix", group_id: "ARCA", row_id: "ARCA-row" }, required: false, visible: true, allowed_item_ids: ["top-item"] });
    assert.equal(mapDraftBaseModelPricing(applied, smartReviewMatrixOverrides(plan)).groups.some((group) => group.id === "ARCA"), false);
    assert.equal(mapDraftPriceMatricesToCategoryGroups(applied, smartReviewMatrixOverrides(plan)).groups.filter((group) => group.id === "ARCA").length, 1);
});
test("review routing rejects nonexistent Category / Matrix targets", () => {
    const plan = createSmartSetupReviewRouting(draft);
    const top = plan.routes.find((route) => route.sourceId === "top");
    top.accessory = { role: "conditional_option", selection: "optional_multiple", rules: [{ target: { kind: "price_matrix", group_id: "ARCA", row_id: "missing" }, required: false }] };
    const validation = validateSmartSetupReviewRouting(draft, plan);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(" "), /not routed to Base \/ Model, Category \/ Matrix, or Modular Pricing/i);
});
test("review routing accepts and persists stable Modular row targets", () => {
    const modularDraft = structuredClone(draft);
    modularDraft.pricing.modularGroups = [{ id: "avana", label: "Avana LARGE", defaultDimensions: null, defaultSpecification: null, matrix: matrix("avana", [{ id: "cat-b", label: "Cat B" }], { "cat-b": 100 }) }];
    const plan = createSmartSetupReviewRouting(modularDraft);
    const top = plan.routes.find((route) => route.sourceId === "top");
    top.accessory = { role: "companion", selection: "required_exactly_one", rules: [{ target: { kind: "modular", group_id: "avana", row_id: "avana-row" }, required: true, allowedItemIds: ["top-item"], fixedQuantity: 1 }] };
    assert.equal(validateSmartSetupReviewRouting(modularDraft, plan).valid, true);
    const mapped = mapDraftOptionGroupsToAccessories(draftForSmartSetupReviewApply(modularDraft, plan), plan).groups.find((group) => group.id === "top");
    assert.deepEqual(mapped.conditional_configuration?.applicability[0], { target: { kind: "modular", group_id: "avana", row_id: "avana-row" }, required: true, visible: true, allowed_item_ids: ["top-item"], fixed_quantity: 1 });
    top.accessory.rules[0] = { ...top.accessory.rules[0], target: { kind: "modular", group_id: "avana", row_id: "missing" } };
    assert.equal(validateSmartSetupReviewRouting(modularDraft, plan).valid, false);
});
test("explicit optional category-priced accessories override service-unit name heuristics", () => {
    const categoryIds = ["B", "C", "D", "E", "F", "G", "SUPREME"];
    const optionalDraft = structuredClone(draft);
    optionalDraft.optionGroups = [{
            id: "cushions",
            label: "Cushions for Pedestals and Service Units",
            priceCategories: categoryIds.map((id) => ({ id, label: id })),
            selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] },
            items: [
                { id: "958", label: "Cushion for pedestals", displayName: null, dimensions: null, currency: "EUR", price: null, prices: Object.fromEntries(categoryIds.map((id, index) => [id, index + 1])), specification: null, supplierCodes: ["1AG 958"], referenceCodes: [] },
                { id: "959", label: "Cushion for service unit", displayName: null, dimensions: null, currency: "EUR", price: null, prices: Object.fromEntries(categoryIds.map((id, index) => [id, index + 11])), specification: null, supplierCodes: ["1AG 959"], referenceCodes: [] },
            ],
        }];
    const plan = createSmartSetupReviewRouting(optionalDraft);
    const route = plan.routes.find((item) => item.sourceId === "cushions");
    assert.deepEqual(route.accessory, { role: "accessory", selection: "optional_multiple", rules: [] });
    const saved = mapDraftOptionGroupsToAccessories(draftForSmartSetupReviewApply(optionalDraft, plan), plan).groups[0];
    assert.equal(saved.conditional_configuration, undefined);
    assert.deepEqual(saved.price_categories, categoryIds.map((id) => ({ id, label: id })));
    assert.deepEqual(saved.items.map((item) => item.prices), optionalDraft.optionGroups[0].items.map((item) => item.prices));
});
test("explicit required service-unit selection remains a required companion", () => {
    const requiredDraft = structuredClone(draft);
    requiredDraft.optionGroups = [{
            id: "service-cabinet",
            label: "Service Cabinet",
            selection: { mode: "required_choose_one", minSelections: 1, maxSelections: 1, defaultItemIds: [] },
            items: [{ id: "cabinet", label: "Cabinet", displayName: null, dimensions: null, currency: "EUR", price: 10, specification: null, supplierCodes: ["CAB"], referenceCodes: [] }],
        }];
    const route = createSmartSetupReviewRouting(requiredDraft).routes.find((item) => item.sourceId === "service-cabinet");
    assert.deepEqual(route.accessory, { role: "companion", selection: "required_exactly_one", rules: [] });
});
test("service-unit name heuristic is used only when source selection is absent", () => {
    const ambiguousDraft = structuredClone(draft);
    ambiguousDraft.optionGroups = [{
            id: "legacy-service",
            label: "Service Units",
            selection: undefined,
            items: [{ id: "service", label: "Service unit", displayName: null, dimensions: null, currency: "EUR", price: 10, specification: null, supplierCodes: ["SERVICE"], referenceCodes: [] }],
        }];
    const route = createSmartSetupReviewRouting(ambiguousDraft).routes.find((item) => item.sourceId === "legacy-service");
    assert.deepEqual(route.accessory, { role: "companion", selection: "required_exactly_one", rules: [] });
});
