import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mapDraftBaseModelPricing } from "./product-template-draft-base-model-adapter.js";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace.js";
import { createSmartSaveTracker } from "./smart-setup-section-apply.js";

const form = readFileSync("components/products/product-template-form.tsx", "utf8");
const smart = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
const hook = readFileSync("components/products/use-replacement-commit.ts", "utf8");
const variantTables = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
const desking = readFileSync("components/products/desking-size-pricing-table.tsx", "utf8");

const empty = { desking_size_pricing: "[]", variant_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]", currency: "AED" };
const groups = (activeA: unknown, activeB: unknown) => JSON.stringify([
  { id: "a", pricing_type: "base_model_group", group_name: "A", ...(activeA === undefined ? {} : { is_active: activeA }), sort_order: 0, items: [{ id: "a1", variant_name: "A1", price: 1, currency: "AED", is_active: true }] },
  { id: "b", pricing_type: "base_model_group", group_name: "B", ...(activeB === undefined ? {} : { is_active: activeB }), sort_order: 1, items: [{ id: "b1", variant_name: "B1", price: 2, currency: "AED", is_active: true }] },
]);

// ---- native group is_active ----
test("an inactive native group stays inactive after reopen/apply, without touching its (active) rows", () => {
  const mapped = mapDraftBaseModelPricing(productTemplateFormSmartWorkspace({ ...empty, variant_pricing: groups(false, true) }).draft);
  assert.deepEqual(mapped.groups.map((group) => [group.id, group.is_active]), [["a", false], ["b", true]]);
  assert.deepEqual(mapped.groups[0].items.map((item) => item.is_active), [true]);
});

test("an active native group stays active; a group without an explicit flag keeps the prior (active) default", () => {
  const explicit = mapDraftBaseModelPricing(productTemplateFormSmartWorkspace({ ...empty, variant_pricing: groups(true, true) }).draft);
  assert.deepEqual(explicit.groups.map((group) => group.is_active), [true, true]);
  // Explicit groups must carry a boolean flag (contract); flat legacy rows (no groups at all) keep the prior default.
  const legacy = mapDraftBaseModelPricing(productTemplateFormSmartWorkspace({ ...empty, variant_pricing: JSON.stringify([{ id: "r", variant_name: "R", price: 1, currency: "AED" }]) }).draft);
  assert.deepEqual(legacy.rows.map((row) => row.is_active), [true]);
  assert.equal(legacy.groups.length, 0);
});

test("group activity is not inferred from rows: an active group with only inactive rows stays active", () => {
  const saved = JSON.stringify([{ id: "g", pricing_type: "base_model_group", group_name: "G", is_active: true, sort_order: 0, items: [{ id: "r", variant_name: "R", price: 1, currency: "AED", is_active: false }] }]);
  const mapped = mapDraftBaseModelPricing(productTemplateFormSmartWorkspace({ ...empty, variant_pricing: saved }).draft);
  assert.equal(mapped.groups[0].is_active, true);
  assert.equal(mapped.groups[0].items[0].is_active, false);
});

// ---- explicit commit tracker ----
test("Save Changes does not become ready before every replaced section has committed its exact version", () => {
  const tracker = createSmartSaveTracker({ baseModel: 4, accessory: 2 });
  assert.equal(tracker.committed("baseModel", 4), false);
  assert.deepEqual(tracker.pendingSections(), ["accessory"]);
  assert.equal(tracker.committed("accessory", 1), false, "a stale version does not count");
  assert.equal(tracker.committed("category", 9), false, "an unexpected section does not count");
  assert.equal(tracker.committed("accessory", 2), true);
});

test("the tracker announces readiness exactly once (a duplicate commit report never submits twice)", () => {
  const tracker = createSmartSaveTracker({ baseModel: 1 });
  assert.equal(tracker.committed("baseModel", 1), true);
  assert.equal(tracker.committed("baseModel", 1), false);
  assert.equal(tracker.readyNow(), false);
});

test("nothing replaced (no section changed) is ready immediately and only once", () => {
  const tracker = createSmartSaveTracker({});
  assert.equal(tracker.readyNow(), true);
  assert.equal(tracker.readyNow(), false);
});

// ---- mechanism ----
test("no fixed animation-frame / timeout / polling mechanism remains in the save bridge", () => {
  // (the form has one unrelated scroll-into-view frame callback; only the save bridge region is inspected)
  const start = form.indexOf("Edit-in-Smart-Setup");
  const bridge = form.slice(start, form.indexOf("return \"pending\" as const;", start));
  assert.ok(bridge.length > 500, "bridge region located");
  assert.equal(/requestAnimationFrame|setTimeout|setInterval/.test(bridge), false);
  assert.equal(form.includes("smartSavePhase"), false);
  assert.equal(hook.includes("requestAnimationFrame") || hook.includes("setTimeout"), false);
});

test("each section replacement consumer reports its committed version through the shared commit signal", () => {
  assert.equal(variantTables.split("markReplacementApplied(replacementVersion);").length - 1, 4);
  assert.equal(desking.split("markReplacementApplied(replacementVersion);").length - 1, 1);
  assert.ok(hook.includes("commits.current <= current.appliedAtCommit"), "fires only on a later commit than the one that applied the replacement");
  assert.ok(form.includes("version: nextReplacementVersion(\"baseModel\", baseModelReplacement)"), "expected versions are known before submit");
});

test("Smart Setup stays open on a pending save and only closes for a completed ordinary Apply", () => {
  assert.ok(smart.includes('else if (response !== "pending") transferAndClearImages('));
  assert.ok(form.includes('return "pending" as const;'));
});

// ---- regressions ----
test("ordinary Apply-to-Product-Template import flow and quick-edit save are unchanged", () => {
  assert.ok(form.includes('<SmartProductJsonImport buttonLabel="Import & Review JSON" onRequestApply={requestSmartDraftApply} />'));
  assert.ok(smart.includes("Apply to Product Template"));
  assert.ok(form.includes("action={submitWithPendingImages}"));
  assert.ok(form.includes('const baseSubmitAction = onSubmitAction ?? (submitMode === "update" ? updateProductTemplate : createProductTemplate);'));
  assert.equal(form.split("createProductTemplate(").length - 1, 0, "the edit flow never calls the create action directly");
});
