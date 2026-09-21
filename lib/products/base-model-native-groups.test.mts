import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_BASE_MODEL_GROUP_ID, normalizeBaseModelPricing, type BaseModelPricingGroup } from "./base-model-pricing-groups.js";
import { assignBaseModelRowToSubgroup } from "./base-model-pricing-subgroups.js";
import { normalizeProductTemplateDraft, type ProductTemplateDraft, type ProductTemplateDraftBaseModelRow } from "./product-template-draft.js";
import { mapDraftBaseModelPricing } from "./product-template-draft-base-model-adapter.js";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace.js";
import { applySmartAdditionalJson, smartAdditionalJsonGroups, type SmartAdditionalGroupDecision } from "./smart-product-additional-json.js";
import { inferBaseModelVisualSubgroups } from "./smart-product-base-model-auto-subgroups.js";
import { createSmartSetupReviewRouting, draftForSmartSetupReviewApply, validateSmartSetupReviewRouting } from "./smart-product-review-routing.js";
import { canonicalSubgroupsForSmartSetupApply } from "./smart-product-row-images.js";
import { draftBaseModelGroupRows, draftUngroupedBaseModelRows } from "./base-model-draft-groups.js";
import { structuralSupportReviewBaseModelGroups } from "./structural-support-compatibility.js";

const rawRow = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, displayName: `Model ${id}`, price: 100, currency: "AED", supplierCodes: [`SC-${id}`], referenceCodes: [], ...extra });
const rawDraft = (baseModelRows: Record<string, unknown>[], priceMatrices: Record<string, unknown>[] = []) => ({
  version: 1, template: { templateName: "Family" }, defaultCurrency: "AED",
  pricing: { workstationRows: [], baseModelRows, priceMatrices, modularGroups: [] },
  optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 0.9, sources: [],
});
const normalized = (rows: Record<string, unknown>[], matrices: Record<string, unknown>[] = []) => {
  const result = normalizeProductTemplateDraft(rawDraft(rows, matrices));
  assert.ok(result.draft, JSON.stringify(result.errors));
  return { draft: result.draft as ProductTemplateDraft, errors: result.errors };
};
const grouped = () => normalized([
  rawRow("a-base", { groupId: "system-a", groupLabel: "System A", role: "system_base" }),
  rawRow("a1-1", { groupId: "system-a", groupLabel: "System A", displayName: "Desk A1 - 120" }),
  rawRow("a1-2", { groupId: "system-a", displayName: "Desk A1 - 140" }),
  rawRow("b-base", { groupId: "system-b", groupLabel: "System B", role: "system_base" }),
  rawRow("b1-1", { groupId: "system-b", displayName: "Desk B1" }),
  rawRow("flat-1"),
]).draft;
const decision = (action: SmartAdditionalGroupDecision["action"], targetKey: string | null = null): SmartAdditionalGroupDecision => ({ action, destination: "base_model", targetKey, duplicateChoices: {} });

// ---- draft normalization ----
test("old baseModelRows without groupId are unchanged", () => {
  const { draft, errors } = normalized([rawRow("m1")]);
  assert.equal(errors.length, 0);
  assert.equal("groupId" in draft.pricing.baseModelRows[0], false);
  assert.equal("role" in draft.pricing.baseModelRows[0], false);
});

test("groupId/groupLabel preserved, blank groupId omitted, groupLabel without groupId dropped", () => {
  const { draft } = normalized([rawRow("m1", { groupId: " system-a ", groupLabel: " System A " }), rawRow("m2", { groupId: "  ", groupLabel: "Orphan" })]);
  assert.equal(draft.pricing.baseModelRows[0].groupId, "system-a");
  assert.equal(draft.pricing.baseModelRows[0].groupLabel, "System A");
  assert.equal("groupId" in draft.pricing.baseModelRows[1], false);
  assert.equal("groupLabel" in draft.pricing.baseModelRows[1], false);
});

test("explicit legacy groupId is rejected", () => {
  const result = normalizeProductTemplateDraft(rawDraft([rawRow("m1", { groupId: LEGACY_BASE_MODEL_GROUP_ID })]));
  assert.ok(result.errors.some((issue) => issue.path.endsWith(".groupId")));
});

test("system_base role preserved and unsupported role rejected", () => {
  const ok = normalized([rawRow("m1", { role: "system_base" })]);
  assert.equal(ok.draft.pricing.baseModelRows[0].role, "system_base");
  const bad = normalizeProductTemplateDraft(rawDraft([rawRow("m1", { role: "main_product" })]));
  assert.ok(bad.errors.some((issue) => issue.path.endsWith(".role")));
  assert.equal(bad.valid, false);
});

test("same groupId with consistent label is valid; conflicting labels report an issue without creating another group", () => {
  const consistent = normalized([rawRow("m1", { groupId: "g", groupLabel: "G" }), rawRow("m2", { groupId: "g", groupLabel: "G" })]);
  assert.equal(consistent.errors.length, 0);
  const conflicting = normalizeProductTemplateDraft(rawDraft([rawRow("m1", { groupId: "g", groupLabel: "G" }), rawRow("m2", { groupId: "g", groupLabel: "Other" })]));
  assert.ok(conflicting.errors.some((issue) => issue.message.includes("conflicting labels")));
  assert.equal(conflicting.valid, false);
  assert.equal(conflicting.errors.filter((issue) => issue.message.includes("conflicting labels")).length, 1);
});

// ---- routing ----
test("one base_model_group route per groupId; flat rows keep base_model:rows and coexist", () => {
  const plan = createSmartSetupReviewRouting(grouped());
  const groupRoutes = plan.routes.filter((route) => route.sourceKind === "base_model_group");
  assert.deepEqual(groupRoutes.map((route) => route.key), ["base_model_group:system-a", "base_model_group:system-b"]);
  assert.deepEqual(groupRoutes.map((route) => route.sourceId), ["system-a", "system-b"]);
  assert.deepEqual(groupRoutes.map((route) => route.groupName), ["System A", "System B"]);
  assert.deepEqual(groupRoutes.map((route) => route.rowCount), [3, 2]);
  assert.ok(groupRoutes.every((route) => route.destination === "base_model"));
  const flat = plan.routes.find((route) => route.key === "base_model:rows");
  assert.equal(flat?.sourceKind, "base_model");
  assert.equal(flat?.rowCount, 1);
});

test("flat-only drafts keep only base_model:rows; grouped-only drafts create no flat route", () => {
  assert.deepEqual(createSmartSetupReviewRouting(normalized([rawRow("m1")]).draft).routes.map((route) => route.key), ["base_model:rows"]);
  const onlyGrouped = normalized([rawRow("m1", { groupId: "g" })]).draft;
  assert.deepEqual(createSmartSetupReviewRouting(onlyGrouped).routes.map((route) => route.key), ["base_model_group:g"]);
  assert.equal(createSmartSetupReviewRouting(onlyGrouped).routes[0].groupName, "g");
});

test("route row helpers return exact group rows only and never all rows", () => {
  const draft = grouped();
  assert.deepEqual(draftBaseModelGroupRows(draft.pricing, "system-a").map((row) => row.id), ["a-base", "a1-1", "a1-2"]);
  assert.deepEqual(draftBaseModelGroupRows(draft.pricing, "system-b").map((row) => row.id), ["b-base", "b1-1"]);
  assert.deepEqual(draftUngroupedBaseModelRows(draft.pricing).map((row) => row.id), ["flat-1"]);
  assert.deepEqual(draftBaseModelGroupRows(draft.pricing, "missing"), []);
});

test("routeRowIds via canonical subgroups only covers the exact group", () => {
  const draft = grouped();
  const plan = createSmartSetupReviewRouting(draft);
  const applied = canonicalSubgroupsForSmartSetupApply(draft, plan, {
    "base_model_group:system-a": [{ id: "s", subgroup_name: "A1", sort_order: 0, is_active: true, row_ids: ["a1-1", "b1-1", "flat-1"] }],
  });
  assert.equal(applied.length, 1);
  assert.equal(applied[0].groupId, "system-a");
  assert.deepEqual(applied[0].subgroups[0].row_ids, ["a1-1"]);
});

test("routing validation reports a native group id colliding with a Base/Model matrix", () => {
  const matrix = { id: "system-a", label: "Colliding", columns: [{ id: "price", label: "Price" }], rows: [{ id: "mx-1", label: "mx", displayName: "mx", price: 1, prices: { price: 1 }, supplierCodes: [], referenceCodes: [] }] };
  const draft = normalized([rawRow("a1", { groupId: "system-a" })], [matrix]).draft;
  const plan = createSmartSetupReviewRouting(draft);
  const matrixRoute = plan.routes.find((route) => route.key === "matrix:system-a");
  if (matrixRoute) matrixRoute.destination = "base_model";
  assert.ok(validateSmartSetupReviewRouting(draft, plan).errors.some((message) => message.includes("same group id")));
});

// ---- adapter ----
test("native groups map to persisted BaseModelPricingGroups with role, order and legacy rows unchanged", () => {
  const draft = grouped();
  const result = mapDraftBaseModelPricing(draft);
  assert.deepEqual(result.rows.map((row) => row.id), ["flat-1"]);
  assert.deepEqual(result.groups.map((group) => [group.id, group.group_name, group.sort_order]), [["system-a", "System A", 1], ["system-b", "System B", 2]]);
  assert.deepEqual(result.groups[0].items.map((row) => row.id), ["a-base", "a1-1", "a1-2"]);
  assert.equal((result.groups[0].items[0] as { role?: string }).role, "system_base");
  assert.equal("role" in result.groups[0].items[1], false);
  assert.equal(result.groups[0].items[1].supplier_price_list_code, "SC-a1-1");
  assert.equal(result.groups[0].items[1].price, 100);
  assert.equal(result.groups[0].pricing_type, "base_model_group");
});

test("group sort follows first appearance and grouped-only drafts have no legacy rows", () => {
  const draft = normalized([rawRow("b1", { groupId: "b" }), rawRow("a1", { groupId: "a" }), rawRow("b2", { groupId: "b" })]).draft;
  const result = mapDraftBaseModelPricing(draft);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.groups.map((group) => [group.id, group.sort_order]), [["b", 0], ["a", 1]]);
  assert.deepEqual(result.groups[0].items.map((row) => row.id), ["b1", "b2"]);
});

test("native group id colliding with a matrix routed to Base/Model is not silently merged", () => {
  const matrix = { id: "system-a", label: "Colliding", columns: [{ id: "price", label: "Price" }], rows: [{ id: "mx-1", label: "mx", displayName: "mx", price: 1, prices: { price: 1 }, supplierCodes: [], referenceCodes: [] }] };
  const draft = normalized([rawRow("a1", { groupId: "system-a" })], [matrix]).draft;
  const result = mapDraftBaseModelPricing(draft, { "system-a": "base_model" });
  assert.equal(result.groups.filter((group) => group.id === "system-a").length, 1);
  assert.deepEqual(result.groups[0].items.map((row) => row.id), ["a1"]);
  assert.ok(result.warnings.some((warning) => warning.includes("collides")));
});

test("apply uses the edited route group name and drops skipped group routes", () => {
  const draft = grouped();
  const plan = createSmartSetupReviewRouting(draft);
  plan.routes.find((route) => route.key === "base_model_group:system-a")!.groupName = "Renamed A";
  plan.routes.find((route) => route.key === "base_model_group:system-b")!.destination = "skip";
  const applied = draftForSmartSetupReviewApply(draft, plan);
  assert.deepEqual(applied.pricing.baseModelRows.map((row) => row.id), ["a-base", "a1-1", "a1-2", "flat-1"]);
  const result = mapDraftBaseModelPricing(applied);
  assert.deepEqual(result.groups.map((group) => group.group_name), ["Renamed A"]);
  assert.deepEqual(result.rows.map((row) => row.id), ["flat-1"]);
});

// ---- subgroups ----
test("system_base is excluded from auto-subgroups, manual assignment and canonical Apply subgroups", () => {
  const rows = [
    { id: "s1", label: null, displayName: "Base X - 100", role: "system_base" },
    { id: "s2", label: null, displayName: "Base X - 120", role: "system_base" },
    { id: "m1", label: null, displayName: "Desk P - 120" },
    { id: "m2", label: null, displayName: "Desk P - 140" },
  ];
  const inferred = inferBaseModelVisualSubgroups(rows);
  assert.deepEqual(inferred.map((subgroup) => subgroup.row_ids), [["m1", "m2"]]);

  const group: BaseModelPricingGroup = { id: "g", pricing_type: "base_model_group", group_name: "G", is_active: true, sort_order: 0, items: [{ id: "s1", role: "system_base" }, { id: "m1" }], subgroups: [{ id: "sg", subgroup_name: "Main", sort_order: 0, is_active: true, row_ids: [] }] };
  assert.deepEqual(assignBaseModelRowToSubgroup(group, "s1", "sg").subgroups?.[0].row_ids, []);
  assert.deepEqual(assignBaseModelRowToSubgroup(group, "m1", "sg").subgroups?.[0].row_ids, ["m1"]);

  const draft = grouped();
  const plan = createSmartSetupReviewRouting(draft);
  const applied = canonicalSubgroupsForSmartSetupApply(draft, plan, { "base_model_group:system-a": [{ id: "sg", subgroup_name: "A1", sort_order: 0, is_active: true, row_ids: ["a-base", "a1-1"] }] });
  assert.deepEqual(applied[0].subgroups[0].row_ids, ["a1-1"]);
});

test("persisted system_base subgroup membership produces a clear issue; identical subgroup ids in different groups stay valid", () => {
  const sub = (rowIds: string[]) => ({ id: "auto-desk", subgroup_name: "Desk", sort_order: 0, is_active: true, row_ids: rowIds });
  const result = normalizeBaseModelPricing([
    { id: "g1", pricing_type: "base_model_group", group_name: "G1", is_active: true, sort_order: 0, items: [{ id: "s", role: "system_base" }, { id: "m1" }], subgroups: [sub(["s", "m1"])] },
    { id: "g2", pricing_type: "base_model_group", group_name: "G2", is_active: true, sort_order: 1, items: [{ id: "m2" }], subgroups: [sub(["m2"])] },
  ]);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["system_row_in_subgroup"]);
  assert.deepEqual(result.groups[0].subgroups?.[0].row_ids, ["m1"]);
  assert.deepEqual(result.groups[1].subgroups?.[0].row_ids, ["m2"]);
});

// ---- reopen ----
test("persisted native group reopens as grouped baseModelRows with role, label, subgroups and route key", () => {
  const subgroup = { id: "sg", subgroup_name: "A1", sort_order: 0, is_active: true, row_ids: ["a1-1"] };
  const workspace = productTemplateFormSmartWorkspace({
    variant_pricing: JSON.stringify([
      { id: "system-a", pricing_type: "base_model_group", group_name: "System A", is_active: true, sort_order: 0, subgroups: [subgroup], items: [{ id: "a-base", variant_name: "Base", role: "system_base", price: 500, currency: "AED" }, { id: "a1-1", variant_name: "A1", price: 100, currency: "AED" }] },
    ]),
    desking_size_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]",
  });
  const rows = workspace.draft.pricing.baseModelRows as ProductTemplateDraftBaseModelRow[];
  assert.deepEqual(rows.map((row) => [row.id, row.groupId, row.groupLabel, row.role]), [["a-base", "system-a", "System A", "system_base"], ["a1-1", "system-a", "System A", undefined]]);
  assert.equal(workspace.draft.pricing.priceMatrices.length, 0);
  assert.deepEqual(workspace.subgroups["base_model_group:system-a"], [subgroup]);
  assert.equal(workspace.plan.routes[0].key, "base_model_group:system-a");
  // Round trip: reopened draft applies back to the same persisted group id, label and role.
  const again = mapDraftBaseModelPricing(workspace.draft);
  assert.equal(again.groups[0].id, "system-a");
  assert.equal(again.groups[0].group_name, "System A");
  assert.equal((again.groups[0].items[0] as { role?: string }).role, "system_base");
});

test("legacy flat rows reopen as ordinary ungrouped draft rows", () => {
  const workspace = productTemplateFormSmartWorkspace({
    variant_pricing: JSON.stringify([{ id: "legacy-row", variant_name: "Legacy", price: 10, currency: "AED" }]),
    desking_size_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]",
  });
  const row = workspace.draft.pricing.baseModelRows[0] as ProductTemplateDraftBaseModelRow;
  assert.equal(row.id, "legacy-row");
  assert.equal(row.groupId, undefined);
  assert.equal(workspace.plan.routes[0].key, "base_model:rows");
});

// ---- Add More JSON ----
test("same groupId merges only that group; other groups and flat rows are untouched; label and group are preserved", () => {
  const current = grouped();
  const plan = createSmartSetupReviewRouting(current);
  const incoming = normalized([
    rawRow("a1-3", { groupId: "system-a", groupLabel: "Different Label", displayName: "Desk A1 - 160" }),
    // duplicate by supplier code of an existing System A row, incoming claims another group
    rawRow("a1-1-dup", { groupId: "system-b", supplierCodes: ["SC-a1-1"], price: 999 }),
  ]).draft;
  const groups = smartAdditionalJsonGroups(current, plan, incoming);
  const routeA = groups.find((group) => group.route.key === "base_model_group:system-a")!;
  assert.equal(routeA.match.recommendedAction, "merge");
  assert.equal(routeA.match.bestMatch?.key, "base_model_group:system-a");

  const result = applySmartAdditionalJson(current, plan, incoming, {
    "base_model_group:system-a": decision("merge", "base_model_group:system-a"),
    "base_model_group:system-b": decision("merge", "base_model_group:system-a"),
  });
  const rows = result.draft.pricing.baseModelRows;
  assert.deepEqual(draftBaseModelGroupRows(result.draft.pricing, "system-b").map((row) => row.id), ["b-base", "b1-1"]);
  assert.deepEqual(draftUngroupedBaseModelRows(result.draft.pricing).map((row) => row.id), ["flat-1"]);
  assert.deepEqual(draftBaseModelGroupRows(result.draft.pricing, "system-a").map((row) => row.id), ["a-base", "a1-1", "a1-2", "a1-3"]);
  assert.ok(rows.filter((row) => row.groupId === "system-a").every((row) => row.groupLabel === "System A"));
  // duplicate kept the existing commercial row and did not move groups
  assert.equal(rows.find((row) => row.id === "a1-1")?.price, 100);
  assert.equal(rows.find((row) => row.id === "a1-1")?.groupId, "system-a");
  assert.equal(rows.filter((row) => row.id === "a1-1-dup").length, 0);
  assert.equal(result.plan.routes.find((route) => route.key === "base_model_group:system-a")?.rowCount, 4);
  assert.deepEqual(result.addedRowsByTarget["base_model_group:system-a"], ["a1-3"]);
});

test("new groupId appends a new group route; role survives; existing groups and flat rows untouched", () => {
  const current = grouped();
  const plan = createSmartSetupReviewRouting(current);
  const incoming = normalized([rawRow("c-base", { groupId: "system-c", groupLabel: "System C", role: "system_base" }), rawRow("c1", { groupId: "system-c" })]).draft;
  const result = applySmartAdditionalJson(current, plan, incoming, { "base_model_group:system-c": decision("add") });
  assert.deepEqual(draftBaseModelGroupRows(result.draft.pricing, "system-c").map((row) => [row.id, row.role, row.groupLabel]), [["c-base", "system_base", "System C"], ["c1", undefined, "System C"]]);
  assert.deepEqual(draftBaseModelGroupRows(result.draft.pricing, "system-a").map((row) => row.id), ["a-base", "a1-1", "a1-2"]);
  assert.deepEqual(draftUngroupedBaseModelRows(result.draft.pricing).map((row) => row.id), ["flat-1"]);
  const route = result.plan.routes.find((item) => item.key === "base_model_group:system-c");
  assert.equal(route?.sourceKind, "base_model_group");
  assert.equal(route?.rowCount, 2);
});

test("flat merge does not touch grouped rows", () => {
  const current = grouped();
  const plan = createSmartSetupReviewRouting(current);
  const incoming = normalized([rawRow("flat-2")]).draft;
  const result = applySmartAdditionalJson(current, plan, incoming, { "base_model:rows": decision("merge", "base_model:rows") });
  assert.deepEqual(draftUngroupedBaseModelRows(result.draft.pricing).map((row) => row.id), ["flat-1", "flat-2"]);
  assert.equal(draftBaseModelGroupRows(result.draft.pricing, "system-a").length, 3);
  assert.equal(draftBaseModelGroupRows(result.draft.pricing, "system-b").length, 2);
});

// ---- structural support compatibility helper ----
test("structural support review groups include native groups and only that group's rows", () => {
  const draft = grouped();
  const plan = createSmartSetupReviewRouting(draft);
  const groups = structuralSupportReviewBaseModelGroups(draft.pricing, plan.routes, {});
  assert.deepEqual(groups.map((group) => [group.id, group.items.map((item) => item.id)]), [
    [LEGACY_BASE_MODEL_GROUP_ID, ["flat-1"]],
    ["system-a", ["a-base", "a1-1", "a1-2"]],
    ["system-b", ["b-base", "b1-1"]],
  ]);
});

// ---- regression: matrix -> Base/Model routing unchanged ----
test("price matrix routed to Base/Model still becomes a matrix group with unchanged ids", () => {
  const matrix = { id: "executive", label: "Executive", columns: [{ id: "price", label: "Price" }], rows: [{ id: "mx-1", label: "mx", displayName: "mx", price: 5, prices: { price: 5 }, supplierCodes: [], referenceCodes: [] }] };
  const draft = normalized([rawRow("flat")], [matrix]).draft;
  const result = mapDraftBaseModelPricing(draft, { executive: "base_model" });
  assert.deepEqual(result.groups.map((group) => group.id), ["executive"]);
  assert.equal(result.groups[0].sort_order, 1);
  assert.deepEqual(result.rows.map((row) => row.id), ["flat"]);
});
