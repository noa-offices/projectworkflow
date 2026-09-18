import assert from "node:assert/strict";
import test from "node:test";
import { deriveVisualSubgroupFamilyLabel, inferBaseModelVisualSubgroups } from "./smart-product-base-model-auto-subgroups.js";

function row(id: string, displayName: string | null, extra: Partial<{ label: string | null; dimensionsRawText: string; price: number }> = {}) {
  return { id, displayName, label: extra.label ?? null, dimensionsRawText: extra.dimensionsRawText, price: extra.price };
}

test("deriveVisualSubgroupFamilyLabel strips only a trailing variable size/dimension token", () => {
  assert.equal(deriveVisualSubgroupFamilyLabel("SIGMA_Q Desk for COMBY - 120"), "SIGMA_Q Desk for COMBY");
  assert.equal(deriveVisualSubgroupFamilyLabel("SIGMA_Q Desk for COMBY - 140"), "SIGMA_Q Desk for COMBY");
  assert.equal(deriveVisualSubgroupFamilyLabel("Desk 120x80"), "Desk");
  assert.equal(deriveVisualSubgroupFamilyLabel("Desk W120"), "Desk");
  assert.equal(deriveVisualSubgroupFamilyLabel("Desk Top Access - 120"), "Desk Top Access");
});

test("8: ungrouped rows with a stable repeated family naming pattern are auto-organized into a visual subgroup", () => {
  const rows = [row("d1", "SIGMA_Q Desk for COMBY - 120"), row("d2", "SIGMA_Q Desk for COMBY - 140"), row("d3", "SIGMA_Q Desk for COMBY - 160")];
  const subgroups = inferBaseModelVisualSubgroups(rows);
  assert.equal(subgroups.length, 1);
  assert.equal(subgroups[0].subgroup_name, "SIGMA_Q Desk for COMBY");
  assert.deepEqual(subgroups[0].row_ids, ["d1", "d2", "d3"]);
});

test("9: the Sigma-style family set produces separate, non-merged subgroups for each distinct commercial family", () => {
  const rows = [
    row("qd1", "SIGMA_Q Desk for COMBY - 120"), row("qd2", "SIGMA_Q Desk for COMBY - 140"),
    row("qb1", "SIGMA_Q Bench for COMBY - 120"), row("qb2", "SIGMA_Q Bench for COMBY - 140"),
    row("ld1", "SIGMA_L Desk for COMBY - 120"), row("ld2", "SIGMA_L Desk for COMBY - 160"),
    row("lb1", "SIGMA_L Bench for COMBY - 120"), row("lb2", "SIGMA_L Bench for COMBY - 160"),
    row("qp1", "SIGMA_Q Desk for P58 - 120"), row("qp2", "SIGMA_Q Desk for P58 - 140"),
    row("lp1", "SIGMA_L Desk for P58 - 120"), row("lp2", "SIGMA_L Desk for P58 - 140"),
  ];
  const subgroups = inferBaseModelVisualSubgroups(rows);
  assert.deepEqual(subgroups.map((subgroup) => subgroup.subgroup_name).toSorted(), [
    "SIGMA_L Bench for COMBY", "SIGMA_L Desk for COMBY", "SIGMA_L Desk for P58",
    "SIGMA_Q Bench for COMBY", "SIGMA_Q Desk for COMBY", "SIGMA_Q Desk for P58",
  ].toSorted());
  assert.equal(subgroups.length, 6, "Each distinct commercial family must form its own subgroup, never merged with another");
  const assignedIds = new Set(subgroups.flatMap((subgroup) => subgroup.row_ids));
  assert.equal(assignedIds.size, rows.length, "Every row must be assigned to exactly one subgroup");
});

test("10: a single-occurrence (weak/ambiguous) family label is left Ungrouped rather than forced into its own subgroup", () => {
  const rows = [row("a", "SIGMA_Q Desk for COMBY - 120"), row("b", "SIGMA_Q Desk for COMBY - 140"), row("c", "One-Off Special Item - 90")];
  const subgroups = inferBaseModelVisualSubgroups(rows);
  assert.equal(subgroups.length, 1);
  assert.ok(!subgroups.some((subgroup) => subgroup.row_ids.includes("c")), "The lone unmatched row must remain out of every subgroup (falls through to Ungrouped)");
});

test("11: rows are never grouped by dimensions alone", () => {
  const rows = [row("a", "SIGMA_Q Desk for COMBY - 120", { dimensionsRawText: "1200x600" }), row("b", "SIGMA_L Bench for P58 - 120", { dimensionsRawText: "1200x600" })];
  const subgroups = inferBaseModelVisualSubgroups(rows);
  assert.equal(subgroups.length, 0, "Identical dimensions on differently-named rows must never form a subgroup");
});

test("12: rows are never grouped by price alone", () => {
  const rows = [row("a", "SIGMA_Q Desk for COMBY - 120", { price: 499 }), row("b", "SIGMA_L Bench for P58 - 120", { price: 499 })];
  const subgroups = inferBaseModelVisualSubgroups(rows);
  assert.equal(subgroups.length, 0, "Identical prices on differently-named rows must never form a subgroup");
});

test("rows with no name and rows reducing to a bare number never form or join a subgroup", () => {
  const rows = [row("a", null), row("b", ""), row("c", "120"), row("d", "140"), row("e", "SIGMA_Q Desk for COMBY - 120"), row("f", "SIGMA_Q Desk for COMBY - 140")];
  const subgroups = inferBaseModelVisualSubgroups(rows);
  assert.equal(subgroups.length, 1);
  assert.deepEqual(subgroups[0].row_ids, ["e", "f"]);
});

test("inference never mutates the input rows and produces pricing-authoritative-safe review metadata only", () => {
  const rows = [row("a", "SIGMA_Q Desk for COMBY - 120"), row("b", "SIGMA_Q Desk for COMBY - 140")];
  const before = structuredClone(rows);
  const subgroups = inferBaseModelVisualSubgroups(rows);
  assert.deepEqual(rows, before);
  subgroups.forEach((subgroup) => {
    assert.equal(typeof subgroup.id, "string");
    assert.equal(subgroup.is_active, true);
    assert.equal(typeof subgroup.sort_order, "number");
  });
});
