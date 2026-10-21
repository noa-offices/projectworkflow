import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReviewRows, chunkImportRows, evaluateRows } from "./pdf-import-rows";
const swatch = { box: { x: 0, y: 0, w: 0.1, h: 0.1 }, code: " A01 ", collection: "TIME", grade: "CAT C", confidence: 1, namePrimary: "Rosso", nameEnglish: "Red", nameOther: "Rouge" };
const time = { id: "s", name: "time", grade: "cat c" };
const here = (code: string, subgroupId: string | null = "s") => ({ code, label: subgroupId ? "CAT C - Time" : "", subgroupId });

test("same code in the same sub-group is a duplicate (case and spaces ignored); a new sub-group cannot collide", () => {
  const blocked = buildReviewRows([swatch], "english", [time], [here("a01")])[0];
  assert.equal(blocked.duplicate, true);
  assert.equal(blocked.checked, false);
  const fresh = buildReviewRows([swatch], "english", [], [here("a01", "other")])[0];
  assert.equal(fresh.duplicate, false);
  assert.equal(fresh.checked, false); // also in another sub-group: allowed, but unticked by default
  assert.deepEqual(fresh.alsoIn, ["CAT C - Time"]);
  const clean = buildReviewRows([swatch], "english", [], [])[0];
  assert.equal(clean.checked, true);
  assert.equal(clean.name, "Red");
  assert.deepEqual(fresh.newSubgroup, { name: "TIME", grade: "CAT C" });
});

test("same code in another sub-group is allowed and listed as 'also in'", () => {
  const row = buildReviewRows([swatch], "english", [time], [{ code: "A01", label: "CAT B - Crepe", subgroupId: "crepe" }])[0];
  assert.equal(row.duplicate, false);
  assert.equal(row.checked, false);
  assert.deepEqual(row.alsoIn, ["CAT B - Crepe"]);
  // null sub-group equals only null: a code directly in the group does not block a sub-group row.
  const direct = buildReviewRows([swatch], "english", [time], [here("A01", null)])[0];
  assert.equal(direct.duplicate, false);
  assert.deepEqual(direct.alsoIn, ["No sub-group"]);
  const blockedDirect = evaluateRows([{ code: "A01", newSubgroup: null, subgroupId: null }], [here("a01 ", null)]);
  assert.equal(blockedDirect[0].duplicate, true);
});

test("two rows with the same code and the same target: the second is a duplicate; different targets are fine", () => {
  const states = evaluateRows(
    [
      { code: "B1", newSubgroup: null, subgroupId: "s" },
      { code: " b1", newSubgroup: null, subgroupId: "s" },
      { code: "B1", newSubgroup: null, subgroupId: "t" },
      { code: "B1", newSubgroup: { name: "ONE", grade: null }, subgroupId: null },
      { code: "B1", newSubgroup: { name: "one", grade: null }, subgroupId: null },
    ],
    [],
  );
  assert.deepEqual(states.map((state) => state.duplicate), [false, true, false, false, true]);
});

test("matches subgroups and leaves nameless rows unchecked; empty codes allowed", () => {
  const row = buildReviewRows([swatch], "italian", [time], [])[0];
  assert.equal(row.subgroupId, "s"); assert.equal(row.newSubgroup, null);
  assert.equal(buildReviewRows([{ ...swatch, namePrimary: "", nameEnglish: "" }], "english", [], [])[0].checked, false);
  assert.equal(buildReviewRows([{ ...swatch, code: "" }], "english", [], [here("")])[0].checked, true);
});

test("chunks into twenty without dropping rows", () => {
  const rows = Array.from({ length: 41 }, (_, i) => i);
  assert.deepEqual(chunkImportRows(rows).map((chunk) => chunk.length), [20, 20, 1]);
  assert.deepEqual(chunkImportRows(rows).flat(), rows);
  assert.deepEqual(chunkImportRows([]), []);
});
