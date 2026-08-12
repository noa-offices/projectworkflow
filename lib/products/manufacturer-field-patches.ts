import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";
import type { ManufacturerNonPriceDifference, ManufacturerPriceDifference, ManufacturerPricingType, ManufacturerUpdateDiff, ManufacturerUpdateWorkspace } from "./manufacturer-update-diff";
import { manufacturerPricingFormStateFromSnapshot, type ManufacturerPricingFormState } from "./manufacturer-price-patches";
import type { ProductTemplateDraftDimension } from "./product-template-draft";
import { LEGACY_WORKSTATION_GROUP_ID } from "./workstation-pricing-groups";

type JsonRow = Record<string, unknown>;
export type ManufacturerUpdateSectionKey = "template" | ManufacturerPricingType;
export type ManufacturerTemplateField = "templateName" | "description" | "specification" | "origin" | "supplierName" | "itemCode" | "internalSelectionName";
export type ManufacturerRowField = ManufacturerPriceDifference["field"] | ManufacturerNonPriceDifference["field"];
export type ManufacturerFieldPatch =
  | { scope: "template"; section: "template"; field: ManufacturerTemplateField; currentValue: unknown; incomingValue: unknown }
  | ({ scope: "row"; section: ManufacturerPricingType; field: ManufacturerRowField; currentValue: unknown; incomingValue: unknown; currentCurrency?: string | null; incomingCurrency?: string | null } & Pick<ManufacturerPriceDifference, "pricingType" | "groupId" | "groupName" | "rowId" | "subgroupId" | "subgroupName" | "displayName" | "supplierCode" | "columnId" | "columnLabel">);
export type ManufacturerRowFieldPatch = Extract<ManufacturerFieldPatch, { scope: "row" }>;

export type ManufacturerFieldPatchState = ManufacturerPricingFormState & { templateValues: Record<string, string> };
export type ManufacturerFieldPatchResult = { ok: true; state: ManufacturerFieldPatchState } | { ok: false; errors: string[] };

const templateFields: Array<[ManufacturerTemplateField, keyof ManufacturerUpdateWorkspace["draft"]["template"]]> = [
  ["templateName", "templateName"], ["description", "description"], ["specification", "specification"], ["origin", "origin"], ["supplierName", "supplierName"], ["itemCode", "itemCode"], ["internalSelectionName", "internalSelectionName"],
];
const templateFormFields: Record<ManufacturerTemplateField, string> = { templateName: "template_name", description: "description", specification: "default_specification", origin: "origin", supplierName: "supplier_name", itemCode: "item_code", internalSelectionName: "internal_selection_name" };
const supportedRowFields = new Set<ManufacturerRowField>(["price", "default_price", "additional_price", "label", "displayName", "specification", "dimensions", "currency", "layoutType"]);
const supportedDifference = (difference: ManufacturerNonPriceDifference) => supportedRowFields.has(difference.field)
  && !(difference.pricingType === "accessory" && difference.field === "label")
  && !(difference.pricingType === "workstation" && difference.field === "displayName");

export function manufacturerFieldPatches(diff: ManufacturerUpdateDiff, current: ManufacturerUpdateWorkspace, incoming: ManufacturerUpdateWorkspace["draft"]) {
  const template = templateFields.flatMap(([field, key]) => current.draft.template[key] === incoming.template[key] ? [] : [{ scope: "template" as const, section: "template" as const, field, currentValue: current.draft.template[key], incomingValue: incoming.template[key] }]);
  const rows = Object.values(diff.sections).flatMap((section) => section.matchedItems).flatMap((item) => [
    ...item.priceFields.map((difference) => ({ ...difference, scope: "row" as const, section: difference.pricingType, field: difference.field })),
    ...item.nonPriceDifferences.filter(supportedDifference).map((difference) => ({ ...difference, scope: "row" as const, section: difference.pricingType, field: difference.field })),
  ]).filter((patch) => patch.currentValue !== patch.incomingValue);
  return [...template, ...rows] as ManufacturerFieldPatch[];
}

export function manufacturerFieldPatchKey(patch: ManufacturerFieldPatch) {
  return patch.scope === "template" ? `template\0${patch.field}` : [patch.pricingType, patch.groupId, patch.rowId, patch.columnId ?? "", patch.field].join("\0");
}

export function defaultManufacturerFieldSelection(patches: readonly ManufacturerFieldPatch[], selectedSections: ReadonlySet<ManufacturerUpdateSectionKey>) {
  return new Set(patches.filter((patch) => selectedSections.has(patch.section) && ["price", "default_price", "additional_price"].includes(patch.field)).map(manufacturerFieldPatchKey));
}

export function selectedManufacturerFieldPatches(patches: readonly ManufacturerFieldPatch[], selectedSections: ReadonlySet<ManufacturerUpdateSectionKey>, selected: ReadonlySet<string>) {
  return patches.filter((patch) => selectedSections.has(patch.section) && selected.has(manufacturerFieldPatchKey(patch)));
}

const fieldOrder: Record<string, number> = { price: 0, default_price: 0, additional_price: 1, currency: 2, displayName: 3, label: 4, specification: 5, dimensions: 6, layoutType: 7 };

export type ManufacturerPatchItemView = { key: string; title: string; patches: ManufacturerRowFieldPatch[] };
export type ManufacturerPatchGroupView = { key: string; name: string; items: ManufacturerPatchItemView[] };

export function manufacturerPatchGroups(patches: readonly ManufacturerFieldPatch[]) {
  const groups = new Map<string, ManufacturerPatchGroupView>();
  patches.filter((patch): patch is ManufacturerRowFieldPatch => patch.scope === "row").forEach((patch) => {
    const groupKey = `${patch.section}\0${patch.groupId}`;
    const group = groups.get(groupKey) ?? { key: groupKey, name: patch.groupName, items: [] };
    let item = group.items.find((candidate) => candidate.key === patch.rowId);
    if (!item) { item = { key: patch.rowId, title: patch.displayName ?? patch.supplierCode ?? "Unnamed item", patches: [] }; group.items.push(item); }
    item.patches.push(patch); groups.set(groupKey, group);
  });
  return [...groups.values()].map((group) => ({ ...group, items: group.items.map((item) => ({ ...item, patches: [...item.patches].sort((left, right) => (fieldOrder[left.field] ?? 99) - (fieldOrder[right.field] ?? 99) || (left.columnLabel ?? "").localeCompare(right.columnLabel ?? "")) })) }));
}

function rowsForGroup(rows: JsonRow[], pricingType: ManufacturerPricingType, groupId: string) {
  const legacy = pricingType === "base_model" ? LEGACY_BASE_MODEL_GROUP_ID : pricingType === "workstation" ? LEGACY_WORKSTATION_GROUP_ID : null;
  if (groupId === legacy) return rows.flatMap((entry) => Array.isArray(entry.items) ? entry.items as JsonRow[] : [entry]);
  const group = rows.find((entry) => entry.id === groupId);
  return group && Array.isArray(group.items) ? group.items as JsonRow[] : group ? [group] : [];
}

function rowsForType(state: ManufacturerPricingFormState, type: ManufacturerPricingType) {
  return type === "workstation" ? state.deskingSizePricing : type === "base_model" ? state.variantPricing : type === "category_matrix" ? state.categoryPricing : type === "modular" ? state.modularPricing : state.accessoryPricing;
}

function dimensionText(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const dimension = value as ProductTemplateDraftDimension;
  return dimension.rawText ?? ([dimension.width, dimension.depth, dimension.height].filter((item) => item !== null && item !== undefined).join(" × ") + (dimension.unit ? ` ${dimension.unit}` : "") || null);
}

function rawField(row: JsonRow, patch: Extract<ManufacturerFieldPatch, { scope: "row" }>) {
  if (patch.field === "price") {
    if ((patch.pricingType === "category_matrix" || patch.pricingType === "modular") && patch.columnId) return (row.prices as JsonRow | undefined)?.[patch.columnId];
    return row.price;
  }
  if (patch.field === "default_price" || patch.field === "additional_price") return row[patch.field];
  if (patch.field === "displayName") return patch.pricingType === "accessory" ? row.item_name : row.display_name;
  if (patch.field === "label") return patch.pricingType === "base_model" || patch.pricingType === "category_matrix" || patch.pricingType === "modular" ? row.variant_name : patch.pricingType === "accessory" ? row.item_name : row.label;
  if (patch.field === "dimensions") return patch.pricingType === "workstation" ? row.default_dimension : row.dimension;
  if (patch.field === "layoutType") return typeof row.layout_type === "string" ? row.layout_type.toLowerCase() : row.layout_type;
  return row[patch.field];
}

function expectedValue(patch: Extract<ManufacturerFieldPatch, { scope: "row" }>, value: unknown) {
  return patch.field === "dimensions" ? dimensionText(value) : value ?? null;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left === "" || left === undefined ? null : left) === JSON.stringify(right === "" || right === undefined ? null : right);
}

function setRawField(row: JsonRow, patch: Extract<ManufacturerFieldPatch, { scope: "row" }>) {
  const value = expectedValue(patch, patch.incomingValue);
  if (patch.field === "price" && (patch.pricingType === "category_matrix" || patch.pricingType === "modular")) row.prices = { ...(row.prices as JsonRow), [patch.columnId!]: value };
  else if (patch.field === "displayName") row[patch.pricingType === "accessory" ? "item_name" : "display_name"] = value;
  else if (patch.field === "label") row[patch.pricingType === "base_model" || patch.pricingType === "category_matrix" || patch.pricingType === "modular" ? "variant_name" : patch.pricingType === "accessory" ? "item_name" : "label"] = value;
  else if (patch.field === "dimensions") row[patch.pricingType === "workstation" ? "default_dimension" : "dimension"] = value;
  else if (patch.field === "layoutType") row.layout_type = value;
  else row[patch.field] = value;
}

export function applyManufacturerFieldPatches(snapshot: Record<string, string>, patches: readonly ManufacturerFieldPatch[]): ManufacturerFieldPatchResult {
  const state = structuredClone(manufacturerPricingFormStateFromSnapshot(snapshot));
  const templateValues = Object.fromEntries(Object.values(templateFormFields).map((field) => [field, snapshot[field] ?? ""]));
  const errors: string[] = []; const seen = new Set<string>();
  patches.forEach((patch) => {
    const key = manufacturerFieldPatchKey(patch);
    if (seen.has(key)) { errors.push(`Duplicate field patch '${key}'.`); return; } seen.add(key);
    if (patch.scope === "template") {
      const formField = templateFormFields[patch.field];
      if (!same(templateValues[formField], patch.currentValue)) { errors.push(`Template field '${patch.field}' changed after review.`); return; }
      templateValues[formField] = String(patch.incomingValue ?? ""); return;
    }
    const matches = rowsForGroup(rowsForType(state, patch.pricingType), patch.pricingType, patch.groupId).filter((row) => row.id === patch.rowId);
    if (matches.length !== 1) { errors.push(`Expected one current row for ${patch.groupId}/${patch.rowId}, found ${matches.length}.`); return; }
    if (!same(rawField(matches[0], patch), expectedValue(patch, patch.currentValue))) { errors.push(`Current ${patch.field} changed for ${patch.groupId}/${patch.rowId}; refresh the comparison.`); return; }
    if ((patch.pricingType === "category_matrix" || patch.pricingType === "modular") && patch.field === "price" && (!patch.columnId || !((matches[0].prices as JsonRow | undefined) && patch.columnId in (matches[0].prices as JsonRow)))) { errors.push(`Current price column was not found for ${patch.groupId}/${patch.rowId}.`); return; }
    setRawField(matches[0], patch);
  });
  return errors.length ? { ok: false, errors } : { ok: true, state: { ...state, templateValues } };
}
