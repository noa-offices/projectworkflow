import assert from "node:assert/strict";
import test from "node:test";
import { mapDraftBaseModelPricing } from "./product-template-draft-base-model-adapter.js";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter.js";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter.js";
import { mapDraftModularPricing } from "./product-template-draft-modular-adapter.js";
import { mapDraftWorkstationPricing } from "./product-template-draft-workstation-adapter.js";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace.js";
import { smartReviewMatrixOverrides } from "./smart-product-review-routing.js";
import { smartSetupSectionActions } from "./smart-setup-section-apply.js";

const empty = { desking_size_pricing: "[]", variant_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]" };
const workspace = (overrides: Record<string, string>) => productTemplateFormSmartWorkspace({ ...empty, currency: "AED", ...overrides });

test("1: an inactive Base/Model row stays inactive through reopen and Apply", () => {
  const ws = workspace({ variant_pricing: JSON.stringify([{ id: "a", variant_name: "A", price: 1, currency: "AED", is_active: false }, { id: "b", variant_name: "B", price: 2, currency: "AED", is_active: true }]) });
  const mapped = mapDraftBaseModelPricing(ws.draft);
  assert.deepEqual(mapped.rows.map((row) => [row.id, row.is_active]), [["a", false], ["b", true]]);
});

test("2: inactive Matrix rows and groups stay inactive; active ones stay active", () => {
  const ws = workspace({ category_pricing: JSON.stringify([{ id: "g", group_name: "Finishes", price_categories: ["A", "B"], is_active: false, sort_order: 0, items: [{ id: "r1", variant_name: "R1", prices: { A: 1, B: 2 }, is_active: false, sort_order: 0 }, { id: "r2", variant_name: "R2", prices: { A: 1, B: 2 }, sort_order: 1 }] }]) });
  const mapped = mapDraftPriceMatricesToCategoryGroups(ws.draft, smartReviewMatrixOverrides(ws.plan));
  assert.equal(mapped.groups[0].is_active, false);
  assert.deepEqual(mapped.groups[0].items.map((item) => [item.id, item.is_active]), [["r1", false], ["r2", true]]);
});

test("3: inactive Direct Modular rows and groups stay inactive", () => {
  const ws = workspace({ modular_item_pricing: JSON.stringify([{ id: "m", group_name: "Modules", pricing_type: "modular_group", modular_pricing_mode: "direct", price_categories: [], is_active: false, sort_order: 0, modular_composition: { min_starters: 1, max_starters: 1 }, items: [{ id: "s1", variant_name: "S1", price: 5, modular_role: "starter", is_active: false, sort_order: 0 }, { id: "s2", variant_name: "S2", price: 6, modular_role: "starter", sort_order: 1 }] }]) });
  const mapped = mapDraftModularPricing(ws.draft);
  assert.equal(mapped.groups[0].is_active, false);
  assert.deepEqual(mapped.groups[0].items.map((item) => [item.id, item.is_active]), [["s1", false], ["s2", true]]);
});

test("4: an inactive Workstation row stays inactive", () => {
  const ws = workspace({ desking_size_pricing: JSON.stringify([{ id: "w1", label: "W1", default_price: 10, currency: "AED", is_active: false }, { id: "w2", label: "W2", default_price: 11, currency: "AED" }]) });
  const mapped = mapDraftWorkstationPricing(ws.draft);
  assert.deepEqual(mapped.rows.map((row) => [row.id, row.is_active]), [["w1", false], ["w2", true]]);
});

test("5: an inactive Accessory item and group stay inactive", () => {
  const ws = workspace({ accessory_pricing: JSON.stringify([{ id: "acc", group_name: "Acc", is_active: false, group_is_required: false, sort_order: 0, items: [{ id: "i1", item_name: "I1", price: 3, is_active: false, sort_order: 0 }, { id: "i2", item_name: "I2", price: 4, sort_order: 1 }] }]) });
  const mapped = mapDraftOptionGroupsToAccessories(ws.draft, ws.plan);
  assert.equal(mapped.groups[0].is_active, false);
  assert.deepEqual(mapped.groups[0].items.map((item) => [item.id, item.is_active]), [["i1", false], ["i2", true]]);
});

test("6: saved sort_order decides order on reopen and is re-emitted sequentially (no reordering)", () => {
  const ws = workspace({ variant_pricing: JSON.stringify([{ id: "b", variant_name: "B", price: 1, currency: "AED", sort_order: 1 }, { id: "a", variant_name: "A", price: 1, currency: "AED", sort_order: 0 }]), accessory_pricing: JSON.stringify([{ id: "g2", group_name: "Two", sort_order: 1, items: [{ id: "x", item_name: "X", price: 1, sort_order: 0 }] }, { id: "g1", group_name: "One", sort_order: 0, items: [{ id: "y", item_name: "Y", price: 1, sort_order: 0 }] }]) });
  assert.deepEqual(mapDraftBaseModelPricing(ws.draft).rows.map((row) => [row.id, row.sort_order]), [["a", 0], ["b", 1]]);
  assert.deepEqual(mapDraftOptionGroupsToAccessories(ws.draft, ws.plan).groups.map((group) => [group.id, group.sort_order]), [["g1", 0], ["g2", 1]]);
});

test("7: Matrix row importantRequirements survive reopen and Apply", () => {
  const ws = workspace({ category_pricing: JSON.stringify([{ id: "g", group_name: "Finishes", price_categories: ["A"], items: [{ id: "r1", variant_name: "R1", prices: { A: 1 }, importantRequirements: ["Order 2 weeks ahead"] }] }]) });
  const mapped = mapDraftPriceMatricesToCategoryGroups(ws.draft, smartReviewMatrixOverrides(ws.plan));
  assert.deepEqual((mapped.groups[0].items[0] as { importantRequirements?: string[] }).importantRequirements, ["Order 2 weeks ahead"]);
});

test("8: separate saved Workstation groups stay separate with ids, names, order and subgroups", () => {
  const sub = { id: "sg", subgroup_name: "Family", sort_order: 0, is_active: true, row_ids: ["b1"] };
  const ws = workspace({ desking_size_pricing: JSON.stringify([
    { id: "wa", pricing_type: "workstation_group", group_name: "Alpha", is_active: true, sort_order: 0, items: [{ id: "a1", label: "A1", default_price: 1, currency: "AED", sort_order: 0 }] },
    { id: "wb", pricing_type: "workstation_group", group_name: "Beta", is_active: true, sort_order: 1, subgroups: [sub], items: [{ id: "b1", label: "B1", default_price: 2, currency: "AED", sort_order: 0 }] },
  ]) });
  const mapped = mapDraftWorkstationPricing(ws.draft, ws.subgroups["workstation:rows"]);
  assert.ok(mapped.pricing);
  assert.deepEqual(mapped.pricing!.map((group) => [group.id, group.group_name, (group.items as Array<{ id: string }>).map((item) => item.id)]), [["wa", "Alpha", ["a1"]], ["wb", "Beta", ["b1"]]]);
  assert.deepEqual((mapped.pricing![1].subgroups as Array<{ id: string; row_ids: string[] }>).map((entry) => [entry.id, entry.row_ids]), [["sg", ["b1"]]]);
  assert.equal(mapped.pricing![0].subgroups, undefined);
});

test("8b: a flat legacy Workstation list keeps the existing flat path (no group override)", () => {
  const ws = workspace({ desking_size_pricing: JSON.stringify([{ id: "w1", label: "W1", default_price: 1, currency: "AED" }]) });
  assert.equal(mapDraftWorkstationPricing(ws.draft).pricing, undefined);
});

test("9: a required plain accessory group stays required without gaining a conditional configuration", () => {
  const ws = workspace({ accessory_pricing: JSON.stringify([{ id: "req", group_name: "Required pick", group_is_required: true, sort_order: 0, items: [{ id: "i", item_name: "I", price: 1, sort_order: 0 }] }, { id: "opt", group_name: "Optional", group_is_required: false, sort_order: 1, items: [{ id: "j", item_name: "J", price: 1, sort_order: 0 }] }]) });
  const mapped = mapDraftOptionGroupsToAccessories(ws.draft, ws.plan);
  assert.deepEqual(mapped.groups.map((group) => [group.id, group.group_is_required, "conditional_configuration" in group]), [["req", true, false], ["opt", false, false]]);
  assert.deepEqual(mapped.errors, []);
});

test("10: accessory item unavailable_price_categories survive reopen and Apply", () => {
  const ws = workspace({ accessory_pricing: JSON.stringify([{ id: "cush", group_name: "Cushions", price_categories: [{ id: "B", label: "B" }, { id: "C", label: "C" }], items: [{ id: "c1", item_name: "C1", prices: { B: 1, C: null }, unavailable_price_categories: ["C"] }] }]) });
  const mapped = mapDraftOptionGroupsToAccessories(ws.draft, ws.plan);
  assert.deepEqual((mapped.groups[0].items[0] as { unavailable_price_categories?: string[] }).unavailable_price_categories, ["C"]);
});

// ---- whole-section clear safety ----
const none = { workstation: false, baseModel: false, category: false, modular: false, accessory: false };

test("11-12: an intentionally emptied section is cleared in edit mode", () => {
  const actions = smartSetupSectionActions({ incremental: true, changedSections: ["baseModel", "accessory"], hasContent: { ...none, workstation: true } });
  assert.equal(actions.baseModel, "clear");
  assert.equal(actions.accessory, "clear");
});

test("13: untouched sections are not cleared or applied in edit mode; imports never clear", () => {
  const edit = smartSetupSectionActions({ incremental: true, changedSections: ["baseModel"], hasContent: { ...none, baseModel: true } });
  assert.deepEqual(edit, { workstation: "skip", baseModel: "apply", category: "skip", modular: "skip", accessory: "skip" });
  const fresh = smartSetupSectionActions({ incremental: false, changedSections: [], hasContent: { ...none, category: true } });
  assert.deepEqual(fresh, { workstation: "skip", baseModel: "skip", category: "apply", modular: "skip", accessory: "skip" });
  const blocked = smartSetupSectionActions({ incremental: true, changedSections: ["modular"], hasContent: none, blocked: { modular: true } });
  assert.equal(blocked.modular, "skip");
});

test("14: native System/Base groupId/groupLabel/role/subgroups still round-trip", () => {
  const sub = { id: "fam", subgroup_name: "Family", sort_order: 0, is_active: true, row_ids: ["m1"] };
  const ws = workspace({ variant_pricing: JSON.stringify([{ id: "sys-a", pricing_type: "base_model_group", group_name: "System A", is_active: true, sort_order: 0, subgroups: [sub], items: [{ id: "base", variant_name: "Base", role: "system_base", price: 5, currency: "AED", sort_order: 0 }, { id: "m1", variant_name: "M1", price: 1, currency: "AED", sort_order: 1, is_active: false }] }]) });
  const mapped = mapDraftBaseModelPricing(ws.draft);
  assert.equal(mapped.groups[0].id, "sys-a");
  assert.equal(mapped.groups[0].group_name, "System A");
  assert.deepEqual(mapped.groups[0].items.map((item) => [item.id, (item as { role?: string }).role, item.is_active]), [["base", "system_base", true], ["m1", undefined, false]]);
  assert.deepEqual(ws.subgroups["base_model_group:sys-a"], [sub]);
});
