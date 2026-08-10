import assert from "node:assert/strict";
import test from "node:test";
import { getSmartSetupConflictLabels, getSmartSetupOverwriteConflicts } from "./smart-product-apply-state.js";

test("overwrite conflicts require both draft and current section data", () => {
  const draft = { workstation: true, baseModel: false, category: false, modular: false, accessory: true };
  const current = { workstation: true, baseModel: true, category: false, modular: false, accessory: false };
  assert.deepEqual(getSmartSetupOverwriteConflicts(draft, current), ["workstation"]);
});

test("conflict labels are stable and only include matching sections", () => {
  assert.deepEqual(getSmartSetupConflictLabels(["workstation", "accessory"]), ["Workstation Pricing", "Accessory Pricing"]);
});

test("all five conflicts and labels retain the expected section order", () => {
  const all = { workstation: true, baseModel: true, category: true, modular: true, accessory: true };
  const conflicts = getSmartSetupOverwriteConflicts(all, all);
  assert.deepEqual(conflicts, ["workstation", "baseModel", "category", "modular", "accessory"]);
  assert.deepEqual(getSmartSetupConflictLabels(conflicts), [
    "Workstation Pricing",
    "Base / Model Pricing",
    "Finish / Category Pricing",
    "Modular Item Pricing",
    "Accessory Pricing",
  ]);
});
