import assert from "node:assert/strict";
import test from "node:test";
import { materialTextForSubgroup } from "./material-subgroup-sync";

test("sub-group with a grade: collection = name, category = grade", () => {
  assert.deepEqual(materialTextForSubgroup({ name: " CREPE ", grade: " CAT B " }), { material_category: "CAT B", material_collection: "CREPE" });
});

test("sub-group without a grade (or a blank grade): category = name, collection = null", () => {
  assert.deepEqual(materialTextForSubgroup({ name: "ECO-PELLE", grade: null }), { material_category: "ECO-PELLE", material_collection: null });
  assert.deepEqual(materialTextForSubgroup({ name: "TIME", grade: "  " }), { material_category: "TIME", material_collection: null });
});

test("no sub-group: nothing to sync, the old text columns keep today's behaviour", () => {
  assert.equal(materialTextForSubgroup(null), null);
  assert.equal(materialTextForSubgroup(undefined), null);
});
