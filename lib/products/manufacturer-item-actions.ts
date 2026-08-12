import type { ManufacturerFieldPatch, ManufacturerFieldPatchState } from "./manufacturer-field-patches";
import { applyManufacturerFieldPatches } from "./manufacturer-field-patches";
import type { ManufacturerNewCandidate, ManufacturerNotFoundItem, ManufacturerPricingType } from "./manufacturer-update-diff";

type JsonRow = Record<string, unknown>;
export type ManufacturerNewItemAction = { kind: "add"; candidate: ManufacturerNewCandidate; destination: ManufacturerPricingType; target: "existing" | "new"; groupId: string; groupName: string; subgroupId: string | null; accessoryRole?: "accessory" | "conditional_option" | "companion"; accessorySelection?: "unrestricted" | "exactly_one" | "at_least_one" | "choose_multiple"; accessoryModel?: { groupId: string; rowId: string }; fixedQuantity?: number };
export type ManufacturerInactiveAction = { kind: "inactive"; item: ManufacturerNotFoundItem };
export type ManufacturerItemAction = ManufacturerNewItemAction | ManufacturerInactiveAction;

export function selectedManufacturerItemActions(actions: readonly ManufacturerItemAction[], selectedSections: { has(value: ManufacturerPricingType): boolean }) {
  return actions.filter((action) => selectedSections.has(action.kind === "add" ? action.candidate.pricingType : action.item.existing.pricingType));
}

const arrays = (state: ManufacturerFieldPatchState, type: ManufacturerPricingType) => type === "workstation" ? state.deskingSizePricing : type === "base_model" ? state.variantPricing : type === "category_matrix" ? state.categoryPricing : type === "modular" ? state.modularPricing : state.accessoryPricing;
const text = (value: unknown) => typeof value === "string" ? value : "";
const dimension = (value: unknown) => value && typeof value === "object" ? text((value as JsonRow).rawText) || ["width", "depth", "height"].map((key) => (value as JsonRow)[key]).filter((item) => item !== null && item !== undefined).join(" × ") : "";
const normalized = (value: string) => value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const groupItems = (group: JsonRow) => Array.isArray(group.items) ? group.items as JsonRow[] : [];

function incomingPrice(candidate: ManufacturerNewCandidate) {
  if (!("prices" in candidate.row)) return candidate.row.price;
  return candidate.columns.length === 1 ? candidate.row.prices[candidate.columns[0].id] ?? null : null;
}

function rowFor(candidate: ManufacturerNewCandidate, destination: ManufacturerPricingType, id: string, targetColumns: string[]) {
  const row = candidate.row; const code = row.supplierCodes[0] ?? row.referenceCodes[0] ?? ""; const name = row.displayName ?? row.label ?? code; const common = { id, supplier_price_list_code: code, currency: row.currency ?? undefined, specification: row.specification ?? "", is_active: true };
  if (destination === "workstation") return { ...common, label: row.label ?? name, default_price: incomingPrice(candidate), additional_price: null, default_dimension: dimension(row.dimensions), layout_type: "Linear" };
  if (destination === "accessory") return { ...common, item_name: name, dimension: dimension(row.dimensions), price: incomingPrice(candidate) };
  if (destination === "base_model") return { ...common, variant_name: row.label ?? name, display_name: name, dimension: dimension(row.dimensions), price: incomingPrice(candidate) };
  if (!("prices" in row)) return null;
  const incomingByLabel = new Map(candidate.columns.map((column) => [normalized(column.label ?? column.id), row.prices[column.id]]));
  if (targetColumns.some((column) => !incomingByLabel.has(normalized(column)))) return null;
  return { ...common, variant_name: row.label ?? name, display_name: name, dimension: dimension(row.dimensions), prices: Object.fromEntries(targetColumns.map((column) => [column, incomingByLabel.get(normalized(column)) ?? null])) };
}

function findGroup(state: ManufacturerFieldPatchState, type: ManufacturerPricingType, id: string) { return arrays(state, type).find((group) => group.id === id); }

export function applyManufacturerUpdateActions(snapshot: Record<string, string>, patches: readonly ManufacturerFieldPatch[], actions: readonly ManufacturerItemAction[], makeId: () => string = () => crypto.randomUUID()) {
  const fields = applyManufacturerFieldPatches(snapshot, patches); if (!fields.ok) return fields;
  const state = fields.state; const errors: string[] = []; const ids = new Set(Object.values(state).flatMap((value) => Array.isArray(value) ? value.flatMap((group) => [text(group.id), ...groupItems(group).map((row) => text(row.id))]) : []));
  actions.forEach((action) => {
    if (action.kind === "inactive") {
      const group = findGroup(state, action.item.existing.pricingType, action.item.existing.groupId); const rows = group ? groupItems(group) : arrays(state, action.item.existing.pricingType); const row = rows.find((item) => item.id === action.item.existing.rowId);
      if (!row || !("is_active" in row) || text(row.supplier_price_list_code) !== (action.item.supplierCode ?? "")) { errors.push(`Cannot mark ${action.item.supplierCode ?? action.item.existing.rowId} inactive because its current target changed.`); return; }
      row.is_active = false; return;
    }
    if (action.destination !== action.candidate.pricingType && !(["base_model", "accessory"].includes(action.destination) && action.candidate.columns.length === 1)) { errors.push(`Destination is incompatible for ${action.candidate.incoming.supplierCode ?? action.candidate.incoming.rowId}.`); return; }
    let group = findGroup(state, action.destination, action.groupId);
    if (action.target === "new") {
      const localGroupId = makeId(); if (!localGroupId || ids.has(localGroupId)) { errors.push("Could not generate a unique local group ID."); return; } ids.add(localGroupId);
      group = { id: localGroupId, group_name: action.groupName, is_active: true, items: [], ...(action.destination === "base_model" ? { pricing_type: "base_model_group" } : {}), ...(action.destination === "modular" ? { pricing_type: "modular_group", price_categories: action.candidate.columns.map((column) => column.label ?? column.id) } : {}), ...(action.destination === "category_matrix" ? { price_categories: action.candidate.columns.map((column) => column.label ?? column.id) } : {}), ...(action.destination === "accessory" ? { group_is_required: action.accessoryRole === "companion", conditional_configuration: { role: action.accessoryRole ?? "accessory", selection: action.accessorySelection ?? "unrestricted", applicability: [] } } : {}) }; arrays(state, action.destination).push(group);
    }
    if (!group) { errors.push(`Destination group '${action.groupId}' no longer exists.`); return; }
    const columns = Array.isArray(group.price_categories) ? group.price_categories.filter((item): item is string => typeof item === "string") : [];
    const id = makeId(); if (!id || ids.has(id)) { errors.push("Could not generate a unique local item ID."); return; } ids.add(id);
    const row = rowFor(action.candidate, action.destination, id, columns); if (!row) { errors.push(`Incoming matrix columns are incompatible with '${action.groupName}'.`); return; }
    groupItems(group).push(row);
    if (action.destination === "accessory" && action.target === "new" && action.accessoryModel) {
      const configuration = group.conditional_configuration as JsonRow; configuration.applicability = [{ base_model_group_id: action.accessoryModel.groupId, base_model_row_id: action.accessoryModel.rowId, required: action.accessoryRole === "companion", visible: true, allowed_item_ids: [id], ...(action.fixedQuantity && action.fixedQuantity > 0 ? { fixed_quantity: action.fixedQuantity } : {}) }];
    }
    if (action.subgroupId) { const subgroup = Array.isArray(group.subgroups) ? (group.subgroups as JsonRow[]).find((item) => item.id === action.subgroupId) : null; if (!subgroup || !Array.isArray(subgroup.row_ids)) { errors.push(`Subgroup no longer exists in '${action.groupName}'.`); return; } subgroup.row_ids.push(id); }
  });
  return errors.length ? { ok: false as const, errors } : { ok: true as const, state };
}

export function manufacturerCompatibleGroups(state: ManufacturerFieldPatchState, type: ManufacturerPricingType) {
  return arrays(state, type).map((group) => ({ id: text(group.id), name: text(group.group_name) || "Unnamed group", subgroups: Array.isArray(group.subgroups) ? (group.subgroups as JsonRow[]).map((subgroup) => ({ id: text(subgroup.id), name: text(subgroup.subgroup_name) })).filter((subgroup) => subgroup.id && subgroup.name) : [] }));
}
