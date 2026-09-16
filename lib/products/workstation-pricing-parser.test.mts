import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkstationPricingJson } from "./workstation-pricing-parser.js";
import {
  LEGACY_WORKSTATION_GROUP_ID,
  WORKSTATION_GROUP_PRICING_TYPE,
  flattenWorkstationPricingRows,
  serializeWorkstationPricingGroups,
  workstationPricingGroups,
  WorkstationPricingContractError,
} from "./workstation-pricing-groups.js";

const row = { id: "row-1", label: "120 x 60 x 75", default_price: null, additional_price: 0, currency: "AED" };

test("server parser accepts legacy rows without changing IDs, null, or zero", () => {
  const parsed = parseWorkstationPricingJson(JSON.stringify([row]));
  const parsedRow = parsed[0] as typeof row;
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsedRow.id, "row-1");
  assert.equal(parsedRow.default_price, null);
  assert.equal(parsedRow.additional_price, 0);
});

test("server parser accepts and round-trips explicit groups including empty groups", () => {
  const input = [
    { id: "standard", pricing_type: WORKSTATION_GROUP_PRICING_TYPE, group_name: "Standard", is_active: true, sort_order: 0, items: [row] },
    { id: "empty", pricing_type: WORKSTATION_GROUP_PRICING_TYPE, group_name: "Empty", is_active: false, sort_order: 1, items: [] },
  ];
  const parsed = parseWorkstationPricingJson(JSON.stringify(input));
  assert.deepEqual(serializeWorkstationPricingGroups(workstationPricingGroups(parsed)), parsed);
  assert.equal(flattenWorkstationPricingRows(parsed).length, 1);
  assert.equal((parsed[1] as { items: unknown[] }).items.length, 0);
});

test("malformed groups reject safely", () => {
  assert.throws(
    () => parseWorkstationPricingJson(JSON.stringify([{ id: "bad", pricing_type: WORKSTATION_GROUP_PRICING_TYPE }])),
    WorkstationPricingContractError,
  );
  assert.throws(() => parseWorkstationPricingJson("{"), WorkstationPricingContractError);
});

test("legacy UI normalization saves one explicit group and preserves row identity", () => {
  const groups = workstationPricingGroups([row]);
  assert.equal(groups[0].id, LEGACY_WORKSTATION_GROUP_ID);
  const saved = parseWorkstationPricingJson(JSON.stringify(serializeWorkstationPricingGroups(groups)));
  assert.equal((saved[0] as { pricing_type: string }).pricing_type, WORKSTATION_GROUP_PRICING_TYPE);
  assert.equal((saved[0] as { items: Array<{ id: string }> }).items[0].id, "row-1");
});

test("targeted flat-reader behavior sees grouped rows and counts items, not groups", () => {
  const grouped = [
    { id: "a", pricing_type: WORKSTATION_GROUP_PRICING_TYPE, group_name: "A", is_active: true, sort_order: 0, items: [{ ...row, id: "a-row", label: "A" }] },
    { id: "b", pricing_type: WORKSTATION_GROUP_PRICING_TYPE, group_name: "B", is_active: false, sort_order: 1, items: [{ ...row, id: "b-row", label: "B", default_price: 100, additional_price: 25 }] },
  ];
  const administrativeRows = flattenWorkstationPricingRows(grouped);
  const selectableRows = flattenWorkstationPricingRows(grouped, { activeGroupsOnly: true }).filter((item) => item.is_active !== false);
  assert.deepEqual(administrativeRows.map((item) => item.id), ["a-row", "b-row"]);
  assert.deepEqual(selectableRows.map((item) => item.id), ["a-row"]);
  assert.equal(administrativeRows.length, 2);
  const selected = administrativeRows.find((item) => item.id === "b-row");
  assert.equal(selected?.label, "B");
  assert.equal(Number(selected?.default_price) + Number(selected?.additional_price) * 2, 150);
});

test("server parser preserves normalized workstation requirements", () => {
  const parsed = parseWorkstationPricingJson(JSON.stringify([{ ...row, importantRequirements: [" Required legs ", "Required legs", "Cable tray"] }]));
  assert.deepEqual((parsed[0] as { importantRequirements: string[] }).importantRequirements, ["Required legs", "Cable tray"]);
});

test("rows missing legacy IDs receive deterministic group-scoped IDs that persist on save", () => {
  const input = [{ id: "bench", pricing_type: WORKSTATION_GROUP_PRICING_TYPE, group_name: "Bench", is_active: true, sort_order: 0, items: [{ label: "Old row", default_price: 10 }] }];
  const first = parseWorkstationPricingJson(JSON.stringify(input));
  assert.equal((first[0] as { items: Array<{ id: string }> }).items[0].id, "bench-size-0");
  assert.deepEqual(parseWorkstationPricingJson(JSON.stringify(first)), first);
});
