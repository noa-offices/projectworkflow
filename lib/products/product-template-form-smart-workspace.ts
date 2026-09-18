import { baseModelPricingGroups, LEGACY_BASE_MODEL_GROUP_ID, type BaseModelPricingSubgroup } from "./base-model-pricing-groups";
import type { ProductTemplateDraft, ProductTemplateDraftCurrency, ProductTemplateDraftDimension, ProductTemplateDraftPricedRow } from "./product-template-draft";
import { createSmartSetupReviewRouting, type SmartReviewAccessoryConfiguration, type SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";
import { ACCESSORY_APPLICABILITY_TARGET_KINDS, type AccessoryApplicabilityTarget } from "./accessory-conditional-configuration";
import type { SmartReviewedPricingSubgroups } from "./smart-product-row-images";
import { normalizeWorkstationPricing } from "./workstation-pricing-groups";
import { reviewImportantRequirements } from "./smart-product-review";

type FormSnapshot = Record<string, string>;
type JsonRow = Record<string, unknown>;
const currencies = new Set(["AED", "USD", "EUR", "GBP", "SAR", "QAR", "KWD", "BHD", "OMR"]);
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const currency = (value: unknown) => currencies.has(String(value)) ? String(value) as ProductTemplateDraftCurrency : null;
const price = (value: unknown) => value === null || value === "" || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const modularRole = (value: unknown): "starter" | "intermediate" | "terminal" | undefined => {
  const role = text(value);
  return role === "starter" || role === "intermediate" || role === "terminal" ? role : undefined;
};
const dimension = (value: unknown): ProductTemplateDraftDimension | null => text(value) ? { width: null, depth: null, height: null, diameter: null, unit: null, rawText: text(value) } : null;
const code = (value: unknown) => text(value) ? [text(value)!] : [];
const parse = (value: string) => { try { const parsed: unknown = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.filter((item): item is JsonRow => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; } catch { return []; } };
const row = (item: JsonRow, fallbackId?: string): ProductTemplateDraftPricedRow => ({ id: text(item.id) ?? fallbackId ?? crypto.randomUUID(), label: text(item.variant_name ?? item.label ?? item.item_name), displayName: text(item.display_name ?? item.item_name), dimensions: dimension(item.dimension ?? item.default_dimension), currency: currency(item.currency), price: price(item.price ?? item.default_price), specification: text(item.specification), ...(Array.isArray(item.importantRequirements) ? { importantRequirements: reviewImportantRequirements(item.importantRequirements.filter((value): value is string => typeof value === "string").join("\n")) } : {}), supplierCodes: code(item.supplier_price_list_code ?? item.base_supplier_price_list_code), referenceCodes: [] });
const matrixRow = (item: JsonRow, columns: string[]) => { const base = row(item); const prices = (item.prices && typeof item.prices === "object" ? item.prices : {}) as Record<string, unknown>; return { id: base.id, label: base.label, displayName: base.displayName, dimensions: base.dimensions, currency: base.currency, specification: base.specification, supplierCodes: base.supplierCodes, referenceCodes: base.referenceCodes, prices: Object.fromEntries(columns.map((column) => [column, price(prices[column] ?? (column === "price" ? base.price : null))])), unavailableCategoryIds: Array.isArray(item.unavailable_categories) ? item.unavailable_categories.filter((category): category is string => typeof category === "string" && columns.includes(category)) : [] }; };
const subgroups = (value: unknown) => Array.isArray(value) ? value as BaseModelPricingSubgroup[] : [];
const applicabilityTarget = (value: unknown): AccessoryApplicabilityTarget | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as JsonRow;
  const kind = text(raw.kind);
  const groupId = text(raw.group_id);
  const rowId = text(raw.row_id);
  return kind && ACCESSORY_APPLICABILITY_TARGET_KINDS.includes(kind as AccessoryApplicabilityTarget["kind"]) && groupId && rowId
    ? { kind: kind as AccessoryApplicabilityTarget["kind"], group_id: groupId, row_id: rowId }
    : undefined;
};

function accessoryConfiguration(group: JsonRow): SmartReviewAccessoryConfiguration {
  const raw = group.conditional_configuration as JsonRow | undefined;
  const selection = raw?.selection === "exactly_one" ? (group.group_is_required ? "required_exactly_one" : "optional_exactly_one") : raw?.selection === "at_least_one" ? "required_at_least_one" : raw?.selection === "choose_multiple" ? "multiple" : "optional_multiple";
  return { role: raw?.role === "conditional_option" || raw?.role === "companion" ? raw.role : "accessory", selection, rules: Array.isArray(raw?.applicability) ? raw.applicability.flatMap((rule) => {
    if (!rule || typeof rule !== "object") return [];
    const item = rule as JsonRow;
    const target = applicabilityTarget(item.target);
    return [{ ...(target ? { target } : { baseModelGroupId: text(item.base_model_group_id) ?? "", baseModelRowId: text(item.base_model_row_id) ?? "" }), required: item.required === true, visible: item.visible !== false, ...(Array.isArray(item.allowed_item_ids) ? { allowedItemIds: item.allowed_item_ids as string[] } : {}), ...(Number.isFinite(Number(item.fixed_quantity)) ? { fixedQuantity: Number(item.fixed_quantity) } : {}), ...(item.scale_with_target_quantity === true ? { scaleWithTargetQuantity: true } : {}) }];
  }) : [] };
}

export function productTemplateFormSmartWorkspace(snapshot: FormSnapshot): { draft: ProductTemplateDraft; plan: SmartSetupReviewRoutingPlan; subgroups: SmartReviewedPricingSubgroups } {
  const baseGroups = baseModelPricingGroups<JsonRow>(parse(snapshot.variant_pricing));
  const workstationGroups = normalizeWorkstationPricing<JsonRow>(parse(snapshot.desking_size_pricing)).groups;
  const categoryGroups = [...parse(snapshot.category_pricing), ...parse(snapshot.modular_item_pricing)];
  const accessoryGroups = parse(snapshot.accessory_pricing);
  const baseRows = baseGroups.filter((group) => group.isSyntheticLegacyGroup).flatMap((group) => group.items.map((item) => row(item)));
  const matrices = baseGroups.filter((group) => !group.isSyntheticLegacyGroup).map((group) => ({ id: group.id, label: group.group_name, columns: [{ id: "price", label: "Price" }], rows: group.items.map((item) => matrixRow(item, ["price"])) }));
  const standardCategories = categoryGroups.filter((group) => group.pricing_type !== "modular_group").map((group, index) => { const columns = Array.isArray(group.price_categories) ? group.price_categories.filter((item): item is string => typeof item === "string") : Object.keys(((group.items as JsonRow[] | undefined)?.[0]?.prices as JsonRow | undefined) ?? {}); return { id: text(group.id) ?? `category-${index}`, label: text(group.group_name), columns: columns.map((label) => ({ id: label, label })), rows: (Array.isArray(group.items) ? group.items as JsonRow[] : []).map((item) => matrixRow(item, columns)) }; });
  const modularGroups = categoryGroups.filter((group) => group.pricing_type === "modular_group").map((group, index) => {
    const columns = Array.isArray(group.price_categories) ? group.price_categories.filter((item): item is string => typeof item === "string") : [];
    const id = text(group.id) ?? `modular-${index}`;
    const base = { id, label: text(group.group_name), defaultDimensions: dimension(group.modular_default_dimension), defaultSpecification: text(group.modular_default_specification) };
    if (group.modular_pricing_mode === "direct") {
      const composition = group.modular_composition && typeof group.modular_composition === "object" && !Array.isArray(group.modular_composition) ? group.modular_composition as JsonRow : null;
      return {
        ...base,
        ...(text(group.modular_selection_family) ? { selectionFamily: text(group.modular_selection_family)! } : {}),
        pricingMode: "direct" as const,
        directRows: (Array.isArray(group.items) ? group.items as JsonRow[] : []).map((item) => ({ ...row(item), ...(modularRole(item.modular_role) ? { role: modularRole(item.modular_role) } : {}) })),
        ...(composition ? { composition: { minStarters: price(composition.min_starters) ?? 0, maxStarters: price(composition.max_starters) } } : {}),
      };
    }
    const composition = group.modular_composition && typeof group.modular_composition === "object" && !Array.isArray(group.modular_composition) ? group.modular_composition as JsonRow : null;
    return { ...base, matrix: { id: `${id}-matrix`, label: text(group.group_name), columns: columns.map((label) => ({ id: label, label })), rows: (Array.isArray(group.items) ? group.items as JsonRow[] : []).map((item) => ({ ...matrixRow(item, columns), ...(modularRole(item.modular_role) ? { role: modularRole(item.modular_role) } : {}) })) }, ...(composition ? { composition: { minStarters: price(composition.min_starters) ?? 0, maxStarters: price(composition.max_starters) } } : {}) };
  });
  const optionGroups = accessoryGroups.map((group, index) => { const priceCategories = Array.isArray(group.price_categories) ? group.price_categories.flatMap((value) => { const category = value as JsonRow; const id = text(category?.id); const label = text(category?.label); return id && label ? [{ id, label }] : []; }) : []; return { id: text(group.id) ?? `accessory-${index}`, label: text(group.group_name), selection: { mode: "optional" as const, minSelections: 0, maxSelections: null, defaultItemIds: [] }, ...(priceCategories.length ? { priceCategories } : {}), items: (Array.isArray(group.items) ? group.items as JsonRow[] : [group]).map((item) => { const prices = item.prices && typeof item.prices === "object" && !Array.isArray(item.prices) ? item.prices as JsonRow : {}; return { ...row(item), ...(priceCategories.length ? { prices: Object.fromEntries(priceCategories.map((category) => [category.id, price(prices[category.id])])) } : {}) }; }) }; });
  const draft: ProductTemplateDraft = { version: 1, template: { templateName: text(snapshot.template_name), templateCode: text(snapshot.template_code), itemCode: text(snapshot.item_code), internalSelectionName: text(snapshot.internal_selection_name), description: text(snapshot.description), specification: text(snapshot.default_specification), origin: text(snapshot.origin), supplierName: text(snapshot.supplier_name), dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: currency(snapshot.currency), pricing: { workstationRows: workstationGroups.flatMap((group) => group.items.map((item, index) => { const layout = text(item.layout_type)?.toLowerCase(); return { ...row(item, `${group.id}-size-${index}`), additionalPrice: price(item.additional_price), layoutType: layout === "linear" || layout === "cluster" || layout === "both" ? layout : null }; })), baseModelRows: baseRows, priceMatrices: [...matrices, ...standardCategories], modularGroups }, optionGroups, materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [] };
  const plan = createSmartSetupReviewRouting(draft);
  const baseMatrixIds = new Set(matrices.map((matrix) => matrix.id));
  const categoryMatrixIds = new Set(standardCategories.map((matrix) => matrix.id));
  plan.routes.forEach((route) => { if (baseMatrixIds.has(route.sourceId)) { route.destination = "base_model"; route.recommendedDestination = "base_model"; } else if (categoryMatrixIds.has(route.sourceId)) { route.destination = "category_matrix"; route.recommendedDestination = "category_matrix"; } });
  accessoryGroups.forEach((group, index) => { const route = plan.routes.find((item) => item.key === `option:${optionGroups[index].id}`); if (route) { route.groupName = text(group.group_name) ?? route.groupName; route.accessory = accessoryConfiguration(group); } });
  const reviewed: SmartReviewedPricingSubgroups = {};
  baseGroups.forEach((group) => { if (group.subgroups?.length) reviewed[group.id === LEGACY_BASE_MODEL_GROUP_ID ? "base_model:rows" : `matrix:${group.id}`] = subgroups(group.subgroups); });
  workstationGroups.forEach((group) => { if (group.subgroups?.length) reviewed["workstation:rows"] = subgroups(group.subgroups); });
  categoryGroups.forEach((group) => { const key = group.pricing_type === "modular_group" ? `modular:${text(group.id)}` : `matrix:${text(group.id)}`; if (subgroups(group.subgroups).length) reviewed[key] = subgroups(group.subgroups); });
  accessoryGroups.forEach((group, index) => { if (subgroups(group.subgroups).length) reviewed[`option:${optionGroups[index].id}`] = subgroups(group.subgroups); });
  return { draft, plan, subgroups: reviewed };
}
