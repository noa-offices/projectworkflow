import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft } from "./product-template-draft.js";
import {
  flattenWorkstationPricingRows,
  hasExplicitWorkstationPricingGroupStructure,
  hasMeaningfulWorkstationPricingData,
  LEGACY_WORKSTATION_GROUP_ID,
  LEGACY_WORKSTATION_GROUP_NAME,
  normalizeWorkstationPricing,
  serializeWorkstationPricingGroups,
  workstationPricingGroups,
  workstationPricingRowId,
  WORKSTATION_GROUP_PRICING_TYPE,
} from "./workstation-pricing-groups.js";

const rowA = { id: "row-a", label: "1200 desk", default_price: null, additional_price: 0, sort_order: 0 };
const rowB = { id: "row-b", label: "1600 desk", default_price: 1250.75, additional_price: 300, sort_order: 1 };

test("legacy rows normalize into one deterministic in-memory group without mutation", () => {
  const source = [structuredClone(rowA), structuredClone(rowB)];
  const before = structuredClone(source);
  const result = normalizeWorkstationPricing(source);
  assert.equal(result.sourceKind, "legacy");
  assert.equal(result.issues.length, 0);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0], {
    id: LEGACY_WORKSTATION_GROUP_ID,
    pricing_type: WORKSTATION_GROUP_PRICING_TYPE,
    group_name: LEGACY_WORKSTATION_GROUP_NAME,
    is_active: true,
    sort_order: 0,
    items: source,
    isSyntheticLegacyGroup: true,
  });
  assert.deepEqual(source, before);
  assert.notEqual(result.groups[0].items[0], source[0]);
});

test("explicit groups preserve ids, names, active state, array order, row order, null, zero, and exact numbers", () => {
  const source = [
    { id: "group-b", pricing_type: "workstation_group", group_name: "Bench", is_active: false, sort_order: 9, items: [rowB, rowA] },
    { id: "group-a", pricing_type: "workstation_group", group_name: "Standard", is_active: true, sort_order: 1, items: [] },
  ];
  const groups = workstationPricingGroups(source);
  assert.deepEqual(groups.map((group) => group.id), ["group-b", "group-a"]);
  assert.deepEqual(groups.map((group) => group.group_name), ["Bench", "Standard"]);
  assert.equal(groups[0].is_active, false);
  assert.deepEqual(groups[0].items.map((row) => row.id), ["row-b", "row-a"]);
  assert.equal(groups[0].items[1].default_price, null);
  assert.equal(groups[0].items[1].additional_price, 0);
  assert.equal(groups[0].items[0].default_price, 1250.75);
  assert.deepEqual(groups[1].items, []);
});

test("flattener returns the exact legacy row shape and includes inactive groups by default", () => {
  const source = [
    { id: "inactive", pricing_type: "workstation_group", group_name: "Inactive", is_active: false, sort_order: 0, items: [rowA] },
    { id: "active", pricing_type: "workstation_group", group_name: "Active", is_active: true, sort_order: 1, items: [rowB] },
  ];
  assert.deepEqual(flattenWorkstationPricingRows(source), [rowA, rowB]);
  assert.deepEqual(flattenWorkstationPricingRows(source, { activeGroupsOnly: true }), [rowB]);
  assert.equal(flattenWorkstationPricingRows(source)[0].id, "row-a");
  assert.equal("pricing_type" in flattenWorkstationPricingRows(source)[0], false);
});

test("empty legacy data is commercially empty while an explicit empty group remains structural", () => {
  assert.deepEqual(workstationPricingGroups([]), []);
  assert.equal(hasMeaningfulWorkstationPricingData([]), false);
  assert.equal(hasExplicitWorkstationPricingGroupStructure([]), false);
  const emptyGroup = [{ id: "empty", pricing_type: "workstation_group", group_name: "Future pricing", is_active: true, sort_order: 0, items: [] }];
  assert.equal(workstationPricingGroups(emptyGroup).length, 1);
  assert.equal(hasMeaningfulWorkstationPricingData(emptyGroup), false);
  assert.equal(hasExplicitWorkstationPricingGroupStructure(emptyGroup), true);
});

test("duplicate ids and malformed group items are detected and never treated as rows", () => {
  const duplicate = [
    { id: "same", pricing_type: "workstation_group", group_name: "A", items: [] },
    { id: "same", pricing_type: "workstation_group", group_name: "B", items: [] },
  ];
  assert.ok(normalizeWorkstationPricing(duplicate).issues.some((issue) => issue.code === "duplicate_group_id"));
  assert.throws(() => flattenWorkstationPricingRows(duplicate), /duplicated/);

  const malformed = [{ id: "bad", pricing_type: "workstation_group", group_name: "Bad", items: "not-an-array" }];
  const result = normalizeWorkstationPricing(malformed);
  assert.ok(result.issues.some((issue) => issue.code === "invalid_group_items"));
  assert.deepEqual(result.groups[0].items, []);
  assert.throws(() => workstationPricingGroups(malformed), /items array/);
});

test("mixed input retains legacy rows in a leading synthetic group and explicit groups in source order", () => {
  const source = [
    rowA,
    { id: "group-b", pricing_type: "workstation_group", group_name: "B", is_active: true, sort_order: 1, items: [rowB] },
    { id: "row-c", label: "1800 desk", default_price: 1400 },
    { id: "group-a", pricing_type: "workstation_group", group_name: "A", is_active: true, sort_order: 0, items: [] },
  ];
  const result = normalizeWorkstationPricing(source);
  assert.equal(result.sourceKind, "mixed");
  assert.deepEqual(result.groups.map((group) => group.id), [LEGACY_WORKSTATION_GROUP_ID, "group-b", "group-a"]);
  assert.deepEqual(result.groups[0].items.map((row) => row.id), ["row-a", "row-c"]);
  assert.deepEqual(flattenWorkstationPricingRows(source).map((row) => row.id), ["row-a", "row-c", "row-b"]);

  const conflicting = [
    rowA,
    { id: LEGACY_WORKSTATION_GROUP_ID, pricing_type: WORKSTATION_GROUP_PRICING_TYPE, group_name: "Conflict", items: [] },
  ];
  assert.throws(() => flattenWorkstationPricingRows(conflicting), /conflicts with the synthesized legacy group/);
});

test("serialization makes normalized legacy and explicit groups persistable and round-trips", () => {
  const normalizedLegacy = workstationPricingGroups([rowA]);
  const serializedLegacy = serializeWorkstationPricingGroups(normalizedLegacy);
  assert.equal(serializedLegacy[0].id, LEGACY_WORKSTATION_GROUP_ID);
  assert.equal("isSyntheticLegacyGroup" in serializedLegacy[0], false);
  assert.deepEqual(flattenWorkstationPricingRows(serializedLegacy), [rowA]);

  const explicit = [{ id: "group-a", pricing_type: WORKSTATION_GROUP_PRICING_TYPE, group_name: "A", is_active: false, sort_order: 4, items: [rowA, rowB] }];
  assert.deepEqual(serializeWorkstationPricingGroups(workstationPricingGroups(explicit)), explicit);
});

test("row fallback ids are isolated and ProductTemplateDraft v1 workstationRows stays flat", () => {
  assert.equal(workstationPricingRowId({ id: "real-id" }, 3), "real-id");
  assert.equal(workstationPricingRowId({}, 3), "size-3");
  const draftRows: ProductTemplateDraft["pricing"]["workstationRows"] = [];
  assert.ok(Array.isArray(draftRows));
});
