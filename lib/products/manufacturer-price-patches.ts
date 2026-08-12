import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";
import type { ManufacturerPriceDifference, ManufacturerPricingType } from "./manufacturer-update-diff";
import { LEGACY_WORKSTATION_GROUP_ID } from "./workstation-pricing-groups";

type JsonRow = Record<string, unknown>;

export type ManufacturerPricingFormState = {
  deskingSizePricing: JsonRow[];
  variantPricing: JsonRow[];
  categoryPricing: JsonRow[];
  modularPricing: JsonRow[];
  accessoryPricing: JsonRow[];
};

export type ManufacturerPricePatchResult =
  | { ok: true; state: ManufacturerPricingFormState }
  | { ok: false; errors: string[] };

const parseRows = (value: string | undefined) => {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is JsonRow => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  } catch { return []; }
};

export function manufacturerPricingFormStateFromSnapshot(snapshot: Record<string, string>): ManufacturerPricingFormState {
  return {
    deskingSizePricing: parseRows(snapshot.desking_size_pricing),
    variantPricing: parseRows(snapshot.variant_pricing),
    categoryPricing: parseRows(snapshot.category_pricing),
    modularPricing: parseRows(snapshot.modular_item_pricing),
    accessoryPricing: parseRows(snapshot.accessory_pricing),
  };
}

export function manufacturerPricePatchKey(patch: ManufacturerPriceDifference) {
  return [patch.pricingType, patch.groupId, patch.rowId, patch.columnId ?? "", patch.field].join("\u0000");
}

function rowsForGroup(rows: JsonRow[], pricingType: ManufacturerPricingType, groupId: string) {
  const legacy = pricingType === "base_model" ? LEGACY_BASE_MODEL_GROUP_ID : pricingType === "workstation" ? LEGACY_WORKSTATION_GROUP_ID : null;
  if (groupId === legacy) return rows.flatMap((entry) => Array.isArray(entry.items) ? entry.items.filter((item): item is JsonRow => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [entry]);
  const group = rows.find((entry) => entry.id === groupId);
  if (!group) return [];
  return Array.isArray(group.items) ? group.items.filter((item): item is JsonRow => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [group];
}

function sourceRows(state: ManufacturerPricingFormState, pricingType: ManufacturerPricingType) {
  if (pricingType === "workstation") return state.deskingSizePricing;
  if (pricingType === "base_model") return state.variantPricing;
  if (pricingType === "category_matrix") return state.categoryPricing;
  if (pricingType === "modular") return state.modularPricing;
  return state.accessoryPricing;
}

function priceValue(row: JsonRow, patch: ManufacturerPriceDifference) {
  if (patch.pricingType === "workstation") return patch.field === "additional_price" ? row.additional_price : row.default_price;
  if (patch.pricingType === "category_matrix" || patch.pricingType === "modular") {
    const prices = row.prices && typeof row.prices === "object" && !Array.isArray(row.prices) ? row.prices as JsonRow : {};
    return patch.columnId ? prices[patch.columnId] : undefined;
  }
  return row.price;
}

function samePrice(value: unknown, expected: number | null) {
  if (value === null || value === "" || value === undefined) return expected === null;
  return typeof value === "number" && Number.isFinite(value) && value === expected;
}

export function applyManufacturerPricePatches(current: ManufacturerPricingFormState, patches: readonly ManufacturerPriceDifference[]): ManufacturerPricePatchResult {
  const state = structuredClone(current);
  const errors: string[] = [];
  const seen = new Set<string>();
  patches.forEach((patch) => {
    const key = manufacturerPricePatchKey(patch);
    if (seen.has(key)) { errors.push(`Duplicate price patch for ${patch.groupId}/${patch.rowId}/${patch.field}.`); return; }
    seen.add(key);
    if (patch.currencyChanged) { errors.push(`Currency differs for ${patch.groupId}/${patch.rowId}; Prices Only cannot apply it.`); return; }
    const matches = rowsForGroup(sourceRows(state, patch.pricingType), patch.pricingType, patch.groupId).filter((row) => row.id === patch.rowId);
    if (matches.length !== 1) { errors.push(`Expected one current row for ${patch.groupId}/${patch.rowId}, found ${matches.length}.`); return; }
    const row = matches[0];
    if (!samePrice(priceValue(row, patch), patch.currentValue)) { errors.push(`Current price changed for ${patch.groupId}/${patch.rowId}/${patch.field}; refresh the comparison.`); return; }
    if (patch.pricingType === "workstation") row[patch.field] = patch.incomingValue;
    else if (patch.pricingType === "category_matrix" || patch.pricingType === "modular") {
      if (!patch.columnId) { errors.push(`Price column is missing for ${patch.groupId}/${patch.rowId}.`); return; }
      const prices = row.prices && typeof row.prices === "object" && !Array.isArray(row.prices) ? row.prices as JsonRow : null;
      if (!prices || !(patch.columnId in prices)) { errors.push(`Current price column '${patch.columnId}' was not found for ${patch.groupId}/${patch.rowId}.`); return; }
      row.prices = { ...prices, [patch.columnId]: patch.incomingValue };
    } else row.price = patch.incomingValue;
  });
  return errors.length ? { ok: false, errors } : { ok: true, state };
}
