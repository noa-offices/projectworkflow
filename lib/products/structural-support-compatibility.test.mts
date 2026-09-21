import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_BASE_MODEL_GROUP_ID, type BaseModelPricingGroup } from "./base-model-pricing-groups.js";
import {
  collapseStructuralSupportSelection,
  expandStructuralSupportSelection,
  filterCompatibleBaseModelGroups,
  structuralSupportReviewBaseModelGroups,
  structuralSupportUnresolvedCompatibility,
  unionStructuralSupportCompatibleTargets,
} from "./structural-support-compatibility.js";

function row(id: string) {
  return { id, display_name: id, price: 100, is_active: true };
}

function groups(): BaseModelPricingGroup[] {
  return [
    {
      id: "grp-1", pricing_type: "base_model_group", group_name: "Family A", is_active: true, sort_order: 0,
      items: [row("desk-a1"), row("desk-a2"), row("bench-a1"), row("misc-a1")],
      subgroups: [
        { id: "sub-desk-a", subgroup_name: "Desk Family A", sort_order: 0, is_active: true, row_ids: ["desk-a1", "desk-a2"] },
        { id: "sub-bench-a", subgroup_name: "Bench Family A", sort_order: 1, is_active: true, row_ids: ["bench-a1"] },
      ],
    },
    {
      id: "grp-2", pricing_type: "base_model_group", group_name: "Family B", is_active: true, sort_order: 1,
      items: [row("desk-b1")],
      subgroups: [{ id: "sub-desk-b", subgroup_name: "Desk Family B", sort_order: 0, is_active: true, row_ids: ["desk-b1"] }],
    },
  ];
}

const supportATargets = [
  { kind: "base_model_subgroup" as const, group_id: "grp-1", row_id: "sub-desk-a" },
  { kind: "base_model_subgroup" as const, group_id: "grp-1", row_id: "sub-bench-a" },
];
const supportBTargets = [{ kind: "base_model_subgroup" as const, group_id: "grp-2", row_id: "sub-desk-b" }];

test("no structural support selected leaves Base/Model groups unchanged", () => {
  assert.equal(unionStructuralSupportCompatibleTargets([]), null);
  assert.deepEqual(filterCompatibleBaseModelGroups(groups(), null), groups());
});

test("a selected support without compatibleTargets leaves Base/Model groups unchanged", () => {
  const targets = unionStructuralSupportCompatibleTargets([{}, { compatibleTargets: [] }]);
  assert.equal(targets, null);
  assert.deepEqual(filterCompatibleBaseModelGroups(groups(), targets), groups());
});

test("a subgroup target filters to the exact subgroup and removes untargeted subgroups", () => {
  const filtered = filterCompatibleBaseModelGroups(groups(), [{ kind: "base_model_subgroup", group_id: "grp-1", row_id: "sub-desk-a" }]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "grp-1");
  assert.deepEqual(filtered[0].items.map((item) => item.id), ["desk-a1", "desk-a2"]);
  assert.deepEqual(filtered[0].subgroups?.map((subgroup) => subgroup.id), ["sub-desk-a"]);
});

test("a row target filters to the exact row and keeps its subgroup with only that row", () => {
  const filtered = filterCompatibleBaseModelGroups(groups(), [{ kind: "base_model", group_id: "grp-2", row_id: "desk-b1" }]);
  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered[0].items.map((item) => item.id), ["desk-b1"]);
  assert.deepEqual(filtered[0].subgroups?.map((subgroup) => subgroup.row_ids), [["desk-b1"]]);
});

test("mixed subgroup and row targets across groups both apply", () => {
  const filtered = filterCompatibleBaseModelGroups(groups(), [
    { kind: "base_model_subgroup", group_id: "grp-1", row_id: "sub-desk-a" },
    { kind: "base_model", group_id: "grp-2", row_id: "desk-b1" },
  ]);
  assert.deepEqual(filtered.map((group) => group.id).sort(), ["grp-1", "grp-2"]);
  const groupOne = filtered.find((group) => group.id === "grp-1")!;
  assert.deepEqual(groupOne.items.map((item) => item.id), ["desk-a1", "desk-a2"]);
});

test("a group with no compatible rows is removed entirely", () => {
  const filtered = filterCompatibleBaseModelGroups(groups(), supportATargets);
  assert.equal(filtered.some((group) => group.id === "grp-2"), false);
});

test("an ungrouped compatible row survives inside its group without a subgroup entry", () => {
  const filtered = filterCompatibleBaseModelGroups(groups(), [{ kind: "base_model", group_id: "grp-1", row_id: "misc-a1" }]);
  assert.deepEqual(filtered[0].items.map((item) => item.id), ["misc-a1"]);
  assert.equal(filtered[0].subgroups?.length ?? 0, 0);
});

test("switching structural support changes which main row is compatible", () => {
  const underSupportB = filterCompatibleBaseModelGroups(groups(), supportBTargets);
  assert.ok(underSupportB.some((group) => group.items.some((item) => item.id === "desk-b1")));

  const underSupportA = filterCompatibleBaseModelGroups(groups(), supportATargets);
  assert.equal(underSupportA.some((group) => group.items.some((item) => item.id === "desk-b1")), false);
});

test("multiple selected structural supports use the UNION of their valid compatibleTargets", () => {
  const union = unionStructuralSupportCompatibleTargets([{ compatibleTargets: supportATargets }, { compatibleTargets: supportBTargets }]);
  assert.equal(union?.length, 3);
  const filtered = filterCompatibleBaseModelGroups(groups(), union);
  assert.deepEqual(filtered.map((group) => group.id).sort(), ["grp-1", "grp-2"]);
});

test("compatibility metadata that only contains unresolved targets does not hide everything", () => {
  const filtered = filterCompatibleBaseModelGroups(groups(), [{ kind: "base_model", group_id: "grp-does-not-exist", row_id: "ghost" }]);
  assert.deepEqual(filtered, groups());
});

test("filtering matches by stable id only, never by group or row name", () => {
  const sameNameGroups: BaseModelPricingGroup[] = [
    { id: "grp-x", pricing_type: "base_model_group", group_name: "Duplicate Name", is_active: true, sort_order: 0, items: [row("row-x")] },
    { id: "grp-y", pricing_type: "base_model_group", group_name: "Duplicate Name", is_active: true, sort_order: 1, items: [row("row-y")] },
  ];
  const filtered = filterCompatibleBaseModelGroups(sameNameGroups, [{ kind: "base_model", group_id: "grp-x", row_id: "row-x" }]);
  assert.deepEqual(filtered.map((group) => group.id), ["grp-x"]);
});

test("a fully selected subgroup collapses into a single base_model_subgroup target", () => {
  const targets = collapseStructuralSupportSelection(groups(), new Set(["desk-a1", "desk-a2"]));
  assert.deepEqual(targets, [{ kind: "base_model_subgroup", group_id: "grp-1", row_id: "sub-desk-a" }]);
});

test("a partial subgroup selection stores individual base_model row targets", () => {
  const targets = collapseStructuralSupportSelection(groups(), new Set(["desk-a1"]));
  assert.deepEqual(targets, [{ kind: "base_model", group_id: "grp-1", row_id: "desk-a1" }]);
});

test("row-level imported targets expand to their selected row ids for picker display", () => {
  const { selectedRowIds, unresolvedTargets } = expandStructuralSupportSelection(groups(), [
    { kind: "base_model", group_id: "grp-1", row_id: "desk-a1" },
    { kind: "base_model", group_id: "grp-1", row_id: "desk-a2" },
  ]);
  assert.deepEqual([...selectedRowIds].sort(), ["desk-a1", "desk-a2"]);
  assert.deepEqual(unresolvedTargets, []);
});

test("a dangling compatibility target is reported as unresolved instead of silently dropped", () => {
  const { unresolvedTargets } = expandStructuralSupportSelection(groups(), [{ kind: "base_model", group_id: "grp-1", row_id: "row-that-no-longer-exists" }]);
  assert.deepEqual(unresolvedTargets, [{ kind: "base_model", group_id: "grp-1", row_id: "row-that-no-longer-exists" }]);
});

function pricedRow(id: string, label: string) {
  return { id, label, displayName: null, dimensions: null, currency: null, price: 100, specification: null, supplierCodes: [], referenceCodes: [] };
}

function reviewPricing() {
  return {
    baseModelRows: [pricedRow("desk-a1", "Desk A1"), pricedRow("desk-a2", "Desk A2")],
    priceMatrices: [{
      id: "grp-2-matrix", label: "Family B", columns: [{ id: "price", label: "Price" }],
      rows: [{ ...pricedRow("desk-b1", "Desk B1"), prices: { price: 200 } }],
    }],
  };
}

const reviewRoutes = [
  { key: "base_model:rows", destination: "base_model", groupName: "Family A" },
  { key: "matrix:grp-2-matrix", destination: "base_model", groupName: "Family B" },
];

const reviewSubgroups = {
  "base_model:rows": [{ id: "sub-desk-a", subgroup_name: "Desk Family A", sort_order: 0, is_active: true, row_ids: ["desk-a1", "desk-a2"] }],
};

test("structuralSupportReviewBaseModelGroups builds groups from reviewed pricing/routes/subgroups, not names", () => {
  const built = structuralSupportReviewBaseModelGroups(reviewPricing(), reviewRoutes, reviewSubgroups);
  assert.deepEqual(built.map((group) => group.id), [LEGACY_BASE_MODEL_GROUP_ID, "grp-2-matrix"]);
  assert.deepEqual(built[0].subgroups?.[0].row_ids, ["desk-a1", "desk-a2"]);
  assert.deepEqual(built[1].items.map((item) => item.id), ["desk-b1"]);
});

test("a route not resolved to base_model contributes no group", () => {
  const built = structuralSupportReviewBaseModelGroups(reviewPricing(), [{ key: "matrix:grp-2-matrix", destination: "accessory", groupName: "Family B" }], {});
  assert.deepEqual(built.map((group) => group.id), []);
});

function reviewDraft(items: Array<{ id: string; role?: "structural_support" | "companion"; compatibleTargets?: unknown }>) {
  return { pricing: reviewPricing(), optionGroups: [{ id: "supports", items }] } as unknown as Parameters<typeof structuralSupportUnresolvedCompatibility>[0];
}

test("structuralSupportUnresolvedCompatibility flags only structural-support items with an unresolved target", () => {
  const draft = reviewDraft([
    { id: "support-a", role: "structural_support", compatibleTargets: [{ kind: "base_model_subgroup", group_id: LEGACY_BASE_MODEL_GROUP_ID, row_id: "sub-desk-a" }] },
    { id: "support-b", role: "structural_support", compatibleTargets: [{ kind: "base_model", group_id: LEGACY_BASE_MODEL_GROUP_ID, row_id: "ghost-row" }] },
  ]);
  const unresolved = structuralSupportUnresolvedCompatibility(draft, reviewRoutes, reviewSubgroups);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].itemId, "support-b");
  assert.deepEqual(unresolved[0].unresolvedTargets, [{ kind: "base_model", group_id: LEGACY_BASE_MODEL_GROUP_ID, row_id: "ghost-row" }]);
});

test("no compatibleTargets never blocks -- an absent or empty field is never unresolved", () => {
  const draft = reviewDraft([{ id: "support-a", role: "structural_support" }, { id: "support-b", role: "structural_support", compatibleTargets: [] }]);
  assert.deepEqual(structuralSupportUnresolvedCompatibility(draft, reviewRoutes, reviewSubgroups), []);
});

test("a non-structural item's compatibleTargets are ignored even if present (backward-safety field, no filtering effect)", () => {
  const draft = reviewDraft([{ id: "companion-a", role: "companion", compatibleTargets: [{ kind: "base_model", group_id: LEGACY_BASE_MODEL_GROUP_ID, row_id: "ghost-row" }] }]);
  assert.deepEqual(structuralSupportUnresolvedCompatibility(draft, reviewRoutes, reviewSubgroups), []);
});
