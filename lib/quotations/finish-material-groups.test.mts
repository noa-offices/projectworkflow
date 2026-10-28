import assert from "node:assert/strict";
import test from "node:test";
import { clearSection, formatSelectionSummary, groupMaterialsByGroup, groupMaterialsIntoSections, isSectionFull, selectAllInSection, selectionSummary } from "./finish-material-groups";

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

// ---- Step B: select all / clear / summary ----
type Row = { id: string; brand_material_id?: string; product_template_material_group_id: string; show_in_specification: boolean; show_in_quotation: boolean; sort_order: number };
const mats = [m("s1", "SG1", "Era"), m("s2", "SG1", "Era"), m("s3", "SG1", "Era")];
const link = { id: "L1", show_in_specification: true, show_in_quotation: false };
const build = (material: { id: string }, rowIndex: number): Row => ({ id: `selected-linked-${material.id}-${rowIndex}`, brand_material_id: material.id, product_template_material_group_id: link.id, show_in_specification: link.show_in_specification, show_in_quotation: link.show_in_quotation, sort_order: rowIndex });
const same = (row: Row, material: { id: string }) => row.brand_material_id === material.id;

test("select all adds only the missing materials, with rows built exactly like a single pick", () => {
  const existing: Row[] = [build(mats[1], 0)];
  const next = selectAllInSection(existing, mats, build, same);
  assert.deepEqual(next.map((r) => r.brand_material_id), ["s2", "s1", "s3"], "existing row first, no duplicate");
  assert.deepEqual(next[1], build(mats[0], 1));
  assert.deepEqual(next[2], build(mats[2], 2), "sort order continues from the current length");
  assert.ok(next.every((r) => r.product_template_material_group_id === "L1" && r.show_in_specification && !r.show_in_quotation));
  assert.deepEqual(selectAllInSection(next, mats, build, same), next, "running it again changes nothing");
  assert.equal(existing.length, 1, "input is not mutated");
});
test("clear removes only the rows of that section", () => {
  const other = { ...build(m("x9", "HP4", "Puxx"), 5) };
  const rows = [build(mats[0], 0), other, build(mats[2], 2)];
  assert.deepEqual(clearSection(rows, mats, same).map((r) => r.brand_material_id), ["x9"]);
  assert.deepEqual(clearSection(rows, [], same), rows);
});
test("a section is full only when every material in it is selected", () => {
  const [section] = groupMaterialsIntoSections(mats, new Set());
  assert.equal(isSectionFull(section, new Set(["s1", "s2", "s3"])), true);
  assert.equal(isSectionFull(section, new Set(["s1", "s2"])), false);
  assert.equal(isSectionFull({ ...section, materials: [] }, new Set()), false, "an empty section is never full");
});
test("summary counts single materials and full sections, and reads naturally", () => {
  order = 0;
  const all = [m("a1", "HP4", "Puxx"), m("a2", "HP4", "Puxx"), m("b1", "SG1", "Era"), m("b2", "SG1", "Era"), m("b3", "SG1", "Era"), m("c1", "SG2", "Jet")];
  const sections = groupMaterialsIntoSections(all, new Set(["a1", "a2", "b1", "b2", "c1"]));
  assert.deepEqual(selectionSummary(sections), { singles: 2, fullSections: 2 }, "a1+a2 and c1 are full sections, b1+b2 are two singles");
  assert.equal(formatSelectionSummary({ singles: 3, fullSections: 1 }), "3 materials + 1 full section selected");
  assert.equal(formatSelectionSummary({ singles: 1, fullSections: 0 }), "1 material selected");
  assert.equal(formatSelectionSummary({ singles: 0, fullSections: 2 }), "2 full sections selected");
  assert.equal(formatSelectionSummary({ singles: 0, fullSections: 0 }), "Nothing selected");
});
