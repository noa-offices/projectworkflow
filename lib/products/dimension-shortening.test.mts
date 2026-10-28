import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft } from "./product-template-draft";
import { flattenBatchSpecificationTargets } from "./specification-enrichment-batch";
import { acceptableDimensionPatches, applyDimensionPatches, buildDimensionTargets, chunkDimensionTargets, dimensionFingerprint, parseDimensionShorteningResult, undoDimensionPatches, validateDimensionResults } from "./dimension-shortening";

const LONG = "Seat: H 415-540 x W 490 x D 450 mm; total: H 1130 x W 520 (without armrests) / 680 (with armrests) x D 615 mm";
const row = (id: string, rawText: string | null, extra: Record<string, unknown> = {}) => ({
  id, label: id, displayName: `Name ${id}`, supplierCodes: [`C-${id}`], referenceCodes: [], currency: "AED", price: 100, specification: `Spec ${id}`,
  dimensions: rawText === undefined ? null : { width: 520, depth: 615, height: 1130, diameter: null, unit: "mm", rawText }, ...extra,
});
const draft = () => ({
  version: 1, template: { templateName: "Chair" },
  pricing: {
    baseModelRows: [row("b1", LONG), row("b2", null), row("b3", "W:520/680 D:615 H:1130 mm"), row("b4", "   "), row("b5", LONG, { dimensions: null })],
    workstationRows: [row("w1", LONG)],
    priceMatrices: [{ id: "m1", label: "Finish", columns: [], rows: [row("r1", LONG)] }],
    modularGroups: [{ id: "g1", label: "Modular", directRows: [row("d1", LONG)] }],
  },
  optionGroups: [{ id: "o1", label: "Options", items: [row("i1", LONG)] }],
}) as unknown as ProductTemplateDraft;

test("targets: every row with a long dimension text, in every group kind; short, empty and missing ones are skipped", () => {
  const targets = buildDimensionTargets(draft());
  assert.deepEqual(targets.map((t) => t.text), [LONG, LONG, LONG, LONG, LONG]);
  assert.equal(targets.length, 5);
  const ids = new Set(flattenBatchSpecificationTargets(draft()).map((t) => t.targetId));
  assert.ok(targets.every((t) => ids.has(t.targetId)), "ids are the same ids the specification helper uses");
  assert.equal(new Set(targets.map((t) => t.targetId)).size, 5);
});
test("targets are sent in calls of at most 20", () => {
  const items = Array.from({ length: 45 }, (_, i) => ({ targetId: `t${i}`, label: "x", text: "y" }));
  assert.deepEqual(chunkDimensionTargets(items).map((c) => c.length), [20, 20, 5]);
  assert.deepEqual(chunkDimensionTargets([]), []);
});

test("validation drops invalid, equal, null, unknown, duplicate and longer results (the AI is never trusted)", () => {
  const items = [{ targetId: "a", text: LONG }, { targetId: "b", text: LONG }, { targetId: "c", text: LONG }, { targetId: "d", text: "W:520 D:615 H:1130 mm, total" }];
  const out = validateDimensionResults(items, [
    { targetId: "a", dimension: "W:520/680 D:615 H:1130 mm" },
    { targetId: "b", dimension: "W:520/700 D:615 H:1130 mm" },
    { targetId: "c", dimension: null },
    { targetId: "zzz", dimension: "W:520 mm" },
    { targetId: "a", dimension: "W:520 mm" },
    { targetId: "d", dimension: "W:520 D:615 H:1130 mm, total" },
  ]);
  assert.deepEqual(out, [{ targetId: "a", dimension: "W:520/680 D:615 H:1130 mm" }]);
});

test("apply changes only dimensions.rawText of the accepted rows and returns undo entries", () => {
  const before = draft();
  const id = buildDimensionTargets(before)[0].targetId;
  const { draft: after, undo } = applyDimensionPatches(before, [{ targetId: id, dimension: "W:520/680 D:615 H:1130 mm" }]);
  assert.deepEqual(undo, [{ targetId: id, before: LONG, after: "W:520/680 D:615 H:1130 mm" }]);
  const changed = after.pricing.baseModelRows[0];
  assert.equal(changed.dimensions?.rawText, "W:520/680 D:615 H:1130 mm");
  assert.deepEqual({ ...changed, dimensions: { ...changed.dimensions!, rawText: LONG } }, before.pricing.baseModelRows[0], "nothing else changed: numbers, spec, codes, price");
  assert.deepEqual({ ...after, pricing: { ...after.pricing, baseModelRows: before.pricing.baseModelRows } }, before, "no other row changed");
  assert.deepEqual(applyDimensionPatches(before, [{ targetId: "nope", dimension: "W:1 mm" }]).undo, []);
});

test("undo restores only rows that still hold the shortened text", () => {
  const start = draft();
  const targets = buildDimensionTargets(start);
  const { draft: shortened, undo } = applyDimensionPatches(start, targets.slice(0, 2).map((t) => ({ targetId: t.targetId, dimension: "W:520/680 D:615 H:1130 mm" })));
  const edited = structuredClone(shortened);
  edited.pricing.baseModelRows[0].dimensions!.rawText = "typed by the user";
  const result = undoDimensionPatches(edited, undo);
  assert.equal(result.restored, 1); assert.equal(result.kept, 1);
  assert.equal(result.draft.pricing.baseModelRows[0].dimensions?.rawText, "typed by the user");
  assert.equal(result.draft.pricing.workstationRows[0].dimensions?.rawText, LONG);
});

test("stale detection: the fingerprint changes when a target text changes, not when another field does", () => {
  const a = draft(), b = draft();
  assert.equal(dimensionFingerprint(a), dimensionFingerprint(b));
  b.pricing.baseModelRows[0].specification = "changed spec";
  assert.equal(dimensionFingerprint(a), dimensionFingerprint(b));
  b.pricing.baseModelRows[0].dimensions!.rawText = "other";
  assert.notEqual(dimensionFingerprint(a), dimensionFingerprint(b));
});

test("accepting uses only selected rows whose edited text still passes the check", () => {
  const entries = [
    { targetId: "a", original: LONG, value: "W:520/680 D:615 H:1130 mm", selected: true },
    { targetId: "b", original: LONG, value: "W:520 D:615 mm", selected: false },
    { targetId: "c", original: LONG, value: "W:999 mm", selected: true },
    { targetId: "d", original: LONG, value: "W:520 D:615 mm", selected: true },
  ];
  assert.deepEqual(acceptableDimensionPatches(entries), [{ targetId: "a", dimension: "W:520/680 D:615 H:1130 mm" }, { targetId: "d", dimension: "W:520 D:615 mm" }]);
});

test("the provider answer must be exactly one result per requested id", () => {
  const ok = parseDimensionShorteningResult([{ targetId: "a", dimension: "W:1 mm" }, { targetId: "b", dimension: null }], ["a", "b"]);
  assert.deepEqual(ok, [{ targetId: "a", dimension: "W:1 mm" }, { targetId: "b", dimension: null }]);
  assert.equal(parseDimensionShorteningResult([{ targetId: "a", dimension: "x" }], ["a", "b"]), null);
  assert.equal(parseDimensionShorteningResult([{ targetId: "a", dimension: "x" }, { targetId: "a", dimension: "x" }], ["a", "b"]), null);
  assert.equal(parseDimensionShorteningResult([{ targetId: "a", dimension: 5 }, { targetId: "b", dimension: null }], ["a", "b"]), null);
  assert.equal(parseDimensionShorteningResult([{ targetId: "a", dimension: "x", extra: 1 }, { targetId: "b", dimension: null }], ["a", "b"]), null);
  assert.equal(parseDimensionShorteningResult("nope", ["a"]), null);
});
