import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nativeFamiliesSummaryLabel, nativeSystemGroupSummary } from "./base-model-draft-groups.js";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import { createSmartSetupReviewRouting, draftForSmartSetupReviewApply, orderItemsByRoute, reorderSmartSetupReviewRoutesWithinKind, smartRouteMoveState, type SmartReviewRoute, type SmartSetupReviewRoutingPlan } from "./smart-product-review-routing.js";
import { sourceCropTargets, sourceQaTextGeometry, sourceQaTextGeometryMatch, sourceQaTextGeometryViewport } from "./source-qa-crop.js";

// ---- Change 1: collapsible Main Product Families ----
const component = readFileSync("components/products/smart-product-json-import.tsx", "utf8");

test("1: native Main Product Families default to collapsed and can be shown/hidden", () => {
  assert.ok(component.includes("const [familiesOpen, setFamiliesOpen] = useState(false);"));
  assert.ok(component.includes("aria-expanded={familiesOpen} onClick={() => setFamiliesOpen((current) => !current)}"));
  assert.ok(component.includes('{familiesOpen ? "Hide" : "Show"}'));
});

test("2-3: collapsed summary shows family count and Main model count (system rows excluded)", () => {
  const rows = [{ id: "sys", role: "system_base" }, { id: "a" }, { id: "b" }, { id: "c" }];
  const subgroups = [{ id: "f1", is_active: true, row_ids: ["a", "b"] }, { id: "f2", is_active: true, row_ids: ["c"] }];
  assert.equal(nativeFamiliesSummaryLabel(nativeSystemGroupSummary(rows, subgroups)), "2 families · 3 models");
  assert.equal(nativeFamiliesSummaryLabel({ familyCount: 1, mainCount: 1 }), "1 family · 1 model");
});

test("4-7: expanding keeps Add family, family cards and subgroup data; collapsing only hides", () => {
  assert.ok(component.includes('hidden={native && !familiesOpen}'), "Add family is hidden only while collapsed");
  assert.ok(component.includes('${native && !familiesOpen ? " hidden" : ""}'), "family list is hidden (not removed) while collapsed");
  const subgroups = [{ id: "f1", is_active: true, row_ids: ["a"] }];
  const before = JSON.stringify(subgroups);
  nativeSystemGroupSummary([{ id: "a" }], subgroups);
  assert.equal(JSON.stringify(subgroups), before);
  assert.ok(component.includes("Edit models") && component.includes("+ Add family"));
});

// ---- Change 2: global group ordering ----
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, displayName: id, label: null, price: 1, currency: "AED", supplierCodes: [`C-${id}`], referenceCodes: [], ...extra });
const matrix = (id: string) => ({ id, label: id, columns: [{ id: "a", label: "A" }, { id: "b", label: "B" }], rows: [{ id: `${id}-r`, label: id, displayName: id, supplierCodes: [`M-${id}`], referenceCodes: [], prices: { a: 1, b: 2 } }] });
const option = (id: string) => ({ id, label: id, selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [row(`${id}-i`)] });
const draftWith = () => {
  const result = normalizeProductTemplateDraft({
    version: 1, template: { templateName: "T" }, defaultCurrency: "AED",
    pricing: { workstationRows: [], baseModelRows: [row("a1", { groupId: "comby", groupLabel: "COMBY" }), row("a2", { groupId: "comby", groupLabel: "COMBY" }), row("b1", { groupId: "p58", groupLabel: "P58" })], priceMatrices: [matrix("m1"), matrix("m2")], modularGroups: [] },
    optionGroups: [option("o1"), option("o2")], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 1, sources: [],
  });
  assert.ok(result.draft, JSON.stringify(result.errors));
  return result.draft as ProductTemplateDraft;
};
const keys = (plan: SmartSetupReviewRoutingPlan) => plan.routes.map((route) => route.key);

test("8-10: Base/Model native groups and accessory groups can move up/down within their kind", () => {
  const plan = createSmartSetupReviewRouting(draftWith());
  const moved = reorderSmartSetupReviewRoutesWithinKind(plan, "base_model_group:p58", "up");
  assert.ok(keys(moved).indexOf("base_model_group:p58") < keys(moved).indexOf("base_model_group:comby"));
  const back = reorderSmartSetupReviewRoutesWithinKind(moved, "base_model_group:p58", "down");
  assert.deepEqual(keys(back), keys(plan));
  const options = reorderSmartSetupReviewRoutesWithinKind(plan, "option:o2", "up");
  assert.ok(keys(options).indexOf("option:o2") < keys(options).indexOf("option:o1"));
});

test("11: Matrix / Modular / Workstation routes reorder only among their own kind", () => {
  const route = (key: string, sourceKind: SmartReviewRoute["sourceKind"]): SmartReviewRoute => ({ key, sourceId: key, sourceKind, sourceName: key, groupName: key, rowCount: 1, columnCount: null, recommendedDestination: "modular", destination: "modular", supportedDestinations: ["modular", "skip"] });
  const plan: SmartSetupReviewRoutingPlan = { routes: [route("workstation:rows", "workstation"), route("modular:x", "modular"), route("matrix:m", "matrix"), route("modular:y", "modular")] };
  assert.deepEqual(keys(reorderSmartSetupReviewRoutesWithinKind(plan, "modular:y", "up")), ["workstation:rows", "modular:y", "matrix:m", "modular:x"]);
  assert.deepEqual(smartRouteMoveState(plan, "workstation:rows"), { canMoveUp: false, canMoveDown: false });
  assert.deepEqual(keys(reorderSmartSetupReviewRoutesWithinKind(plan, "matrix:m", "up")), keys(plan));
});

test("12-13: first group cannot move up, last cannot move down, middle can do both", () => {
  const plan = createSmartSetupReviewRouting(draftWith());
  assert.deepEqual(smartRouteMoveState(plan, "base_model_group:comby"), { canMoveUp: false, canMoveDown: true });
  assert.deepEqual(smartRouteMoveState(plan, "base_model_group:p58"), { canMoveUp: true, canMoveDown: false });
  assert.deepEqual(reorderSmartSetupReviewRoutesWithinKind(plan, "base_model_group:comby", "up"), plan);
  assert.deepEqual(reorderSmartSetupReviewRoutesWithinKind(plan, "base_model_group:p58", "down"), plan);
  const three = { routes: [...plan.routes, { ...plan.routes.find((item) => item.key === "option:o1")!, key: "option:o3", sourceId: "o3" }] };
  assert.deepEqual(smartRouteMoveState(three, "option:o2"), { canMoveUp: true, canMoveDown: true });
});

test("14: reordering preserves route identity, ids and data", () => {
  const draft = draftWith();
  const plan = createSmartSetupReviewRouting(draft);
  const moved = reorderSmartSetupReviewRoutesWithinKind(plan, "base_model_group:p58", "up");
  const byKey = (list: SmartSetupReviewRoutingPlan) => Object.fromEntries(list.routes.map((item) => [item.key, item]));
  assert.deepEqual(byKey(moved), byKey(plan));
  assert.equal(JSON.stringify(draft), JSON.stringify(draftWith()));
});

test("15: Apply output follows the reviewed order (native groups, matrices, accessories)", () => {
  const draft = draftWith();
  let plan = createSmartSetupReviewRouting(draft);
  plan = reorderSmartSetupReviewRoutesWithinKind(plan, "base_model_group:p58", "up");
  plan = reorderSmartSetupReviewRoutesWithinKind(plan, "matrix:m2", "up");
  plan = reorderSmartSetupReviewRoutesWithinKind(plan, "option:o2", "up");
  const applied = draftForSmartSetupReviewApply(draft, plan);
  assert.deepEqual(applied.pricing.baseModelRows.map((entry) => entry.id), ["b1", "a1", "a2"]);
  assert.deepEqual(applied.pricing.priceMatrices.map((entry) => entry.id), ["m2", "m1"]);
  assert.deepEqual(applied.optionGroups.map((entry) => entry.id), ["o2", "o1"]);
  assert.deepEqual(orderItemsByRoute(draft.pricing.priceMatrices, (item) => `matrix:${item.id}`, plan).map((entry) => [entry.item.id, entry.index]), [["m2", 1], ["m1", 0]]);
});

// ---- Change 3: PDF search highlight ----
const item = (str: string, x: number, width: number, y = 400) => ({ str, transform: [1, 0, 0, 1, x, y], width, height: 10 });

test("16: a search result creates an active highlight even when the code shares its text item with a marker", () => {
  const geometry = sourceQaTextGeometry([item("1AJ M45 (*)", 100, 110)]);
  const match = sourceQaTextGeometryMatch(geometry, "1AJ M45");
  assert.ok(match, "1AJ M45 must be highlighted inside the '1AJ M45 (*)' text item");
  assert.equal(match!.x, 100);
  assert.equal(Math.round(match!.width), 70); // 7 of 11 characters
});

test("17-18: next/previous match resolve the highlight on each page's own geometry", () => {
  const page1 = sourceQaTextGeometry([item("1AJ M45 (*)", 100, 110, 500)]);
  const page2 = sourceQaTextGeometry([item("1AJ M45", 300, 70, 200)]);
  assert.equal(sourceQaTextGeometryMatch(page1, "1AJ M45")?.y, 500);
  assert.equal(sourceQaTextGeometryMatch(page2, "1AJ M45")?.x, 300);
  assert.equal(sourceQaTextGeometryMatch(page2, "1AJ M46"), null);
});

test("19-20: zoom and Fit width scale the highlight position with the viewport", () => {
  const match = sourceQaTextGeometryMatch(sourceQaTextGeometry([item("1AJ M45 (*)", 100, 110)]), "1AJ M45")!;
  const at1 = sourceQaTextGeometryViewport(match, 600, 1);
  const at15 = sourceQaTextGeometryViewport(match, 600, 1.5); // Fit width simply sets a different zoom value
  assert.equal(at15.x, at1.x * 1.5);
  assert.equal(at15.width, at1.width * 1.5);
  assert.equal(at15.height, at1.height * 1.5);
});

test("21: a different page or search replaces (never keeps) a stale highlight; unmatched text clears it", () => {
  assert.equal(sourceQaTextGeometryMatch(sourceQaTextGeometry([item("Other text", 10, 50)]), "1AJ M45"), null);
  const viewer = readFileSync("components/products/source-qa-crop-viewer.tsx", "utf8");
  assert.ok(viewer.includes("setHighlight(sourceQaTextGeometryMatch(sourceQaTextGeometry(items), search))"));
  assert.ok(viewer.includes("}, [page, search, storagePath, zoom]);"));
});

test("code boundaries: M45 is never highlighted inside M450", () => {
  assert.equal(sourceQaTextGeometryMatch(sourceQaTextGeometry([item("1AJ M450", 10, 80)]), "1AJ M45"), null);
});

test("22-23: native grouped and ordinary Base/Model crop targets both resolve a highlightable code", () => {
  const result = normalizeProductTemplateDraft({
    version: 1, template: { templateName: "T" }, defaultCurrency: "AED",
    pricing: { workstationRows: [], baseModelRows: [row("n1", { groupId: "comby", supplierCodes: ["1AJ M45"] }), row("f1", { supplierCodes: ["1AJ M46"] })], priceMatrices: [], modularGroups: [] },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 1, sources: [],
  });
  const targets = sourceCropTargets(result.draft as ProductTemplateDraft);
  const geometry = sourceQaTextGeometry([item("1AJ M45 (*)", 100, 110), item("1AJ M46 (*)", 100, 110, 300)]);
  assert.equal(sourceQaTextGeometryMatch(geometry, targets.find((target) => target.rowId === "n1")!.codes[0])?.y, 400);
  assert.equal(sourceQaTextGeometryMatch(geometry, targets.find((target) => target.rowId === "f1")!.codes[0])?.y, 300);
});

test("24: the highlight overlay never intercepts crop drag selection", () => {
  const viewer = readFileSync("components/products/source-qa-crop-viewer.tsx", "utf8");
  assert.ok(viewer.includes('data-source-qa-highlight'));
  assert.ok(viewer.includes("position:absolute;pointer-events:none;"));
});
