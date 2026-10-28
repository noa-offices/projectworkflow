import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft } from "./product-template-draft";
import { flattenBatchSpecificationTargets } from "./specification-enrichment-batch";
import { acceptableSpecificationPatches, applySpecificationPatches, buildSpecificationAccessoryNames, buildSpecificationTargets, parseSpecificationCleanupResult, specificationFingerprint, undoSpecificationPatches, validateSpecificationResults } from "./specification-cleanup";

const SPEC = "Swivel chair with medium-high mesh backrest, coloured mesh design included, seat upholstered. Autolift mechanism. Armrests optional. Standard equipment: black plastic parts, polyamide chair column, hard double castors; delivered knocked down in box.";
const DESK = "Melamine top, cable tray included, modesty panel";
const CLEAN = "Swivel chair with medium-high mesh backrest, seat upholstered. Autolift mechanism.";
const row = (id: string, displayName: string, specification: string | null, extra: Record<string, unknown> = {}) => ({
  id, label: id, displayName, supplierCodes: [`C-${id}`], referenceCodes: [], currency: "AED", price: 100, specification,
  dimensions: { width: 520, depth: 615, height: 1130, diameter: null, unit: "mm", rawText: "W:520 D:615 H:1130 mm" }, ...extra,
});
const selection = { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] };
const draft = () => ({
  version: 1, template: { templateName: "Every" },
  pricing: {
    baseModelRows: [row("c1", "Swivel Chair, Medium-High Back (Mesh)", SPEC), row("c2", "Swivel Chair, no spec", null), row("c3", "Swivel Chair, blank", "   "), row("d1", "Desk 1600", DESK), row("s1", "Lounge Sofa 2-seater", SPEC), row("x1", "Screen", "Acoustic screen, felt")],
    workstationRows: [row("w1", "Visitor chair", SPEC)],
    priceMatrices: [{ id: "m1", label: "Task Chairs", columns: [], rows: [row("r1", "Finish A", SPEC)] }],
    modularGroups: [],
  },
  optionGroups: [{ id: "o0", label: "Desk parts", selection, items: [row("t1", "Cable Tray", "x", { label: "Cable Tray" })] }, { id: "o1", label: "Chair parts", selection, items: [row("i1", "Black Plastic Parts", SPEC, { label: "Black Plastic Parts", supplierCodes: ["BPP-1"] }), row("i2", "Castors", "x", { label: "Castors", price: 77 })] }],
}) as unknown as ProductTemplateDraft;

test("targets: every row with a specification, each with the right mode; empty specs and accessory rows are skipped", () => {
  const targets = buildSpecificationTargets(draft());
  assert.deepEqual(targets.map((t) => [t.label, t.mode]), [
    ["Swivel Chair, Medium-High Back (Mesh)", "seating"], ["Desk 1600", "accessory_only"], ["Lounge Sofa 2-seater", "seating"], ["Screen", "accessory_only"], ["Visitor chair", "seating"], ["Finish A", "seating"],
  ]);
  const ids = new Set(flattenBatchSpecificationTargets(draft()).map((t) => t.targetId));
  assert.ok(targets.every((t) => ids.has(t.targetId)), "same ids as the specification helper");
});

test("accessory-only: removing the accessory phrase is accepted; a new word is rejected", () => {
  const items = [{ targetId: "d", text: DESK }];
  assert.deepEqual(validateSpecificationResults(items, [{ targetId: "d", specification: "Melamine top, modesty panel" }]), [{ targetId: "d", specification: "Melamine top, modesty panel" }]);
  assert.deepEqual(validateSpecificationResults(items, [{ targetId: "d", specification: "Melamine top, steel modesty panel" }]), []);
  assert.deepEqual(validateSpecificationResults(items, [{ targetId: "d", specification: DESK }]), [], "unchanged");
});

test("the accessory list sent to the AI is names and codes only, no prices or specifications", () => {
  const names = buildSpecificationAccessoryNames(draft());
  assert.deepEqual(names, ["Desk parts", "Cable Tray", "C-t1", "Chair parts", "Black Plastic Parts", "BPP-1", "Castors", "C-i2"]);
  assert.doesNotMatch(JSON.stringify(names), /77|100|Standard equipment/);
  assert.deepEqual(buildSpecificationAccessoryNames({ ...draft(), optionGroups: [] }), []);
});

test("validation: your example is accepted; a new word, an equal text, an empty text, null, unknown and duplicate ids are dropped", () => {
  const items = [{ targetId: "a", text: SPEC }, { targetId: "b", text: SPEC }, { targetId: "c", text: SPEC }, { targetId: "d", text: SPEC }, { targetId: "e", text: SPEC }];
  const out = validateSpecificationResults(items, [
    { targetId: "a", specification: CLEAN },
    { targetId: "b", specification: "Ergonomic swivel chair with medium-high mesh backrest." },
    { targetId: "c", specification: SPEC },
    { targetId: "d", specification: "  " },
    { targetId: "e", specification: null },
    { targetId: "zzz", specification: CLEAN },
    { targetId: "a", specification: "Swivel chair." },
  ]);
  assert.deepEqual(out, [{ targetId: "a", specification: CLEAN }]);
});

test("apply changes only the specification of accepted rows; undo restores only rows that still hold the cleaned text", () => {
  const start = draft();
  const all = buildSpecificationTargets(start), first = all.find((t) => t.label.startsWith("Swivel"))!, second = all.find((t) => t.label === "Visitor chair")!;
  const { draft: after, undo } = applySpecificationPatches(start, [{ targetId: first.targetId, specification: CLEAN }, { targetId: second.targetId, specification: "Visitor chair." }]);
  assert.deepEqual(undo.map((u) => [u.before, u.after]), [[SPEC, CLEAN], [SPEC, "Visitor chair."]]);
  const changed = after.pricing.baseModelRows[0];
  assert.equal(changed.specification, CLEAN);
  assert.deepEqual({ ...changed, specification: SPEC }, start.pricing.baseModelRows[0], "name, dimensions, codes, price are unchanged");
  assert.deepEqual(after.pricing.baseModelRows.slice(1), start.pricing.baseModelRows.slice(1));
  assert.deepEqual(after.optionGroups, start.optionGroups);
  const edited = structuredClone(after);
  edited.pricing.baseModelRows[0].specification = "typed by the user";
  const result = undoSpecificationPatches(edited, undo);
  assert.equal(result.restored, 1); assert.equal(result.kept, 1);
  assert.equal(result.draft.pricing.baseModelRows[0].specification, "typed by the user");
  assert.equal(result.draft.pricing.workstationRows[0].specification, SPEC);
});

test("stale: the fingerprint changes with a target text or the accessory list, not with other fields", () => {
  const a = draft(), b = draft();
  assert.equal(specificationFingerprint(a), specificationFingerprint(b));
  b.pricing.baseModelRows[0].dimensions!.rawText = "other";
  assert.equal(specificationFingerprint(a), specificationFingerprint(b));
  b.pricing.baseModelRows[0].specification = "changed";
  assert.notEqual(specificationFingerprint(a), specificationFingerprint(b));
  const c = draft(); c.optionGroups[1].items[1].label = "Wheels";
  assert.notEqual(specificationFingerprint(a), specificationFingerprint(c));
});

test("accepting uses only selected rows whose edited text still passes the words check", () => {
  const entries = [
    { targetId: "a", original: SPEC, value: CLEAN, selected: true },
    { targetId: "b", original: SPEC, value: "Swivel chair.", selected: false },
    { targetId: "c", original: SPEC, value: "Ergonomic swivel chair.", selected: true },
  ];
  assert.deepEqual(acceptableSpecificationPatches(entries), [{ targetId: "a", specification: CLEAN }]);
});

test("the provider answer must be exactly one result per requested id", () => {
  assert.deepEqual(parseSpecificationCleanupResult([{ targetId: "a", specification: "x" }, { targetId: "b", specification: null }], ["a", "b"]), [{ targetId: "a", specification: "x" }, { targetId: "b", specification: null }]);
  assert.equal(parseSpecificationCleanupResult([{ targetId: "a", specification: "x" }], ["a", "b"]), null);
  assert.equal(parseSpecificationCleanupResult([{ targetId: "a", specification: 5 }, { targetId: "b", specification: null }], ["a", "b"]), null);
  assert.equal(parseSpecificationCleanupResult([{ targetId: "a", specification: "x", more: 1 }, { targetId: "b", specification: null }], ["a", "b"]), null);
  assert.equal(parseSpecificationCleanupResult("nope", ["a"]), null);
});
