import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft, ProductTemplateDraftMatrixRow, ProductTemplateDraftPricedRow, ProductTemplateDraftWorkstationRow } from "./product-template-draft.js";
import { compareManufacturerUpdate, type ManufacturerUpdateWorkspace } from "./manufacturer-update-diff.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";

const priced = (id: string, code: string | null, price: number | null, extra: Partial<ProductTemplateDraftPricedRow> = {}): ProductTemplateDraftPricedRow => ({ id, label: extra.label ?? id, displayName: extra.displayName ?? id, dimensions: extra.dimensions ?? null, currency: extra.currency ?? "EUR", price, specification: extra.specification ?? null, supplierCodes: code ? [code] : [], referenceCodes: extra.referenceCodes ?? [], ...extra });
const matrixRow = (id: string, code: string | null, prices: Record<string, number | null>, extra: Partial<ProductTemplateDraftMatrixRow> = {}): ProductTemplateDraftMatrixRow => { const base = priced(id, code, null, extra); return { ...base, prices, ...extra } as ProductTemplateDraftMatrixRow; };
const workstation = (id: string, code: string | null, price: number | null, additionalPrice: number | null): ProductTemplateDraftWorkstationRow => ({ ...priced(id, code, price), additionalPrice, layoutType: "linear" });
const draft = (): ProductTemplateDraft => ({ version: 1, template: { templateName: "MONOLITH", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: "EUR", pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] }, optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [] });
const workspace = (source: ProductTemplateDraft): ManufacturerUpdateWorkspace => ({ draft: source, plan: createSmartSetupReviewRouting(source), subgroups: {} });

test("comparison is pure and current unsaved values are authoritative", () => {
  const current = draft(); current.pricing.baseModelRows = [priced("saved-id", "1AF001", 2300)];
  const incoming = draft(); incoming.pricing.baseModelRows = [priced("incoming-id", "1AF001", 2400)];
  const currentBefore = structuredClone(current); const incomingBefore = structuredClone(incoming);
  const result = compareManufacturerUpdate(workspace(current), incoming);
  assert.equal(result.sections.base_model.matchedItems[0].priceFields[0].currentValue, 2300);
  assert.equal(result.sections.base_model.matchedItems[0].priceFields[0].incomingValue, 2400);
  assert.deepEqual(current, currentBefore); assert.deepEqual(incoming, incomingBefore);
});

test("stable ID, supplier code, and reference code follow the matching hierarchy", () => {
  const current = draft(); current.pricing.baseModelRows = [priced("stable", "OLD", 1), priced("supplier", "1AF002", 2), priced("reference", null, 3, { referenceCodes: ["REF-3"] })];
  const incoming = draft(); incoming.pricing.baseModelRows = [priced("stable", "NEW", 10), priced("different", "1AF002", 20), priced("another", null, 30, { referenceCodes: ["REF-3"] })];
  const matches = compareManufacturerUpdate(workspace(current), incoming).sections.base_model.matchedItems;
  assert.deepEqual(matches.map((match) => [match.incoming.rowId, match.evidence, match.existing.rowId]), [["stable", "stable_id", "stable"], ["different", "supplier_code", "supplier"], ["another", "reference_code", "reference"]]);
});

test("duplicate supplier codes are ambiguous and blank codes never false-match", () => {
  const current = draft(); current.pricing.baseModelRows = [priced("a", "DUP", 1), priced("b", "DUP", 2), priced("blank-a", null, 3)];
  const incoming = draft(); incoming.pricing.baseModelRows = [priced("different", "DUP", 4), priced("blank-b", null, 5)];
  const section = compareManufacturerUpdate(workspace(current), incoming).sections.base_model;
  assert.equal(section.ambiguousMatches.length, 1); assert.deepEqual(section.ambiguousMatches[0].candidates.map((item) => item.rowId), ["a", "b"]);
  assert.equal(section.newCandidates.some((item) => item.incoming.rowId === "blank-b"), true);
});

test("a supplier code reused across unresolved groups is ambiguous", () => {
  const current = draft(); current.optionGroups = [{ id: "one", label: "One", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("a", "1AF090", 1)] }, { id: "two", label: "Two", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("b", "1AF090", 2)] }];
  const incoming = draft(); incoming.optionGroups = [{ id: "unknown", label: "Focused", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("incoming", "1AF090", 3)] }];
  assert.equal(compareManufacturerUpdate(workspace(current), incoming).sections.accessory.ambiguousMatches[0].candidates.length, 2);
});

test("Base/Model reports changed and unchanged prices, separate specification differences, and current IDs", () => {
  const current = draft(); current.pricing.baseModelRows = [priced("existing-a", "1AF001", 100, { specification: "Current" }), priced("existing-b", "1AF002", 200)];
  const incoming = draft(); incoming.pricing.baseModelRows = [priced("incoming-a", "1AF001", 110, { specification: "Incoming" }), priced("incoming-b", "1AF002", 200)];
  const matches = compareManufacturerUpdate(workspace(current), incoming).sections.base_model.matchedItems;
  assert.equal(matches[0].existing.rowId, "existing-a"); assert.equal(matches[0].priceFields[0].priceChanged, true);
  assert.equal(matches[0].nonPriceDifferences.some((item) => item.field === "specification"), true); assert.equal(matches[1].priceFields[0].priceChanged, false);
});

test("Workstation compares default and additional prices independently", () => {
  const current = draft(); current.pricing.workstationRows = [workstation("current", "WS-1", 1000, 200)];
  const incoming = draft(); incoming.pricing.workstationRows = [workstation("incoming", "WS-1", 1100, 200)];
  const fields = compareManufacturerUpdate(workspace(current), incoming).sections.workstation.matchedItems[0].priceFields;
  assert.deepEqual(fields.map((field) => [field.field, field.currentValue, field.incomingValue, field.priceChanged]), [["default_price", 1000, 1100, true], ["additional_price", 200, 200, false]]);
});

test("Category/Matrix matches rows and normalized columns without changing order", () => {
  const current = draft(); current.pricing.priceMatrices = [{ id: "finishes", label: "Finishes", columns: [{ id: "current-a", label: "Cat A" }, { id: "current-b", label: "Cat B" }], rows: [matrixRow("current-row", "FIN-1", { "current-a": 0, "current-b": 20 })] }];
  const incoming = draft(); incoming.pricing.priceMatrices = [{ id: "finishes", label: "Finishes", columns: [{ id: "incoming-a", label: "cat_a" }, { id: "incoming-b", label: "CAT B" }], rows: [matrixRow("incoming-row", "FIN-1", { "incoming-a": 10, "incoming-b": 20 })] }];
  const before = structuredClone(current.pricing.priceMatrices[0].columns);
  const result = compareManufacturerUpdate(workspace(current), incoming).sections.category_matrix;
  assert.deepEqual(result.matchedItems[0].priceFields.map((field) => [field.columnId, field.priceChanged]), [["current-a", true], ["current-b", false]]);
  assert.deepEqual(current.pricing.priceMatrices[0].columns, before); assert.equal(result.structuralDifferences.length, 0);
});

test("new, renamed, duplicate, and incompatible matrix columns are structural differences", () => {
  const current = draft(); current.pricing.priceMatrices = [{ id: "matrix", label: "Matrix", columns: [{ id: "a1", label: "Cat A" }, { id: "a2", label: "cat-a" }], rows: [matrixRow("row", "M-1", { a1: 1, a2: 2 })] }];
  const incoming = draft(); incoming.pricing.priceMatrices = [{ id: "matrix", label: "Matrix", columns: [{ id: "new-a", label: "Cat A" }, { id: "new-c", label: "Cat C" }], rows: [matrixRow("other", "M-1", { "new-a": 3, "new-c": 4 })] }];
  const kinds = compareManufacturerUpdate(workspace(current), incoming).sections.category_matrix.structuralDifferences.map((item) => item.kind);
  assert.equal(kinds.includes("column_set_mismatch"), true); assert.equal(kinds.includes("ambiguous_column"), true); assert.equal(kinds.includes("new_column"), true);
});

test("Modular comparison retains group hierarchy and reports incompatible columns", () => {
  const current = draft(); current.pricing.modularGroups = [{ id: "modules", label: "Modules", defaultDimensions: null, defaultSpecification: null, matrix: { id: "modules-matrix", label: "Modules", columns: [{ id: "a", label: "Cat A" }], rows: [matrixRow("existing-module", "MOD-1", { a: 50 })] } }];
  const incoming = draft(); incoming.pricing.modularGroups = [{ id: "modules", label: "Modules", defaultDimensions: null, defaultSpecification: null, matrix: { id: "incoming-matrix", label: "Modules", columns: [{ id: "a2", label: "Cat A" }, { id: "b", label: "Cat B" }], rows: [matrixRow("incoming-module", "MOD-1", { a2: 60, b: 70 })] } }];
  const section = compareManufacturerUpdate(workspace(current), incoming).sections.modular;
  assert.equal(section.matchedItems[0].existing.groupId, "modules"); assert.equal(section.matchedItems[0].existing.rowId, "existing-module");
  assert.equal(section.matchedItems[0].priceFields[0].priceChanged, true); assert.equal(section.structuralDifferences.some((item) => item.kind === "new_column"), true);
});

test("Accessory supplier-code matching preserves current item, subgroup, and rule context", () => {
  const current = draft(); current.optionGroups = [{ id: "service", label: "Service Units", selection: { mode: "required_choose_one", minSelections: 1, maxSelections: 1, defaultItemIds: [] }, items: [priced("abc", "1AF090", 1042, { displayName: "Service Unit W123.6 - Right" })] }];
  const currentWorkspace = workspace(current); currentWorkspace.subgroups = { "option:service": [{ id: "right", subgroup_name: "Right", sort_order: 0, is_active: true, row_ids: ["abc"] }] };
  const route = currentWorkspace.plan.routes[0]; route.accessory = { role: "companion", selection: "required_exactly_one", rules: [{ baseModelGroupId: "desks", baseModelRowId: "desk-a", required: true, allowedItemIds: ["abc"], fixedQuantity: 1 }] };
  const incoming = draft(); incoming.optionGroups = [{ id: "focused", label: "Service Units", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("incoming", "1AF090", 1095)] }];
  const match = compareManufacturerUpdate(currentWorkspace, incoming).sections.accessory.matchedItems[0];
  assert.equal(match.existing.rowId, "abc"); assert.equal(match.existing.subgroupId, "right"); assert.equal(match.context.accessoryRole, "companion"); assert.equal(match.context.applicabilityRuleCount, 1); assert.deepEqual([match.priceFields[0].currentValue, match.priceFields[0].incomingValue], [1042, 1095]);
});

test("single-column matrix prices are not masked by the normalized runtime price field", () => {
  const current = draft(); current.optionGroups = [{ id: "service", label: "Support Service Units", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("current-090", "1AF090", 1042)] }];
  const incoming = draft(); incoming.pricing.priceMatrices = [{ id: "matrix-service", label: "Support Service Units", columns: [{ id: "price", label: "Price" }], rows: [matrixRow("incoming-090", "1AF090", { price: 1095 })] }];
  const field = compareManufacturerUpdate(workspace(current), incoming).sections.accessory.matchedItems[0].priceFields[0];
  assert.deepEqual([field.currentValue, field.incomingValue, field.priceChanged], [1042, 1095, true]);
  assert.equal(field.rowId, "current-090");
});

test("MONOLITH service-unit matrix reconciles to current Accessory destination", () => {
  const current = draft();
  current.optionGroups = [{ id: "saved-service", label: "Support Service Units", selection: { mode: "required_choose_one", minSelections: 1, maxSelections: 1, defaultItemIds: [] }, items: [
    priced("saved-090", "1AF090", 1042, { displayName: "Service Unit 090", specification: "Current" }), priced("saved-091", "1AF091", 1042),
    priced("saved-092", "1AF092", 1329), priced("saved-093", "1AF093", 1329), priced("saved-094", "1AF094", 1667), priced("saved-095", "1AF095", 1667), priced("saved-096", "1AF096", 1007),
  ] }];
  const incoming = draft();
  incoming.pricing.priceMatrices = [{ id: "matrix-service-units", label: "Support Service Units for Executive Desks", columns: [{ id: "price", label: "Price" }], rows: [
    matrixRow("incoming-090", "1AF090", { price: 1095 }, { displayName: "Changed name", specification: "Changed specification" }), matrixRow("incoming-091", "1AF091", { price: 1100 }),
    matrixRow("incoming-092", "1AF092", { price: 1329 }), matrixRow("incoming-093", "1AF093", { price: 1329 }), matrixRow("incoming-094", "1AF094", { price: 1667 }), matrixRow("incoming-095", "1AF095", { price: 1667 }), matrixRow("incoming-097", "1AF097", { price: 1850 }),
  ] }];
  const currentBefore = structuredClone(current); const incomingBefore = structuredClone(incoming);
  const result = compareManufacturerUpdate(workspace(current), incoming); const section = result.sections.accessory;
  assert.deepEqual(section.matchedItems.flatMap((item) => item.priceFields).map((field) => [field.supplierCode, field.currentValue, field.incomingValue, field.priceChanged]), [
    ["1AF090", 1042, 1095, true], ["1AF091", 1042, 1100, true], ["1AF092", 1329, 1329, false], ["1AF093", 1329, 1329, false], ["1AF094", 1667, 1667, false], ["1AF095", 1667, 1667, false],
  ]);
  assert.equal(section.newCandidates[0].incoming.supplierCode, "1AF097");
  assert.equal(section.notFoundInImportedSource[0].supplierCode, "1AF096");
  assert.equal(section.matchedItems[0].nonPriceDifferences.some((difference) => difference.field === "displayName" || difference.field === "specification"), true);
  assert.deepEqual(current, currentBefore); assert.deepEqual(incoming, incomingBefore);
});

test("direct-price desk matrix reconciles to current Base/Model destination and current IDs", () => {
  const current = draft(); current.pricing.baseModelRows = [priced("saved-001", "1AF001", 2265), priced("saved-002", "1AF002", 2420)];
  const incoming = draft(); incoming.pricing.priceMatrices = [{ id: "matrix-executive", label: "Executive Desks", columns: [{ id: "price", label: "Price" }], rows: [matrixRow("incoming-001", "1AF001", { price: 2300 }), matrixRow("incoming-002", "1AF002", { price: 2420 })] }];
  const section = compareManufacturerUpdate(workspace(current), incoming).sections.base_model;
  assert.deepEqual(section.matchedItems.map((item) => [item.existing.rowId, item.priceFields[0].incomingValue, item.priceFields[0].priceChanged]), [["saved-001", 2300, true], ["saved-002", 2420, false]]);
  assert.equal(section.newCandidates.length, 0);
});

test("true category matrices remain matrix pricing and ambiguous group overlap is not auto-routed", () => {
  const currentMatrix = draft(); currentMatrix.pricing.priceMatrices = [{ id: "finishes", label: "Finishes", columns: [{ id: "A", label: "Cat A" }, { id: "B", label: "Cat B" }], rows: [matrixRow("saved-finish", "FIN-1", { A: 10, B: 20 })] }];
  const incomingMatrix = draft(); incomingMatrix.pricing.priceMatrices = [{ id: "incoming-finishes", label: "Finishes", columns: [{ id: "a", label: "Cat A" }, { id: "b", label: "Cat B" }], rows: [matrixRow("incoming-finish", "FIN-1", { a: 11, b: 20 })] }];
  assert.equal(compareManufacturerUpdate(workspace(currentMatrix), incomingMatrix).sections.category_matrix.matchedItems.length, 1);

  const current = draft(); current.pricing.baseModelRows = [priced("desk", "DESK", 1)]; current.optionGroups = [{ id: "accessories", label: "Accessories", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("accessory", "ACC", 2)] }];
  const incoming = draft(); incoming.pricing.priceMatrices = [{ id: "mixed", label: "Direct Price", columns: [{ id: "price", label: "Price" }], rows: [matrixRow("incoming-desk", "DESK", { price: 1 }), matrixRow("incoming-accessory", "ACC", { price: 2 })] }];
  const result = compareManufacturerUpdate(workspace(current), incoming);
  assert.equal(result.sections.accessory.matchedItems.length, 0);
  assert.equal(result.sections.base_model.newCandidates.some((item) => item.incoming.supplierCode === "ACC"), true);
});

test("null and zero remain distinct in both directions", () => {
  const pairs: Array<[number | null, number | null, boolean]> = [[null, 0, true], [0, null, true], [0, 0, false], [null, null, false]];
  pairs.forEach(([currentPrice, incomingPrice, changed], index) => {
    const current = draft(); current.pricing.baseModelRows = [priced(`current-${index}`, `CODE-${index}`, currentPrice)];
    const incoming = draft(); incoming.pricing.baseModelRows = [priced(`incoming-${index}`, `CODE-${index}`, incomingPrice)];
    assert.equal(compareManufacturerUpdate(workspace(current), incoming).sections.base_model.matchedItems[0].priceFields[0].priceChanged, changed);
  });
});

test("same number in a different currency reports currency separately", () => {
  const current = draft(); current.pricing.baseModelRows = [priced("current", "CUR-1", 100, { currency: "EUR" })];
  const incoming = draft(); incoming.pricing.baseModelRows = [priced("incoming", "CUR-1", 100, { currency: "USD" })];
  const match = compareManufacturerUpdate(workspace(current), incoming).sections.base_model.matchedItems[0];
  assert.equal(match.priceFields[0].priceChanged, false); assert.equal(match.priceFields[0].currencyChanged, true); assert.equal(match.nonPriceDifferences.some((item) => item.field === "currency"), true);
});

test("unmatched incoming rows are new candidates and scoped current omissions are not-found", () => {
  const current = draft(); current.optionGroups = [{ id: "service", label: "Service", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("present", "1AF090", 1), priced("omitted", "1AF096", 2)] }];
  const incoming = draft(); incoming.optionGroups = [{ id: "service", label: "Service", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("incoming-present", "1AF090", 3), priced("new", "1AF099", 4)] }];
  const section = compareManufacturerUpdate(workspace(current), incoming).sections.accessory;
  assert.equal(section.newCandidates[0].incoming.supplierCode, "1AF099"); assert.equal(section.notFoundInImportedSource[0].existing.rowId, "omitted"); assert.equal(section.notFoundInImportedSource[0].meaning, "not represented in this incoming JSON");
  assert.equal(section.notFoundInImportedSource.some((item) => item.existing.rowId === "present"), false);
});

test("partial accessory input does not mark unrelated pricing sections not-found", () => {
  const current = draft(); current.pricing.baseModelRows = [priced("desk", "DESK", 100)]; current.optionGroups = [{ id: "accessories", label: "Accessories", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("accessory", "ACC", 10)] }];
  const incoming = draft(); incoming.optionGroups = [{ id: "accessories", label: "Accessories", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [priced("incoming", "ACC", 12)] }];
  const result = compareManufacturerUpdate(workspace(current), incoming);
  assert.equal(result.sections.base_model.notFoundInImportedSource.length, 0); assert.equal(result.sections.accessory.notFoundInImportedSource.length, 0);
});

test("summary counts fields deterministically without double-counting items and defers materials", () => {
  const current = draft(); current.pricing.workstationRows = [{ ...workstation("current", "WS", 1, 2), label: "WS", displayName: "WS" }];
  const incoming = draft(); incoming.pricing.workstationRows = [{ ...workstation("incoming", "WS", 3, 2), label: "WS", displayName: "WS" }]; incoming.materialSuggestions = [{ id: "wood", label: "Wood", notes: null, supplierCodes: [], referenceCodes: [] }];
  const result = compareManufacturerUpdate(workspace(current), incoming);
  assert.deepEqual(result.summary, { matchedItems: 1, changedPriceFields: 1, unchangedPriceFields: 1, newCandidates: 0, notFoundInImportedSource: 0, ambiguousMatches: 0, nonPriceDifferences: 0, structuralDifferences: 0 });
  assert.deepEqual(result.deferredSections.map((item) => [item.section, item.count]), [["materials", 1]]);
});
