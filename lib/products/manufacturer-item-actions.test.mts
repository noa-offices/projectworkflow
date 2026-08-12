import assert from "node:assert/strict";
import test from "node:test";
import { applyManufacturerUpdateActions, selectedManufacturerItemActions, type ManufacturerItemAction } from "./manufacturer-item-actions.js";
import type { ManufacturerNewCandidate, ManufacturerNotFoundItem } from "./manufacturer-update-diff.js";

const dimension = { width: 200, depth: 55, height: 54, diameter: null, unit: "cm", rawText: "W200 × D55 × H54 cm" };
const candidate = (pricingType: "accessory" | "base_model" | "category_matrix" = "accessory"): ManufacturerNewCandidate => ({ status: "NEW_CANDIDATE", pricingType, incoming: { routeKey: "matrix:new", groupId: pricingType === "accessory" ? "accessories" : "incoming", rowId: "ai-row", displayName: "Service Unit W200 - Right", supplierCode: "1AF097", referenceCode: null }, groupName: "Support Service Units", proposedDestination: pricingType, currency: "EUR", price: pricingType === "category_matrix" ? { incomingA: 10 } : 1850, columns: pricingType === "category_matrix" ? [{ id: "incomingA", label: "Cat A" }] : [{ id: "price", label: "Price" }], row: { id: "ai-row", label: "Service Unit", displayName: "Service Unit W200 - Right", supplierCodes: ["1AF097"], referenceCodes: [], currency: "EUR", specification: "Incoming specification", dimensions: dimension, price: null, prices: pricingType === "category_matrix" ? { incomingA: 10 } : { price: 1850 } } as ManufacturerNewCandidate["row"] });
const missing: ManufacturerNotFoundItem = { status: "NOT_FOUND_IN_IMPORTED_SOURCE", meaning: "not represented in this incoming JSON", existing: { pricingType: "accessory", groupId: "accessories", groupName: "Accessories", rowId: "old", subgroupId: null, subgroupName: null, displayName: "Old Item", supplierCode: "OLD" }, displayName: "Old Item", supplierCode: "OLD" };
const snapshot = () => ({ template_name: "Current", description: "", default_specification: "", origin: "", supplier_name: "", item_code: "", internal_selection_name: "", desking_size_pricing: "[]", variant_pricing: "[]", category_pricing: JSON.stringify([{ id: "matrix", group_name: "Matrix", price_categories: ["Cat B"], items: [] }]), modular_item_pricing: JSON.stringify([{ id: "modules", pricing_type: "modular_group", group_name: "Modules", price_categories: ["Cat A"], hierarchy: { keep: true }, items: [] }]), accessory_pricing: JSON.stringify([{ id: "accessories", group_name: "Accessories", conditional_configuration: { role: "companion", selection: "exactly_one", applicability: [{ allowed_item_ids: ["old"], fixed_quantity: 1 }] }, subgroups: [{ id: "right", subgroup_name: "Right", row_ids: [] }], items: [{ id: "old", item_name: "Old Item", supplier_price_list_code: "OLD", price: 100, specification: "Keep", is_active: true }] }]) });

test("new candidates default to no action and Add preserves existing accessory configuration", () => {
  const current = snapshot(); const before = JSON.parse(current.accessory_pricing)[0].conditional_configuration;
  const skipped = applyManufacturerUpdateActions(current, [], []); assert.equal(skipped.ok, true); if (!skipped.ok) return; assert.equal((skipped.state.accessoryPricing[0].items as unknown[]).length, 1);
  const action: ManufacturerItemAction = { kind: "add", candidate: candidate(), destination: "accessory", target: "existing", groupId: "accessories", groupName: "Accessories", subgroupId: "right" };
  const added = applyManufacturerUpdateActions(current, [], [action], () => "local-new-id"); assert.equal(added.ok, true); if (!added.ok) return;
  const group = added.state.accessoryPricing[0]; const item = (group.items as Record<string, unknown>[])[1];
  assert.deepEqual([item.id, item.item_name, item.supplier_price_list_code, item.price, item.currency, item.specification, item.dimension], ["local-new-id", "Service Unit W200 - Right", "1AF097", 1850, "EUR", "Incoming specification", "W200 × D55 × H54 cm"]);
  assert.deepEqual(group.conditional_configuration, before); assert.deepEqual((group.subgroups as Record<string, unknown>[])[0].row_ids, ["local-new-id"]);
});

test("new group creation uses local IDs and preserves existing groups", () => {
  const current = snapshot(); const action: ManufacturerItemAction = { kind: "add", candidate: candidate("base_model"), destination: "base_model", target: "new", groupId: "new-desks", groupName: "New Desks", subgroupId: null };
  const ids = ["local-group", "local-desk"]; const result = applyManufacturerUpdateActions(current, [], [action], () => ids.shift()!); assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual([result.state.variantPricing[0].id, result.state.variantPricing[0].group_name], ["local-group", "New Desks"]); assert.equal((result.state.variantPricing[0].items as Record<string, unknown>[])[0].id, "local-desk");
});

test("new accessory group uses reviewed configuration and model rule semantics", () => {
  const action: ManufacturerItemAction = { kind: "add", candidate: candidate(), destination: "accessory", target: "new", groupId: "incoming", groupName: "New Companions", subgroupId: null, accessoryRole: "companion", accessorySelection: "exactly_one", accessoryModel: { groupId: "desks", rowId: "desk-1" }, fixedQuantity: 1 };
  const ids = ["accessory-group", "accessory-row"]; const result = applyManufacturerUpdateActions(snapshot(), [], [action], () => ids.shift()!); assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.state.accessoryPricing[1].conditional_configuration, { role: "companion", selection: "exactly_one", applicability: [{ base_model_group_id: "desks", base_model_row_id: "desk-1", required: true, visible: true, allowed_item_ids: ["accessory-row"], fixed_quantity: 1 }] });
});

test("Mark Inactive changes only active state and defaults to Keep Existing", () => {
  const current = snapshot(); const before = JSON.parse(current.accessory_pricing)[0].items[0];
  const kept = applyManufacturerUpdateActions(current, [], []); assert.equal(kept.ok && (kept.state.accessoryPricing[0].items as Record<string, unknown>[])[0].is_active, true);
  const result = applyManufacturerUpdateActions(current, [], [{ kind: "inactive", item: missing }]); assert.equal(result.ok, true); if (!result.ok) return;
  const item = (result.state.accessoryPricing[0].items as Record<string, unknown>[])[0]; assert.deepEqual({ ...item, is_active: true }, before); assert.equal(item.is_active, false);
});

test("incompatible matrix columns and stale targets fail atomically", () => {
  const matrix: ManufacturerItemAction = { kind: "add", candidate: candidate("category_matrix"), destination: "category_matrix", target: "existing", groupId: "matrix", groupName: "Matrix", subgroupId: null };
  const result = applyManufacturerUpdateActions(snapshot(), [], [matrix, { kind: "inactive", item: { ...missing, supplierCode: "STALE" } }], () => "matrix-row"); assert.equal(result.ok, false);
});

test("new modular item preserves its existing group hierarchy", () => {
  const modularCandidate = { ...candidate("category_matrix"), pricingType: "modular" as const, incoming: { ...candidate("category_matrix").incoming, groupId: "modules" } };
  const action: ManufacturerItemAction = { kind: "add", candidate: modularCandidate, destination: "modular", target: "existing", groupId: "modules", groupName: "Modules", subgroupId: null };
  const current = snapshot(); const hierarchy = JSON.parse(current.modular_item_pricing)[0].hierarchy;
  const result = applyManufacturerUpdateActions(current, [], [action], () => "module-new"); assert.equal(result.ok, true); if (!result.ok) return; assert.deepEqual(result.state.modularPricing[0].hierarchy, hierarchy);
});

test("item actions are limited to selected pricing sections", () => {
  const actions: ManufacturerItemAction[] = [
    { kind: "add", candidate: candidate(), destination: "accessory", target: "existing", groupId: "accessories", groupName: "Accessories", subgroupId: null },
    { kind: "inactive", item: missing },
    { kind: "add", candidate: candidate("base_model"), destination: "base_model", target: "new", groupId: "incoming", groupName: "Desks", subgroupId: null },
  ];
  assert.deepEqual(selectedManufacturerItemActions(actions, new Set(["base_model"])), [actions[2]]);
});
