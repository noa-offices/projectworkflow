import { isDirectModularPricingGroup, modularItemPricingGroups, modularPricingDefaultsFromRows, type ModularCategoryPricingShape } from "../modular-pricing";
import { buildDirectModularDimensionSuggestion } from "../../quotations/product-template-snapshot";
/**
 * Product Gallery details popup: PURE mapper from template rows to the detail payload. No React, no database, no server-only.
 * The payload carries NAMES and TEXT only. There is no price of any kind: every field is picked by name from the rows (nothing is
 * copied wholesale), and removePriceLikeKeys() is a last guard. A recipe is read here only to turn ids into readable lines; ids and the
 * recipe itself never leave this file.
 */
import { parseAccessoryConfigurationGroups } from "../accessory-conditional-configuration";
import { groupMaterialsIntoSections } from "../../quotations/finish-material-groups";
import { resolveProductConfigurationState, type ProductConfigurationSelections, type ProductConfigurationStep } from "../product-configuration-state";
import { restorePlainState } from "../saved-setups/recipe";
import { completeGalleryRecipe, galleryDisplayName } from "./gallery";

export const GALLERY_DETAIL_IMAGES_MAX = 12;
export const GALLERY_DETAIL_SWATCHES_PER_GROUP_MAX = 400;
export const GALLERY_DETAIL_SWATCHES_TOTAL_MAX = 1200;
export const GALLERY_DETAIL_SPECIFICATION_MAX = 2000;
export const GALLERY_DETAIL_ITEMS_PER_GROUP_MAX = 60;
export const GALLERY_DETAIL_TEXT_MAX = 4000;

/** One readable line of the saved configuration; supplierCode (text such as "111 058") is added when the template row has one. */
export type GalleryDetailLine = { label: string; value: string; supplierCode?: string };
/** A required component the template rules add for the saved choices (for example "Top-Access with Soft-Close x 4"). Names, quantity, code and size only. */
export type GalleryDetailRequiredComponent = { name: string; quantity: number; supplierCode?: string; size?: string };
/** An open "same configuration, new specification / picture" offer (editors only). current: what the item has now; proposed: what a later quotation had. */
export type GalleryDetailUpdates = {
  specification: { current: string | null; proposed: string } | null;
  picture: { currentPath: string | null; proposedPath: string } | null;
};
export type GalleryDetailOptionItem = { name: string; supplierCode?: string };
/** One finish swatch: short code, full name, and the picture's storage path (the browser signs it with the existing image helper). */
export type GalleryDetailSwatch = { code: string; name: string; imagePath: string | null };
/** One section of a material group, headed exactly as the quotation finish selector heads it: "category · collection" (for example "SG3 · CHILI"). */
export type GalleryDetailCollection = { name: string; swatches: GalleryDetailSwatch[] };
export type GalleryDetailMaterialGroup = { groupName: string; count: number; collections: GalleryDetailCollection[]; moreCount: number };
export type GallerySpecificationSource = "gallery" | "generated" | "template" | "none";
export type GalleryDetailOptionGroup = { groupName: string; kind: "option" | "accessory" | "linked"; items: GalleryDetailOptionItem[] };

export type GalleryDetail = {
  id: string;
  templateId: string;
  displayName: string;
  itemName: string;
  brandName: string;
  categoryName: string;
  subCategoryName: string;
  itemCode: string;
  templateCode: string;
  tags: string[];
  quotedCount: number;
  /** Storage paths (the popup resolves them with the existing image helper). At most 12, no duplicates. */
  images: string[];
  description: string | null;
  /** The text to show, in this order: the gallery item's own, generated from the saved configuration, the template's, the template description. */
  specification: string | null;
  specificationSource: GallerySpecificationSource;
  dimension: string | null;
  configuration: GalleryDetailLine[];
  /** Required components the rules add for this configuration (empty when the engine cannot compute them). */
  requiredComponents: GalleryDetailRequiredComponent[];
  /** Editors only (null for everyone else): open update offers to compare. */
  updates: GalleryDetailUpdates | null;
  /** Editors only: some saved choices are no longer valid in the product (and the notice was not ignored for this exact set). Read-only. */
  staleNotice: { fingerprint: string } | null;
  materials: GalleryDetailMaterialGroup[];
  options: GalleryDetailOptionGroup[];
};

// ── Images ─────────────────────────────────────────────────────────────────
export const PROPOSED_IMAGE_FIELDS = Array.from({ length: 20 }, (_, index) => `proposed_image_url_${index + 1}`);
export const DETAIL_IMAGE_SELECT = ["default_image_url", "reference_image_url", ...PROPOSED_IMAGE_FIELDS].join(",");

/** A picture path compared the way the app stores template pictures: with or without the "product-images:" prefix. */
const comparablePicture = (value: string) => value.trim().replace(/^product-images:/, "");

/** The template's own pictures, in the default order: default, proposed 1..20, reference. Empty ones removed, no duplicates. */
function templatePictures(template: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const path = value.trim();
    if (path && !out.some((known) => comparablePicture(known) === comparablePicture(path))) out.push(path);
  };
  add(template.default_image_url);
  for (const field of PROPOSED_IMAGE_FIELDS) add(template[field]);
  add(template.reference_image_url);
  return out;
}

/**
 * The picture chosen in the quotation builder, but ONLY if it is one of the template's own pictures (same path after the app's usual
 * prefix handling). The template's own spelling is returned, never the stored value. Anything else (removed, changed, unknown) is null.
 */
export function validSelectedImage(template: Record<string, unknown>, selected: unknown): string | null {
  if (typeof selected !== "string" || !selected.trim()) return null;
  const wanted = comparablePicture(selected);
  return templatePictures(template).find((path) => comparablePicture(path) === wanted) ?? null;
}

/** The chosen picture (when valid) first, then default, proposed in order, reference. No duplicates, at most 12. */
export function galleryDetailImages(template: Record<string, unknown>, selectedImage?: unknown): string[] {
  const chosen = validSelectedImage(template, selectedImage);
  const rest = templatePictures(template).filter((path) => !chosen || comparablePicture(path) !== comparablePicture(chosen));
  return (chosen ? [chosen, ...rest] : rest).slice(0, GALLERY_DETAIL_IMAGES_MAX);
}

export function plainText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n/g, "\n").trim();
  return text ? text.slice(0, GALLERY_DETAIL_TEXT_MAX) : null;
}

// ── Materials / finishes ───────────────────────────────────────────────────
export type TemplateMaterialGroupRow = { id: string; material_group_id: string; selection_mode: string | null; label_override: string | null; sort_order: number | null };
export type MaterialGroupRow = { id: string; group_name: string | null };
export type MaterialGroupItemRow = { product_template_material_group_id: string; brand_material_id: string; sort_order: number | null };
export type MaterialRow = {
  id: string;
  material_group_id: string;
  material_code: string | null;
  material_name: string | null;
  image_url: string | null;
  sort_order: number | null;
  material_category?: string | null;
  material_collection?: string | null;
  subgroup_id?: string | null;
};
export type SubgroupRow = { id: string; name: string | null; grade: string | null; sort_order: number | null };

const bySort = <T extends { sort_order?: number | null }>(a: T, b: T) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);

/** A stored swatch picture as a path the existing image helper can sign: material pictures live in the product-images bucket. */
export function swatchImagePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path) return null;
  if (/^(https?:|blob:|data:|\/)/i.test(path) || path.startsWith("product-images:") || path.startsWith("quote-images:")) return path;
  return `product-images:${path}`;
}

/**
 * Template material groups -> sections, each with its sections of swatches. This reproduces what the quotation finish selector shows
 * (components/quotations/finish-selections-editor.tsx, linkedGroupMaterials): an ACTIVE template group, its label_override, and
 *   - selection_mode "full_group": every active material of the brand group;
 *   - any other mode ("selected_categories" or "selected_items"): ONLY the materials that have an active item row for this template
 *     group (a category selection is stored as item rows when it is saved, so both modes read the same rows).
 * The sections are the selector's own (groupMaterialsIntoSections): "category · collection", categories A-Z with "Other" last, then
 * collections; swatches by sort order, then code. A material with neither category nor collection but with a sub-group uses the
 * sub-group's grade and name instead. Only code, name and picture path are read (no price, no supplier data).
 * At most 400 swatches per group and 1200 in all: the cap cuts the END of that order. moreCount says how many were left out.
 */
export function mapMaterials(input: { links: TemplateMaterialGroupRow[]; groups: MaterialGroupRow[]; linkItems: MaterialGroupItemRow[]; materials: MaterialRow[]; subgroups?: SubgroupRow[] }): GalleryDetailMaterialGroup[] {
  const groupName = new Map(input.groups.map((group) => [group.id, group.group_name?.trim() ?? ""]));
  const subgroupById = new Map((input.subgroups ?? []).map((subgroup) => [subgroup.id, subgroup]));
  const result: GalleryDetailMaterialGroup[] = [];
  let remaining = GALLERY_DETAIL_SWATCHES_TOTAL_MAX;
  for (const link of [...input.links].sort(bySort)) {
    const name = link.label_override?.trim() || groupName.get(link.material_group_id) || "";
    if (!name) continue;
    const chosen = new Set(input.linkItems.filter((item) => item.product_template_material_group_id === link.id).map((item) => item.brand_material_id));
    const rows = input.materials.filter((material) => material.material_group_id === link.material_group_id && (link.selection_mode === "full_group" || chosen.has(material.id)));

    const seen = new Set<string>();
    const groupable: Array<{ id: string; material_group_id: string; material_category: string; material_collection: string; material_code: string; material_name: string; sort_order: number; imagePath: string | null }> = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const code = row.material_code?.trim() ?? "";
      const label = row.material_name?.trim() ?? "";
      if (!code && !label) continue;
      let category = row.material_category?.trim() ?? "";
      let collection = row.material_collection?.trim() ?? "";
      if (!category && !collection) {
        const subgroup = row.subgroup_id ? subgroupById.get(row.subgroup_id) : undefined;
        category = subgroup?.grade?.trim() ?? "";
        collection = subgroup?.name?.trim() ?? "";
      }
      groupable.push({ id: row.id, material_group_id: row.material_group_id, material_category: category, material_collection: collection, material_code: code || label, material_name: label || code, sort_order: Number(row.sort_order ?? 0), imagePath: swatchImagePath(row.image_url) });
    }
    if (!groupable.length) continue;

    const sections = groupMaterialsIntoSections(groupable, new Set<string>());
    let allowed = Math.max(0, Math.min(GALLERY_DETAIL_SWATCHES_PER_GROUP_MAX, remaining));
    const collections: GalleryDetailCollection[] = [];
    let kept = 0;
    for (const section of sections) {
      if (allowed <= 0) break;
      const take = section.materials.slice(0, allowed).map((material) => ({ code: material.material_code, name: material.material_name, imagePath: material.imagePath }));
      allowed -= take.length;
      kept += take.length;
      if (take.length) collections.push({ name: section.label, swatches: take });
    }
    remaining -= kept;
    if (!kept) continue;
    result.push({ groupName: name, count: kept, collections, moreCount: groupable.length - kept });
  }
  return result;
}

// ── Options, accessories, linked products (names only) ─────────────────────
export type ComponentRow = { id: string; component_group: string | null; component_name: string | null; option_type: string | null; sort_order: number | null };
export type LinkedFamilyRow = { id: string; label: string | null; sort_order: number | null };

function group(map: Map<string, GalleryDetailOptionItem[]>, name: string, item: GalleryDetailOptionItem) {
  const list = map.get(name) ?? [];
  if (!list.some((known) => known.name === item.name && known.supplierCode === item.supplierCode) && list.length < GALLERY_DETAIL_ITEMS_PER_GROUP_MAX) list.push(item);
  map.set(name, list);
}

const cleanText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
/** The supplier price list code of a template row (the field the quotation selector shows as "Supplier Code"), or undefined. */
function supplierCodeOf(row: Record<string, unknown> | null | undefined): string | undefined {
  return cleanText(row?.supplier_price_list_code) || cleanText(row?.base_supplier_price_list_code) || undefined;
}
const withCode = (item: { name: string }, code: string | undefined): GalleryDetailOptionItem => (code ? { name: item.name, supplierCode: code } : { name: item.name });

/** Accessory groups straight from the template JSON, active only; ONLY the group name, the item names and their supplier codes are read. */
export function accessoryGroups(accessoryPricing: unknown): GalleryDetailOptionGroup[] {
  const rows = Array.isArray(accessoryPricing) ? (accessoryPricing as Array<Record<string, unknown>>) : [];
  const grouped = new Map<string, GalleryDetailOptionItem[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (Array.isArray(row.items)) {
      if (row.is_active === false) continue;
      const name = typeof row.group_name === "string" && row.group_name.trim() ? row.group_name.trim() : "Accessories";
      for (const item of row.items as Array<Record<string, unknown>>) {
        if (item?.is_active === false || typeof item?.item_name !== "string" || !item.item_name.trim()) continue;
        group(grouped, name, withCode({ name: item.item_name.trim() }, supplierCodeOf(item)));
      }
    } else if (row.is_active !== false && typeof row.item_name === "string" && row.item_name.trim()) {
      group(grouped, "Accessories", withCode({ name: row.item_name.trim() }, supplierCodeOf(row)));
    }
  }
  return Array.from(grouped.entries()).map(([groupName, items]) => ({ groupName, kind: "accessory" as const, items }));
}

export function mapOptions(input: { components: ComponentRow[]; accessoryPricing: unknown; linkedFamilies: LinkedFamilyRow[] }): GalleryDetailOptionGroup[] {
  // Option components (product_components) have no supplier price list code: names only.
  const optionGroups = new Map<string, GalleryDetailOptionItem[]>();
  for (const component of [...input.components].sort(bySort)) {
    const name = component.component_name?.trim();
    if (!name) continue;
    group(optionGroups, component.component_group?.trim() || "Options", { name });
  }
  const linked = new Map<string, GalleryDetailOptionItem[]>();
  for (const family of [...input.linkedFamilies].sort(bySort)) {
    const label = family.label?.trim();
    if (label) group(linked, "Linked products", { name: label });
  }
  return [
    ...Array.from(optionGroups.entries()).map(([groupName, items]) => ({ groupName, kind: "option" as const, items })),
    ...accessoryGroups(input.accessoryPricing),
    ...Array.from(linked.entries()).map(([groupName, items]) => ({ groupName, kind: "linked" as const, items })),
  ];
}

/** id -> supplier code for every template row that has one (Base / Model rows, modular and matrix rows, accessories). Only these two fields are read. */
export function supplierCodeIndex(template: { variant_pricing?: unknown; category_pricing?: unknown; accessory_pricing?: unknown; desking_size_pricing?: unknown }): Map<string, string> {
  const index = new Map<string, string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    const id = cleanText(record.id);
    const code = supplierCodeOf(record);
    if (id && code && !index.has(id)) index.set(id, code);
    if (Array.isArray(record.items)) walk(record.items, depth + 1);
  };
  for (const column of [template.variant_pricing, template.category_pricing, template.accessory_pricing, template.desking_size_pricing]) walk(column, 0);
  return index;
}

/**
 * The required components the template rules add. The configuration engine reports each one in `autoApplied` ("Required companion applied
 * automatically (quantity N)." or "... overridden to N ..."); this reads those entries (the quantity is the engine's own, nothing is
 * recalculated) and names the item from the template's accessory rows: name, supplier code and size (dimension). Items that cannot be
 * named are skipped. No price is read.
 */
export function requiredComponentsFromEngine(autoApplied: ReadonlyArray<{ stepKey: string; optionId: string; reason: string }>, accessoryPricing: unknown): GalleryDetailRequiredComponent[] {
  const items = new Map<string, Record<string, unknown>>();
  for (const parsedGroup of parseAccessoryConfigurationGroups(accessoryPricing ?? []).groups) {
    for (const item of parsedGroup.items ?? []) if (typeof item.id === "string" && item.id) items.set(item.id, item as Record<string, unknown>);
  }
  const out: GalleryDetailRequiredComponent[] = [];
  for (const entry of autoApplied) {
    if (!entry.stepKey.startsWith("accessory:") || !/^Required companion/.test(entry.reason)) continue;
    const quantity = Number(/\(quantity (\d+)\)/.exec(entry.reason)?.[1] ?? /overridden to (\d+)/.exec(entry.reason)?.[1]);
    const item = items.get(entry.optionId);
    if (!item || !Number.isFinite(quantity) || quantity <= 0) continue;
    const code = supplierCodeOf(item);
    const name = cleanText(item.item_name) || code || "";
    if (!name || UUID_LIKE.test(name) || out.some((known) => known.name === name && known.supplierCode === code)) continue;
    const size = cleanText(item.dimension);
    out.push({ name, quantity, ...(code ? { supplierCode: code } : {}), ...(size ? { size } : {}) });
  }
  return out;
}

// ── Saved configuration as readable lines ──────────────────────────────────
export type ConfigurationTemplateInput = {
  id: string;
  template_name: string;
  internal_selection_name?: string | null;
  item_code?: string | null;
  template_code?: string | null;
  supplier_name?: string | null;
  origin?: string | null;
  description?: string | null;
  default_specification?: string | null;
  variant_pricing?: unknown;
  category_pricing?: unknown;
  accessory_pricing?: unknown;
  desking_size_pricing?: unknown;
};

/** Which step kinds produced a readable line, and which could not be read (those are skipped, never shown as ids). */
export type ConfigurationReport = {
  lines: GalleryDetailLine[];
  resolvedKinds: string[];
  skippedKinds: string[];
  /** The text the configuration engine writes for the saved choices; null when the recipe is stale or incomplete or the text looks like money. */
  dimension: string | null;
  generatedSpecification: string | null;
  /** Required components from the engine (empty when the recipe is stale or incomplete, or the engine cannot compute them). */
  requiredComponents: GalleryDetailRequiredComponent[];
  /** A short fingerprint of the saved choices that no longer resolve, or null when all of them do. */
  staleFingerprint: string | null;
};

const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const readable = (text: string | null | undefined): text is string => typeof text === "string" && text.trim() !== "" && !UUID_LIKE.test(text);

/** A short, stable fingerprint (letters, digits, "-") of the saved choices that no longer resolve; null when there are none. */
export function staleFingerprint(stale: ReadonlyArray<{ key: string; id: string }>): string | null {
  if (!stale.length) return null;
  const text = stale.map((entry) => `${entry.key}:${entry.id}`).sort().join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return `stale${stale.length}-${hash.toString(16)}`;
}

/** What an editor is offered: only values that differ from the current ones, and a picture only if it is one of the template's own pictures. */
export function buildUpdates(input: { offers: ReadonlyArray<{ kind: string; proposed_value: string | null; status: string }>; currentSpecification: unknown; template: Record<string, unknown>; selectedImage: unknown }): GalleryDetailUpdates {
  const open = (kind: string) => input.offers.find((offer) => offer.kind === kind && offer.status === "open") ?? null;
  const currentSpec = plainText(input.currentSpecification);
  const proposedSpec = plainText(open("specification")?.proposed_value);
  const currentPicture = validSelectedImage(input.template, input.selectedImage) ?? templatePictures(input.template)[0] ?? null;
  const proposedPicture = validSelectedImage(input.template, open("picture")?.proposed_value);
  return {
    specification: proposedSpec && proposedSpec !== currentSpec && !looksLikeMoneyText(proposedSpec) ? { current: currentSpec, proposed: proposedSpec.slice(0, GALLERY_DETAIL_SPECIFICATION_MAX) } : null,
    picture: proposedPicture && proposedPicture !== currentPicture ? { currentPath: currentPicture, proposedPath: proposedPicture } : null,
  };
}

/**
 * True when a required step is still unresolved. A template priced through modular rows does not need a Base / Model choice (the quotation
 * add flow prices through the modular rows; see nextRequiredForReplay in saved-setups/replay.ts), so those steps are not counted there.
 */
function hasBlockingRequiredStep(steps: ReadonlyArray<{ kind: string; required: boolean; resolved: boolean }>): boolean {
  const usesModular = steps.some((step) => step.kind === "modular");
  return steps.some((step) => step.required && !step.resolved && !(usesModular && (step.kind === "variant_group" || step.kind === "variant_subgroup" || step.kind === "variant_row")));
}

export function describeRecipe(input: {
  recipe: unknown;
  template: ConfigurationTemplateInput;
  components: ComponentRow[];
  linkedFamilies: LinkedFamilyRow[];
}): ConfigurationReport {
  const report: ConfigurationReport = { lines: [], resolvedKinds: [], skippedKinds: [], dimension: null, generatedSpecification: null, requiredComponents: [], staleFingerprint: null };
  const full = completeGalleryRecipe(input.recipe, input.template.id);
  if (!full) return report;
  const plain = restorePlainState(full, null);
  const resolved = new Set<string>();
  const skipped = new Set<string>();
  const supplierCodes = supplierCodeIndex(input.template);
  const addLine = (kind: string, label: string, value: string | null | undefined, rowId?: string) => {
    if (readable(label) && readable(value)) {
      const code = rowId ? supplierCodes.get(rowId) : undefined;
      report.lines.push({ label: label.trim(), value: value.trim(), ...(code ? { supplierCode: code } : {}) });
      resolved.add(kind);
    } else skipped.add(kind);
  };

  const selections: ProductConfigurationSelections = {
    variantRowId: plain.variantRowId ?? undefined,
    variantGroupId: plain.variantGroupId ?? undefined,
    subgroupId: plain.subgroupId ?? undefined,
    systemRowId: plain.systemRowId ?? undefined,
    systemQuantity: plain.systemQuantity ?? undefined,
    categoryGroupId: plain.categoryGroupId ?? undefined,
    categoryRowId: plain.categoryRowId ?? undefined,
    fabricCategory: plain.fabricCategory ?? undefined,
    deskingSizeId: plain.workstationSizeId ?? undefined,
    modularQuantities: plain.modularQuantities,
    accessoryQuantities: plain.pricingAccessoryQuantities,
    skippedAccessoryGroupIds: plain.skippedAccessoryGroupIds,
    requiredOverrides: plain.requiredOverrides,
  };
  let steps: ProductConfigurationStep[] = [];
  try {
    const engineState = resolveProductConfigurationState(
      {
        id: input.template.id,
        templateName: input.template.template_name,
        internalSelectionName: input.template.internal_selection_name ?? null,
        itemCode: input.template.item_code ?? null,
        templateCode: input.template.template_code ?? null,
        supplierName: input.template.supplier_name ?? null,
        origin: input.template.origin ?? null,
        currency: "AED",
        defaultUnitPrice: 0, // the engine's money inputs are not used for names; no price is ever read or returned
        defaultSpecification: input.template.default_specification ?? null,
        description: input.template.description ?? null,
        variantPricing: input.template.variant_pricing,
        categoryPricing: input.template.category_pricing,
        accessoryPricing: input.template.accessory_pricing,
        deskingSizePricing: input.template.desking_size_pricing,
      },
      selections,
    );
    steps = engineState.steps;
    // Only a complete, current recipe gives a text worth showing (a stale id or an unresolved required step falls through to the template text).
    report.staleFingerprint = staleFingerprint(engineState.staleSelections);
    const complete = engineState.staleSelections.length === 0 && !hasBlockingRequiredStep(engineState.steps);
    const rows = Array.isArray(input.template.category_pricing) ? input.template.category_pricing as (ModularCategoryPricingShape & { dimension?: string; display_name?: string; variant_name?: string })[] : [];
    const groups = modularItemPricingGroups(rows).filter((group) => group.is_active !== false);
    const direct = groups.some(isDirectModularPricingGroup) ? buildDirectModularDimensionSuggestion(groups.flatMap((group) => (group.items ?? []).filter((row) => row.is_active !== false).map((row) => {
      const item = row as typeof rows[number];
      return { dimension: item.dimension, itemName: item.display_name || item.variant_name || "Modular item", quantity: plain.modularQuantities?.[item.id ?? ""] ?? 0 };
    }))) : null;
    const dimension = complete ? plainText(groups.length ? direct ?? modularPricingDefaultsFromRows(rows).defaultDimension ?? engineState.dimension : engineState.dimension) : null;
    report.dimension = dimension && !looksLikeMoneyText(dimension) ? dimension : null;
    const text = complete ? plainText(engineState.specification) : null;
    report.generatedSpecification = text && !looksLikeMoneyText(text) ? text.slice(0, GALLERY_DETAIL_SPECIFICATION_MAX) : null;
    // Required components: only for a complete, current recipe (same condition as the generated text); otherwise the block is skipped.
    if (complete) report.requiredComponents = requiredComponentsFromEngine(engineState.autoApplied, input.template.accessory_pricing);
  } catch {
    steps = [];
  }

  const selectedId: Record<string, string | null | undefined> = {
    system_base: plain.systemRowId,
    variant_group: plain.variantGroupId,
    variant_subgroup: plain.subgroupId,
    variant_row: plain.variantRowId,
    workstation_size: plain.workstationSizeId,
    category_group: plain.categoryGroupId,
    category_row: plain.categoryRowId,
    fabric_category: plain.fabricCategory,
  };
  for (const step of steps) {
    const kind = step.kind;
    if (kind in selectedId) {
      const wanted = selectedId[kind];
      if (!wanted) continue; // nothing was saved for this step
      const option = step.options.find((candidate) => candidate.id === wanted);
      addLine(kind, step.label, option?.label, wanted);
    } else if (kind === "modular") {
      for (const option of step.options) {
        const qty = Math.trunc(Number((plain.modularQuantities ?? {})[option.id] ?? 0));
        if (qty > 0) addLine(kind, step.label, qty > 1 ? `${option.label} x ${qty}` : option.label, option.id);
      }
    } else if (kind === "accessory") {
      for (const optionId of step.selectedOptionIds ?? []) {
        const option = step.options.find((candidate) => candidate.id === optionId);
        const qty = Math.trunc(Number((plain.pricingAccessoryQuantities ?? {})[optionId] ?? 0));
        addLine(kind, step.label, option?.label ? (qty > 1 ? `${option.label} x ${qty}` : option.label) : null, optionId);
      }
    }
  }

  // Options (components) and linked products are not engine steps: names come from their own rows.
  const componentById = new Map(input.components.map((component) => [component.id, component]));
  for (const value of Object.values(plain.componentOptionSelections ?? {})) {
    for (const id of Array.isArray(value) ? value : [value]) {
      const component = componentById.get(String(id));
      addLine("component_option", component?.component_group?.trim() || "Option", component?.component_name);
    }
  }
  const linkedLabel = new Map(input.linkedFamilies.map((family) => [family.id, family.label]));
  for (const linkId of Object.keys(full.linked.selections ?? {})) addLine("linked", "Linked product", linkedLabel.get(linkId));

  report.resolvedKinds = Array.from(resolved);
  report.skippedKinds = Array.from(skipped).filter((kind) => !resolved.has(kind));
  return report;
}

/**
 * The specification to show: (a) the gallery item's own saved text, (b) the text generated from the saved configuration, (c) the
 * template's default specification, (d) the template description, else none. Generated text equal to the template text is labelled
 * "template" (nothing was generated from the choices). Text that looks like money is never used from a generated source.
 */
export function chooseSpecification(input: { gallery?: unknown; generated?: string | null; templateSpecification?: unknown; templateDescription?: unknown }): { text: string | null; source: GallerySpecificationSource; usedDescription: boolean } {
  const gallery = plainText(input.gallery);
  if (gallery) return { text: gallery.slice(0, GALLERY_DETAIL_SPECIFICATION_MAX), source: "gallery", usedDescription: false };
  const templateSpec = plainText(input.templateSpecification);
  const generated = plainText(input.generated);
  if (generated && generated !== templateSpec) return { text: generated.slice(0, GALLERY_DETAIL_SPECIFICATION_MAX), source: "generated", usedDescription: false };
  if (templateSpec) return { text: templateSpec, source: "template", usedDescription: false };
  const description = plainText(input.templateDescription);
  if (description) return { text: description, source: "template", usedDescription: true };
  return { text: null, source: "none", usedDescription: false };
}

// ── Whole payload ──────────────────────────────────────────────────────────
export function buildGalleryDetail(input: {
  item: { id: string; template_id: string; item_name: string; display_name: string | null; item_code: string | null; tags: string[] | null; quoted_count: number | string; recipe: unknown; specification?: string | null; selected_image?: string | null; offers?: ReadonlyArray<{ kind: string; proposed_value: string | null; status: string }> | null };
  template: ConfigurationTemplateInput & Record<string, unknown>;
  brandName: string;
  categoryName: string;
  subCategoryName: string;
  materials: GalleryDetailMaterialGroup[];
  components: ComponentRow[];
  linkedFamilies: LinkedFamilyRow[];
}): { detail: GalleryDetail; report: ConfigurationReport } {
  const report = describeRecipe({ recipe: input.item.recipe, template: input.template, components: input.components, linkedFamilies: input.linkedFamilies });
  const quoted = Number(input.item.quoted_count);
  const spec = chooseSpecification({
    gallery: input.item.specification,
    generated: report.generatedSpecification,
    templateSpecification: input.template.default_specification,
    templateDescription: input.template.description,
  });
  const detail: GalleryDetail = {
    id: input.item.id,
    templateId: input.item.template_id,
    displayName: galleryDisplayName({ displayName: input.item.display_name, itemName: input.item.item_name }),
    itemName: input.item.item_name,
    brandName: input.brandName,
    categoryName: input.categoryName,
    subCategoryName: input.subCategoryName,
    itemCode: input.item.item_code?.trim() || (typeof input.template.item_code === "string" ? input.template.item_code.trim() : ""),
    templateCode: typeof input.template.template_code === "string" ? input.template.template_code.trim() : "",
    tags: Array.isArray(input.item.tags) ? input.item.tags : [],
    quotedCount: Number.isFinite(quoted) ? quoted : 1,
    images: galleryDetailImages(input.template, input.item.selected_image),
    // The description is shown on its own, unless it is the text used as the specification (then it is not shown twice).
    description: spec.usedDescription ? null : plainText(input.template.description),
    specification: spec.text,
    specificationSource: spec.source,
    dimension: report.dimension,
    configuration: report.lines,
    requiredComponents: report.requiredComponents,
    updates: input.item.offers ? buildUpdates({ offers: input.item.offers, currentSpecification: input.item.specification, template: input.template, selectedImage: input.item.selected_image }) : null,
    staleNotice: input.item.offers && report.staleFingerprint && !input.item.offers.some((offer) => offer.kind === "configuration" && offer.status === "ignored" && offer.proposed_value === report.staleFingerprint) ? { fingerprint: report.staleFingerprint } : null,
    materials: input.materials,
    options: mapOptions({ components: input.components, accessoryPricing: input.template.accessory_pricing, linkedFamilies: input.linkedFamilies }),
  };
  return { detail: removePriceLikeKeys(detail), report };
}

// ── Last guard: no price-like key can survive ──────────────────────────────
const PRICE_WORDS = new Set(["price", "prices", "pricing", "cost", "costs", "discount", "discounts", "amount", "amounts", "rate", "rates", "total", "totals", "margin", "currency"]);
/** True for keys such as price, prices, unit_price, listPrice, internal_cost, discountValue, exchange_rate. */
export function isPriceLikeKey(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word) => PRICE_WORDS.has(word));
}
/** True for a text that is an amount with a currency, such as "AED 1,200" or "250 USD". */
export function looksLikeMoneyText(value: string): boolean {
  return /\b(aed|usd|eur|dhs)\s*[0-9]/i.test(value) || /[0-9]\s*(aed|usd|eur|dhs)\b/i.test(value) || /[$€]\s*[0-9]/.test(value);
}

export function removePriceLikeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => removePriceLikeKeys(entry)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !isPriceLikeKey(key)).map(([key, entry]) => [key, removePriceLikeKeys(entry)])) as T;
  }
  return value;
}
