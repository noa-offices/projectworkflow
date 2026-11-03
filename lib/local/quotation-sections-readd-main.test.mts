import assert from "node:assert/strict";
import test from "node:test";
import { attachLooseSubSections, isLooseSubSection, orderedSections, type LocalQuotationSection } from "./quotation-workspace.js";

const section = (id: string, kind: "main" | "sub", sortOrder: number, parent: string | null = null): LocalQuotationSection => ({
  id, quotation_id: "q", section_title: id, section_notes: null, section_type: "section", parent_section_id: parent, section_kind: kind,
  title_align: "left", title_bold: true, title_bg: "light_grey", title_size: "normal", row_height: null, sort_order: sortOrder, is_active: true, source_section_id: null,
});

/** Same grouping the builder uses for "Main Section total": children by parent id. */
const childrenOf = (sections: LocalQuotationSection[], mainId: string) => orderedSections(sections).filter((item) => item.section_kind === "sub" && item.parent_section_id === mainId).map((item) => item.id);
const parents = (sections: LocalQuotationSection[]) => Object.fromEntries(sections.map((item) => [item.id, item.parent_section_id]));

// Main M with subs A and B. M is removed (Remove only deletes the main row), so A and B keep a dangling parent id.
const afterRemove = () => [section("A", "sub", 20, "M"), section("B", "sub", 30, "M")];

test("remove a main section, add one back above its sub sections: they join it", () => {
  const sections = [section("N", "main", 10), ...afterRemove()];
  assert.equal(isLooseSubSection(sections[1], sections), true);
  const result = attachLooseSubSections(sections, "N");
  assert.deepEqual(childrenOf(result, "N"), ["A", "B"]); // so the new section total is the sum of A and B
});

test("a sub section with a valid main section is not moved", () => {
  const sections = [section("N", "main", 10), section("A", "sub", 20, "M"), section("L", "sub", 25, "GONE"), section("M", "main", 30), section("C", "sub", 40, "M"), section("D", "sub", 50, "N2"), section("N2", "main", 60)];
  const result = attachLooseSubSections(sections, "N");
  assert.deepEqual(parents(result), { ...parents(sections), L: "N" }); // only the loose L changed; A, C (valid M) and D (valid N2) stay
  assert.equal(isLooseSubSection(sections[1], sections), false);
});

test("a valid sub section between loose ones stays put and the loose ones after it still join", () => {
  const sections = [section("M", "main", 5), section("N", "main", 10), section("A", "sub", 20, "M"), section("B", "sub", 30, "GONE")];
  assert.deepEqual(parents(attachLooseSubSections(sections, "N")), { M: null, N: null, A: "M", B: "N" });
});

test("two main sections in a row: the first gets nothing, the next one gets the loose ones", () => {
  const sections = [section("N1", "main", 10), section("N2", "main", 20), ...afterRemove().map((item, i) => ({ ...item, sort_order: 30 + i }))];
  assert.equal(attachLooseSubSections(sections, "N1"), sections); // nothing to adopt: same list back
  assert.deepEqual(childrenOf(attachLooseSubSections(sections, "N2"), "N2"), ["A", "B"]);
  assert.deepEqual(childrenOf(attachLooseSubSections(sections, "N2"), "N1"), []);
});

test("a main section added at the very end adopts nothing", () => {
  const sections = [...afterRemove(), section("N", "main", 40)];
  const result = attachLooseSubSections(sections, "N");
  assert.equal(result, sections);
  assert.deepEqual(parents(result), { A: "M", B: "M", N: null });
});

test("loose means no parent id or a parent that is not a main section; old saved data works too", () => {
  const sections = [section("N", "main", 10), section("A", "sub", 20, null), section("B", "sub", 30, "A"), section("C", "sub", 40, "MISSING")];
  assert.deepEqual(childrenOf(attachLooseSubSections(sections, "N"), "N"), ["A", "B", "C"]); // B's parent is a sub, so B is loose too
});

test("the input list is never changed, so Undo (which restores the stored snapshot) puts everything back exactly", () => {
  const before = [section("N", "main", 10), ...afterRemove()];
  const copy = JSON.parse(JSON.stringify(before));
  const after = attachLooseSubSections(before, "N");
  assert.deepEqual(before, copy);
  assert.notEqual(after, before);
  // Undo = the snapshot taken before the add; Redo = the snapshot after. Both are plain copies.
  const undone = JSON.parse(JSON.stringify(before)), redone = JSON.parse(JSON.stringify(after));
  assert.deepEqual(parents(undone), { N: null, A: "M", B: "M" });
  assert.deepEqual(parents(redone), { N: null, A: "N", B: "N" });
  assert.deepEqual(attachLooseSubSections(undone, "N"), after); // adding again gives the same result as Redo
});

test("an unknown or non-main id changes nothing", () => {
  const sections = [section("N", "main", 10), ...afterRemove()];
  assert.equal(attachLooseSubSections(sections, "nope"), sections);
  assert.equal(attachLooseSubSections(sections, "A"), sections);
});
