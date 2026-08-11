import assert from "node:assert/strict";
import test from "node:test";
import { baseModelPricingGroups, serializeBaseModelPricingGroups, type BaseModelPricingGroup } from "./base-model-pricing-groups.js";
import { assignBaseModelRowToSubgroup, baseModelPricingSubgroupForRow, baseModelPricingSubgroupSections, baseModelSubgroupImageForRow, createBaseModelPricingSubgroup, removeBaseModelPricingSubgroup, removeRowFromBaseModelSubgroups, updateBaseModelPricingSubgroup } from "./base-model-pricing-subgroups.js";

type Row = { id: string; price: number | null; currency: string };
const rows: Row[] = [{ id: "1AF001", price: 0, currency: "EUR" }, { id: "1AF002", price: null, currency: "EUR" }, { id: "1AF005", price: 20, currency: "EUR" }];
const legacy = rows.map((row) => ({ ...row }));
const group = (): BaseModelPricingGroup<Row> => ({ id: "executive", pricing_type: "base_model_group", group_name: "Executive Desks", is_active: true, sort_order: 0, items: rows.map((row) => ({ ...row })), subgroups: [createBaseModelPricingSubgroup("standard", "Standard", 0), createBaseModelPricingSubgroup("service", "Service Unit", 1)] });

test("legacy Base/Model rows remain unchanged without injected subgroups", () => {
  const normalized = baseModelPricingGroups<Row>(legacy); assert.equal(normalized[0].subgroups, undefined); assert.deepEqual(normalized[0].items, legacy);
});

test("stable subgroup membership is exclusive, optional, renameable, and reorderable", () => {
  let current = assignBaseModelRowToSubgroup(group(), "1AF001", "standard"); current = assignBaseModelRowToSubgroup(current, "1AF002", "standard"); current = assignBaseModelRowToSubgroup(current, "1AF001", "service");
  assert.deepEqual(current.subgroups?.find((item) => item.id === "standard")?.row_ids, ["1AF002"]); assert.equal(baseModelPricingSubgroupForRow(current, "1AF001")?.id, "service"); assert.equal(baseModelPricingSubgroupForRow(current, "1AF005"), null);
  current = updateBaseModelPricingSubgroup(current, "service", { subgroup_name: "Desk for Service Unit", sort_order: 0 }); assert.equal(current.subgroups?.find((item) => item.id === "service")?.id, "service");
});

test("deleting a subgroup or row membership never deletes pricing rows", () => {
  let current = assignBaseModelRowToSubgroup(group(), "1AF001", "standard"); current = removeBaseModelPricingSubgroup(current, "standard"); assert.equal(current.items.length, 3); assert.equal(baseModelPricingSubgroupForRow(current, "1AF001"), null);
  current = assignBaseModelRowToSubgroup(group(), "1AF001", "standard"); current = removeRowFromBaseModelSubgroups(current, "1AF001"); assert.equal(current.items.length, 3); assert.equal(baseModelPricingSubgroupForRow(current, "1AF001"), null);
});

test("duplicate subgroup membership is rejected by the persisted contract", () => {
  const invalid = group(); invalid.subgroups = invalid.subgroups!.map((subgroup) => ({ ...subgroup, row_ids: ["1AF001"] })); assert.throws(() => baseModelPricingGroups([invalid]), /more than one subgroup/i);
});

test("save/reopen preserves membership and null/zero pricing exactly", () => {
  const current = assignBaseModelRowToSubgroup(assignBaseModelRowToSubgroup(group(), "1AF001", "standard"), "1AF002", "standard"); const reopened = baseModelPricingGroups<Row>(serializeBaseModelPricingGroups([current]))[0]; assert.deepEqual(reopened.subgroups, current.subgroups); assert.equal(reopened.items[0].price, 0); assert.equal(reopened.items[1].price, null);
});

test("quotation sections show each subgroup once and leave unassigned rows separate", () => {
  const current = assignBaseModelRowToSubgroup(assignBaseModelRowToSubgroup(group(), "1AF001", "standard"), "1AF002", "standard"); const sections = baseModelPricingSubgroupSections(current); assert.equal(sections.subgroups.length, 2); assert.deepEqual(sections.subgroups[0].rows.map((row) => row.id), ["1AF001", "1AF002"]); assert.deepEqual(sections.ungroupedRows.map((row) => row.id), ["1AF005"]);
});

test("image precedence is row then subgroup then parent group", () => {
  const current = assignBaseModelRowToSubgroup(group(), "1AF001", "standard"); const subgroupImages = { standard: "subgroup" }; const groupImages = { executive: "group" };
  assert.equal(baseModelSubgroupImageForRow(current, "1AF001", subgroupImages, groupImages, { "1AF001": "row" }), "row"); assert.equal(baseModelSubgroupImageForRow(current, "1AF001", subgroupImages, groupImages, {}), "subgroup"); assert.equal(baseModelSubgroupImageForRow(current, "1AF005", subgroupImages, groupImages, {}), "group");
});

test("moving a row does not alter row-based conditional rules", () => {
  const rule = { base_model_group_id: "executive", base_model_row_id: "1AF001", required: true }; const moved = assignBaseModelRowToSubgroup(assignBaseModelRowToSubgroup(group(), "1AF001", "standard"), "1AF001", "service"); assert.equal(baseModelPricingSubgroupForRow(moved, rule.base_model_row_id)?.id, "service"); assert.deepEqual(rule, { base_model_group_id: "executive", base_model_row_id: "1AF001", required: true });
});
