import assert from "node:assert/strict";
import test from "node:test";
import { applyManufacturerFieldPatches, defaultManufacturerFieldSelection, manufacturerFieldPatchKey, manufacturerPatchGroups, selectedManufacturerFieldPatches, type ManufacturerFieldPatch } from "./manufacturer-field-patches.js";

const rowPatch = (section: "base_model" | "accessory", field: "price" | "specification" | "displayName" | "dimensions" | "currency", currentValue: unknown, incomingValue: unknown): ManufacturerFieldPatch => ({ scope: "row", section, pricingType: section, groupId: section === "base_model" ? "base" : "accessories", groupName: "Group", rowId: "row", subgroupId: "sub", subgroupName: "Readable", displayName: "Current", supplierCode: "CODE", field, currentValue, incomingValue });
const snapshot = () => ({ template_name: "Current", description: "Keep", default_specification: "Old", origin: "Italy", supplier_name: "LAS", item_code: "MON", internal_selection_name: "Internal", desking_size_pricing: JSON.stringify([{ id: "workstations", subgroups: [{ id: "ws-sub", row_ids: ["ws"] }], items: [{ id: "ws", label: "WS", default_price: 50, additional_price: 5, currency: "EUR", specification: "WS old", layout_type: "Linear", default_dimension: "W200" }] }]), category_pricing: JSON.stringify([{ id: "matrix", price_categories: ["A", "B"], items: [{ id: "matrix-row", prices: { A: 1, B: 2 }, specification: "Matrix old" }] }]), modular_item_pricing: JSON.stringify([{ id: "modular", pricing_type: "modular_group", hierarchy: { keep: true }, items: [{ id: "module", prices: { A: 3 }, specification: "Module old" }] }]), variant_pricing: JSON.stringify([{ id: "base", pricing_type: "base_model_group", group_name: "Base", subgroups: [{ id: "sub", subgroup_name: "Readable", row_ids: ["row"] }], items: [{ id: "row", display_name: "Current", price: 100, currency: "EUR", specification: "Old", dimension: "W100", is_active: false }] }]), accessory_pricing: JSON.stringify([{ id: "accessories", conditional_configuration: { role: "companion", allowed_item_ids: ["row"] }, items: [{ id: "row", item_name: "Current", price: 10, specification: "Keep" }] }]) });

test("field patches are independent and preserve protected row structures", () => {
  const current = snapshot(); const beforeAccessory = JSON.parse(current.accessory_pricing)[0];
  const result = applyManufacturerFieldPatches(current, [rowPatch("base_model", "price", 100, 120), rowPatch("base_model", "displayName", "Current", "Incoming")]);
  assert.equal(result.ok, true); if (!result.ok) return;
  const group = result.state.variantPricing[0]; const row = (group.items as Record<string, unknown>[])[0];
  assert.equal(row.price, 120); assert.equal(row.display_name, "Incoming"); assert.equal(row.specification, "Old"); assert.equal(row.is_active, false); assert.deepEqual(result.state.accessoryPricing[0], beforeAccessory); assert.deepEqual(group.subgroups, [{ id: "sub", subgroup_name: "Readable", row_ids: ["row"] }]);
});

test("template, dimensions, currency, and accessory fields apply independently", () => {
  const dimension = (rawText: string) => ({ width: null, depth: null, height: null, diameter: null, unit: null, rawText });
  const patches: ManufacturerFieldPatch[] = [
    { scope: "template", section: "template", field: "specification", currentValue: "Old", incomingValue: "New" },
    rowPatch("base_model", "dimensions", dimension("W100"), dimension("W120")), rowPatch("base_model", "currency", "EUR", "USD"), rowPatch("accessory", "specification", "Keep", "Incoming accessory"),
  ];
  const result = applyManufacturerFieldPatches(snapshot(), patches); assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.state.templateValues.default_specification, "New");
  const base = (result.state.variantPricing[0].items as Record<string, unknown>[])[0]; assert.deepEqual([base.dimension, base.currency], ["W120", "USD"]);
  assert.equal((result.state.accessoryPricing[0].items as Record<string, unknown>[])[0].specification, "Incoming accessory");
});

test("stale and missing targets fail atomically", () => {
  const stale = rowPatch("base_model", "price", 999, 120); const missing = { ...rowPatch("accessory", "price", 10, 20), rowId: "missing" };
  const result = applyManufacturerFieldPatches(snapshot(), [stale, missing]); assert.equal(result.ok, false);
});

test("workstation prices, matrix cells, and modular cells patch without rebuilding structure", () => {
  const identity = (pricingType: "workstation" | "category_matrix" | "modular", groupId: string, rowId: string, field: "default_price" | "additional_price" | "price", currentValue: number, incomingValue: number, columnId?: string): ManufacturerFieldPatch => ({ scope: "row", section: pricingType, pricingType, groupId, groupName: groupId, rowId, subgroupId: null, subgroupName: null, displayName: rowId, supplierCode: null, field, currentValue, incomingValue, ...(columnId ? { columnId, columnLabel: columnId } : {}) });
  const current = snapshot(); const modularBefore = JSON.parse(current.modular_item_pricing)[0].hierarchy;
  const result = applyManufacturerFieldPatches(current, [identity("workstation", "legacy-workstation-main", "ws", "default_price", 50, 60), identity("workstation", "legacy-workstation-main", "ws", "additional_price", 5, 6), identity("category_matrix", "matrix", "matrix-row", "price", 1, 11, "A"), identity("modular", "modular", "module", "price", 3, 33, "A")]);
  assert.equal(result.ok, true); if (!result.ok) return;
  const workstation = (result.state.deskingSizePricing[0].items as Record<string, unknown>[])[0]; assert.deepEqual([workstation.default_price, workstation.additional_price, workstation.specification], [60, 6, "WS old"]);
  assert.deepEqual((result.state.categoryPricing[0].items as Record<string, unknown>[])[0].prices, { A: 11, B: 2 });
  assert.equal(((result.state.modularPricing[0].items as Record<string, unknown>[])[0].prices as Record<string, unknown>).A, 33); assert.deepEqual(result.state.modularPricing[0].hierarchy, modularBefore);
});

test("stale template fields fail before exposing a patched state", () => {
  const result = applyManufacturerFieldPatches(snapshot(), [{ scope: "template", section: "template", field: "templateName", currentValue: "Stale", incomingValue: "Incoming" }]);
  assert.equal(result.ok, false);
});

test("section scope excludes other sections and non-price fields default to Keep Existing", () => {
  const basePrice = rowPatch("base_model", "price", 100, 120); const baseSpec = rowPatch("base_model", "specification", "Old", "New"); const accessoryPrice = rowPatch("accessory", "price", 10, 20); const patches = [basePrice, baseSpec, accessoryPrice];
  const baseSections = new Set(["base_model" as const]); const defaults = defaultManufacturerFieldSelection(patches, baseSections);
  assert.deepEqual([...defaults], [manufacturerFieldPatchKey(basePrice)]);
  assert.deepEqual(selectedManufacturerFieldPatches(patches, baseSections, defaults), [basePrice]);
  const multiple = new Set(["base_model" as const, "accessory" as const]); const selected = new Set([manufacturerFieldPatchKey(baseSpec), manufacturerFieldPatchKey(accessoryPrice)]);
  assert.deepEqual(selectedManufacturerFieldPatches(patches, multiple, selected), [baseSpec, accessoryPrice]);
});

test("view grouping keeps all item fields together beneath their readable group", () => {
  const one = { ...rowPatch("base_model", "price", 100, 120), groupId: "executive", groupName: "Executive Desks", rowId: "one", displayName: "Desk W210", supplierCode: "1AF001" };
  const oneSpec = { ...one, field: "specification" as const, currentValue: "Old", incomingValue: "New" };
  const two = { ...rowPatch("base_model", "dimensions", "W210", "W220"), groupId: "executive", groupName: "Executive Desks", rowId: "two", displayName: "Desk W240", supplierCode: "1AF002" };
  const accessory = { ...rowPatch("accessory", "price", 10, 20), groupId: "service", groupName: "Service Units", rowId: "service-1" };
  const groups = manufacturerPatchGroups([one, oneSpec, two, accessory]);
  assert.equal(groups.length, 2); assert.deepEqual(groups[0].items.map((item) => [item.title, item.patches.length]), [["Desk W210", 2], ["Desk W240", 1]]);
  assert.equal(groups[0].items[0].patches[0].field, "price"); assert.equal(groups[0].items[0].patches[1].field, "specification");
});
