import assert from "node:assert/strict";
import test from "node:test";
import { groupMaterialsByGroup, groupMaterialsIntoSections } from "./finish-material-groups";

let order = 0;
const m = (id: string, category: string | null, collection: string | null, extra: Record<string, unknown> = {}) => ({
  id, material_group_id: "g1", material_category: category, material_collection: collection, material_code: id.toUpperCase(), material_name: `Name ${id}`, sort_order: order++, ...extra,
});

test("with collections: one section per category and collection, headed 'category · collection', counts and selected counts", () => {
  order = 0;
  const materials = [m("a1", "HP4", "Puxx"), m("a2", "HP4", "Puxx"), m("a3", "HP4", "Steelcut Trio"), m("b1", "SG1", "Era"), m("b2", "SG1", "Era")];
  const sections = groupMaterialsIntoSections(materials, new Set(["a2", "b1", "b2"]));
  assert.deepEqual(sections.map((s) => [s.label, s.total, s.selected]), [["HP4 · Puxx", 2, 1], ["HP4 · Steelcut Trio", 1, 0], ["SG1 · Era", 2, 2]]);
  assert.deepEqual(sections[0].materials.map((x) => x.id), ["a1", "a2"]);
  assert.equal(new Set(sections.map((s) => s.key)).size, 3, "keys are unique");
});

test("without any collection: two levels only, headed by the category", () => {
  order = 0;
  const sections = groupMaterialsIntoSections([m("x1", "Cat B", null), m("x2", "Cat A", null), m("x3", "Cat A", "")], new Set());
  assert.deepEqual(sections.map((s) => [s.label, s.total]), [["Cat A", 2], ["Cat B", 1]]);
});

test("materials with no category and no collection go to an 'Other' section, always last", () => {
  order = 0;
  const sections = groupMaterialsIntoSections([m("o1", null, null), m("z1", "Zeta", null), m("o2", " ", " "), m("a1", "Alpha", "Era")], new Set(["o2"]));
  assert.deepEqual(sections.map((s) => [s.label, s.total, s.selected]), [["Alpha · Era", 1, 0], ["Zeta", 1, 0], ["Other", 2, 1]]);
});

test("a collection without a category is kept under 'Other · collection' next to the Other bucket", () => {
  order = 0;
  const sections = groupMaterialsIntoSections([m("c1", null, "Puxx"), m("c2", "HP4", "Puxx")], new Set());
  assert.deepEqual(sections.map((s) => s.label), ["HP4 · Puxx", "Other · Puxx"]);
});

test("materials inside a section keep the sort order (sort_order, then code, then name)", () => {
  const materials = [
    { ...m("p", "HP4", "Puxx"), sort_order: 5, material_code: "B" },
    { ...m("q", "HP4", "Puxx"), sort_order: 5, material_code: "A" },
    { ...m("r", "HP4", "Puxx"), sort_order: 1, material_code: "Z" },
  ];
  assert.deepEqual(groupMaterialsIntoSections(materials, new Set())[0].materials.map((x) => x.id), ["r", "q", "p"]);
});

test("grouping by material group keeps the first-seen group order and counts per group", () => {
  order = 0;
  const materials = [m("a", "HP4", "Puxx", { material_group_id: "fabric" }), m("b", "SG1", "Era", { material_group_id: "fabric" }), m("c", null, null, { material_group_id: "mesh" })];
  const groups = groupMaterialsByGroup(materials, new Set(["b", "c"]));
  assert.deepEqual(groups.map((g) => [g.groupId, g.total, g.selected, g.sections.length]), [["fabric", 2, 1, 2], ["mesh", 1, 1, 1]]);
  assert.deepEqual(groupMaterialsByGroup([], new Set()), []);
  assert.deepEqual(groupMaterialsIntoSections([], new Set()), []);
});
