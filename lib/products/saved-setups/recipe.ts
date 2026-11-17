/**
 * My Collection recipe (v1). PURE: no React, no server-only, no database.
 *
 * A saved setup is the ids and small overrides needed to rebuild a configuration in the Product Library.
 * It NEVER contains a price, total, exchange rate, discount, internal cost or line quantity: prices are
 * recalculated from the current price lists whenever a setup is used.
 * It DOES keep configuration quantities (modular items, accessories, system) because they are part of the setup.
 * The edited specification is stored as text plus a hash of the generated specification at save time
 * (for a later "Needs review" check). The generated template text itself is never stored.
 */

export const SAVED_SETUP_RECIPE_VERSION = 1;
export const SAVED_SETUP_MAX_BYTES = 65536;
export const SAVED_SETUP_NAME_MAX = 120;

export type SavedSetupRequiredOverrides = Record<string, { quantity: number; trigger: string }>;

export type SavedSetupLinkedSelection = {
  variantRowId?: string | null;
  categoryGroupId?: string | null;
  categoryId?: string | null;
  fabricCategory?: string | null;
  /** Configuration quantity of the linked product instance (not a line quantity). */
  quantity?: number | null;
  accessoryQuantities?: Record<string, number>;
};

/** Plain, React-free snapshot of the selector state for ONE template. */
export type SavedSetupPlainState = {
  templateId: string;
  variantRowId?: string | null;
  /** Product Family and Configuration of the model row (ids only; re-derived from the row on replay). */
  variantGroupId?: string | null;
  subgroupId?: string | null;
  systemRowId?: string | null;
  systemQuantity?: number | null;
  categoryGroupId?: string | null;
  categoryRowId?: string | null;
  fabricCategory?: string | null;
  workstationSizeId?: string | null;
  workstationLayout?: string | null;
  additionalClusterQuantity?: number | null;
  modularQuantities?: Record<string, number>;
  pricingAccessoryQuantities?: Record<string, number>;
  componentAccessoryQuantities?: Record<string, number>;
  skippedAccessoryGroupIds?: string[];
  requiredOverrides?: SavedSetupRequiredOverrides;
  componentOptionSelections?: Record<string, string | string[]>;
  accessoryCategoryChoices?: Record<string, string>;
  finishes?: Array<Record<string, unknown>>;
  selectedImage?: string | null;
  linkedInstances?: Record<string, string[]>;
  linkedSelections?: Record<string, SavedSetupLinkedSelection>;
  dimensionOverride?: string | null;
  workstationSpecification?: string | null;
  brandOverride?: string | null;
  originOverride?: string | null;
  /** Display-only: main code of the configuration (e.g. "EV211") at save time. Never used for pricing. */
  mainCode?: string | null;
  specificationEdited?: boolean;
  editedSpecification?: string | null;
  /** Generated specification at save time. Only its hash is stored. */
  generatedSpecification?: string | null;
  /** Used instead of hashing generatedSpecification when only the stored hash is known (saving from a quote line). */
  generatedSpecificationHash?: string | null;
};

export type SavedSetupRecipeV1 = {
  recipe_version: 1;
  template_id: string;
  /** Display-only hints (additive; rows saved before this field existed simply have none). */
  display?: { main_code?: string };
  selections: {
    variant_row_id?: string;
    variant_group_id?: string;
    subgroup_id?: string;
    system_row_id?: string;
    system_quantity?: number;
    category_group_id?: string;
    category_row_id?: string;
    fabric_category?: string;
    workstation_size_id?: string;
    workstation_layout?: string;
    additional_cluster_quantity?: number;
    modular_quantities: Record<string, number>;
    pricing_accessory_quantities: Record<string, number>;
    component_accessory_quantities: Record<string, number>;
    skipped_accessory_group_ids: string[];
    required_overrides: SavedSetupRequiredOverrides;
    component_option_selections: Record<string, string | string[]>;
    accessory_category_choices: Record<string, string>;
  };
  finishes: Array<Record<string, unknown>>;
  selected_image: string | null;
  linked: {
    instances: Record<string, string[]>;
    selections: Record<
      string,
      {
        variant_row_id?: string;
        category_group_id?: string;
        category_id?: string;
        fabric_category?: string;
        instance_quantity?: number;
        accessory_quantities: Record<string, number>;
      }
    >;
  };
};

export type SavedSetupSpecOverrides = {
  dimension?: string;
  workstation_specification?: string;
  brand?: string;
  origin?: string;
  specification_edited: boolean;
  edited_specification: string | null;
  /** Hash of the GENERATED specification when the setup was saved. */
  generated_specification_hash: string | null;
};

export type BuiltSavedSetup = { recipe: SavedSetupRecipeV1; specOverrides: SavedSetupSpecOverrides };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Keys that may never appear anywhere in a recipe or its overrides (case/underscore insensitive). */
const FORBIDDEN_KEYS_ANYWHERE = new Set([
  "price", "prices", "unitprice", "netprice", "total", "totals", "netttotal", "nettotal",
  "exchangerate", "exchangerates", "internalcost", "suppliercost", "cost", "discount", "discounttype", "discountvalue",
  "convertedquotationprice", "sourceprice", "defaultprice", "finalprice",
]);
/** Line-quantity keys, forbidden at the top level and in `selections` only (configuration quantities are named differently). */
const FORBIDDEN_LINE_QUANTITY_KEYS = new Set(["qty", "quantity", "lineqty", "linequantity"]);

function normalizeKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function findForbiddenKey(value: unknown, path: string, lineLevel: boolean): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenKey(value[index], `${path}[${index}]`, false);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    if (FORBIDDEN_KEYS_ANYWHERE.has(normalized)) return `${path}.${key}`;
    if (lineLevel && FORBIDDEN_LINE_QUANTITY_KEYS.has(normalized)) return `${path}.${key}`;
    // `selections` sits directly under the recipe, so it is still line level.
    const childIsLineLevel = lineLevel && key === "selections";
    const found = findForbiddenKey(child, `${path}.${key}`, childIsLineLevel);
    if (found) return found;
  }
  return null;
}

/** Returns the path of the first forbidden key (price, total, exchange rate, cost, line quantity), or null. */
export function findForbiddenRecipeKey(value: unknown): string | null {
  return findForbiddenKey(value, "$", true);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function positiveQuantities(value: Record<string, number> | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value ?? {})) {
    const quantity = Math.trunc(Number(raw));
    if (key && Number.isFinite(quantity) && quantity > 0) result[key] = quantity;
  }
  return result;
}

function plainObjects(value: Array<Record<string, unknown>> | undefined) {
  return (value ?? []).filter((row) => row && typeof row === "object" && !Array.isArray(row));
}

/** Small deterministic hash (FNV-1a 32-bit) of whitespace-normalised text. A drift hint, not security. */
export function hashSpecificationText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, "0")}:${normalized.length}`;
}

export function buildRecipe(state: SavedSetupPlainState): BuiltSavedSetup {
  const selectedOptions: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(state.componentOptionSelections ?? {})) {
    if (Array.isArray(value)) {
      const ids = value.filter((item): item is string => typeof item === "string" && Boolean(item));
      if (ids.length) selectedOptions[key] = ids;
    } else if (typeof value === "string" && value) {
      selectedOptions[key] = value;
    }
  }

  const requiredOverrides: SavedSetupRequiredOverrides = {};
  for (const [key, override] of Object.entries(state.requiredOverrides ?? {})) {
    const quantity = Math.trunc(Number(override?.quantity));
    if (key && Number.isFinite(quantity) && quantity >= 0 && typeof override.trigger === "string") {
      requiredOverrides[key] = { quantity, trigger: override.trigger };
    }
  }

  const categoryChoices: Record<string, string> = {};
  for (const [key, value] of Object.entries(state.accessoryCategoryChoices ?? {})) {
    if (key && typeof value === "string" && value) categoryChoices[key] = value;
  }

  const linkedInstances: Record<string, string[]> = {};
  for (const [linkId, ids] of Object.entries(state.linkedInstances ?? {})) {
    const list = (ids ?? []).filter((id) => typeof id === "string" && Boolean(id));
    if (linkId && list.length) linkedInstances[linkId] = list;
  }

  const linkedSelections: SavedSetupRecipeV1["linked"]["selections"] = {};
  for (const [instanceKey, selection] of Object.entries(state.linkedSelections ?? {})) {
    if (!instanceKey || !selection) continue;
    const instanceQuantity = Math.trunc(Number(selection.quantity));
    linkedSelections[instanceKey] = {
      ...(text(selection.variantRowId) ? { variant_row_id: text(selection.variantRowId) } : {}),
      ...(text(selection.categoryGroupId) ? { category_group_id: text(selection.categoryGroupId) } : {}),
      ...(text(selection.categoryId) ? { category_id: text(selection.categoryId) } : {}),
      ...(text(selection.fabricCategory) ? { fabric_category: text(selection.fabricCategory) } : {}),
      ...(Number.isFinite(instanceQuantity) && instanceQuantity > 0 ? { instance_quantity: instanceQuantity } : {}),
      accessory_quantities: positiveQuantities(selection.accessoryQuantities),
    };
  }

  const systemQuantity = Math.trunc(Number(state.systemQuantity));
  const clusterQuantity = Math.trunc(Number(state.additionalClusterQuantity));

  const recipe: SavedSetupRecipeV1 = {
    recipe_version: SAVED_SETUP_RECIPE_VERSION,
    template_id: state.templateId,
    ...(text(state.mainCode) ? { display: { main_code: text(state.mainCode) } } : {}),
    selections: {
      ...(text(state.variantRowId) ? { variant_row_id: text(state.variantRowId) } : {}),
      ...(text(state.variantRowId) && text(state.variantGroupId) ? { variant_group_id: text(state.variantGroupId) } : {}),
      ...(text(state.variantRowId) && text(state.subgroupId) ? { subgroup_id: text(state.subgroupId) } : {}),
      ...(text(state.systemRowId) ? { system_row_id: text(state.systemRowId) } : {}),
      ...(text(state.systemRowId) && Number.isFinite(systemQuantity) && systemQuantity > 0 ? { system_quantity: systemQuantity } : {}),
      ...(text(state.categoryGroupId) ? { category_group_id: text(state.categoryGroupId) } : {}),
      ...(text(state.categoryRowId) ? { category_row_id: text(state.categoryRowId) } : {}),
      ...(text(state.fabricCategory) ? { fabric_category: text(state.fabricCategory) } : {}),
      ...(text(state.workstationSizeId) ? { workstation_size_id: text(state.workstationSizeId) } : {}),
      ...(text(state.workstationLayout) ? { workstation_layout: text(state.workstationLayout) } : {}),
      ...(Number.isFinite(clusterQuantity) && clusterQuantity > 0 ? { additional_cluster_quantity: clusterQuantity } : {}),
      modular_quantities: positiveQuantities(state.modularQuantities),
      pricing_accessory_quantities: positiveQuantities(state.pricingAccessoryQuantities),
      component_accessory_quantities: positiveQuantities(state.componentAccessoryQuantities),
      skipped_accessory_group_ids: Array.from(new Set((state.skippedAccessoryGroupIds ?? []).filter(Boolean))),
      required_overrides: requiredOverrides,
      component_option_selections: selectedOptions,
      accessory_category_choices: categoryChoices,
    },
    finishes: plainObjects(state.finishes),
    selected_image: text(state.selectedImage) ?? null,
    linked: { instances: linkedInstances, selections: linkedSelections },
  };

  const edited = Boolean(state.specificationEdited) && typeof state.editedSpecification === "string";
  const specOverrides: SavedSetupSpecOverrides = {
    ...(text(state.dimensionOverride) ? { dimension: text(state.dimensionOverride) } : {}),
    ...(text(state.workstationSpecification) ? { workstation_specification: text(state.workstationSpecification) } : {}),
    ...(text(state.brandOverride) ? { brand: text(state.brandOverride) } : {}),
    ...(text(state.originOverride) ? { origin: text(state.originOverride) } : {}),
    specification_edited: edited,
    edited_specification: edited ? (state.editedSpecification as string) : null,
    generated_specification_hash: state.generatedSpecificationHash ?? hashSpecificationText(state.generatedSpecification),
  };

  return { recipe, specOverrides };
}

/** Inverse of buildRecipe: rebuilds the plain selector state (for replay and for the round-trip test). */
export function restorePlainState(recipe: SavedSetupRecipeV1, specOverrides?: SavedSetupSpecOverrides | null): SavedSetupPlainState {
  // Defensive: rows saved by older code (or hand-edited) may lack optional blocks; never crash on them.
  const s: Partial<SavedSetupRecipeV1["selections"]> = recipe.selections ?? {};
  const linkedSelections: Record<string, SavedSetupLinkedSelection> = {};
  for (const [key, value] of Object.entries(recipe.linked?.selections ?? {})) {
    linkedSelections[key] = {
      variantRowId: value.variant_row_id ?? null,
      categoryGroupId: value.category_group_id ?? null,
      categoryId: value.category_id ?? null,
      fabricCategory: value.fabric_category ?? null,
      quantity: value.instance_quantity ?? null,
      accessoryQuantities: value.accessory_quantities,
    };
  }
  return {
    templateId: recipe.template_id,
    mainCode: recipe.display?.main_code ?? null,
    variantRowId: s.variant_row_id ?? null,
    variantGroupId: s.variant_group_id ?? null,
    subgroupId: s.subgroup_id ?? null,
    systemRowId: s.system_row_id ?? null,
    systemQuantity: s.system_quantity ?? null,
    categoryGroupId: s.category_group_id ?? null,
    categoryRowId: s.category_row_id ?? null,
    fabricCategory: s.fabric_category ?? null,
    workstationSizeId: s.workstation_size_id ?? null,
    workstationLayout: s.workstation_layout ?? null,
    additionalClusterQuantity: s.additional_cluster_quantity ?? null,
    modularQuantities: s.modular_quantities ?? {},
    pricingAccessoryQuantities: s.pricing_accessory_quantities ?? {},
    componentAccessoryQuantities: s.component_accessory_quantities ?? {},
    skippedAccessoryGroupIds: s.skipped_accessory_group_ids ?? [],
    requiredOverrides: s.required_overrides ?? {},
    componentOptionSelections: s.component_option_selections ?? {},
    accessoryCategoryChoices: s.accessory_category_choices ?? {},
    finishes: recipe.finishes ?? [],
    selectedImage: recipe.selected_image ?? null,
    linkedInstances: recipe.linked?.instances ?? {},
    linkedSelections,
    dimensionOverride: specOverrides?.dimension ?? null,
    workstationSpecification: specOverrides?.workstation_specification ?? null,
    brandOverride: specOverrides?.brand ?? null,
    originOverride: specOverrides?.origin ?? null,
    specificationEdited: specOverrides?.specification_edited ?? false,
    editedSpecification: specOverrides?.edited_specification ?? null,
  };
}

export type RecipeValidation = { ok: true } | { ok: false; error: string };

function jsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function validateRecipeShape(recipe: unknown, specOverrides?: unknown): RecipeValidation {
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return { ok: false, error: "The saved setup is not valid." };
  const candidate = recipe as Partial<SavedSetupRecipeV1>;
  if (candidate.recipe_version !== SAVED_SETUP_RECIPE_VERSION) return { ok: false, error: "Unsupported setup version." };
  if (!isUuid(candidate.template_id)) return { ok: false, error: "The saved setup has no valid product." };
  if (!candidate.selections || typeof candidate.selections !== "object" || Array.isArray(candidate.selections)) {
    return { ok: false, error: "The saved setup has no selections." };
  }
  const forbidden = findForbiddenRecipeKey(recipe) ?? (specOverrides === undefined ? null : findForbiddenRecipeKey(specOverrides));
  if (forbidden) return { ok: false, error: `A saved setup cannot contain prices or line quantities (${forbidden}).` };
  if (jsonBytes(recipe) > SAVED_SETUP_MAX_BYTES || (specOverrides !== undefined && jsonBytes(specOverrides) > SAVED_SETUP_MAX_BYTES)) {
    return { ok: false, error: "This setup is too large to save." };
  }
  return { ok: true };
}
