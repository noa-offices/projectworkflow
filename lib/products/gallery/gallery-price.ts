import { parseSupportedCurrency } from "@/lib/currencies";
import { accessoryApplicabilityTargetKey, type AccessoryApplicabilityTarget } from "@/lib/products/accessory-conditional-configuration";
import { standardCategoryPriceColumns, groupedStandardCategoryPricingRows } from "@/lib/products/category-pricing-groups";
import { resolveMainAccessoryTargets } from "@/lib/products/main-accessory-targets";
import { isDirectModularPricingGroup, modularItemPricingGroups, modularItemPricingRows } from "@/lib/products/modular-pricing";
import { deriveOptionItemTargets, ordinaryOptionItemGroupIds, withoutOrdinaryOptionItemDependentQuantities, type OptionItemExtraTargets, type OptionItemPassGroup } from "@/lib/products/option-item-targets";
import { findWorkstationPricingRow, workstationPricingGroups } from "@/lib/products/workstation-pricing-groups";
import { resolvedMatrixModularPricingCategory } from "@/lib/quotations/modular-pricing-category";
import { activeBaseModelPricingGroups, isSystemBaseRow, nativeBaseModelTargets, nativeSystemState, remapBaseModelTargetsToOwnerGroups, strictSystemQuantity } from "@/lib/quotations/native-system-base";
import { evaluateProductAccessorySelection } from "@/lib/quotations/product-accessory-configuration";
import { effectiveRequiredQuantities, requiredComponentTriggerKey } from "@/lib/quotations/required-component-overrides";
import { baseModelPriceOrDefault, roundSourceAmount } from "@/lib/quotations/source-price-components";
import { evaluateSetup, type SetupTemplateInput } from "../saved-setups/replay";
import { completeGalleryRecipe, neutralSpecOverrides } from "./gallery";

export type GalleryPriceTemplate = SetupTemplateInput;
export type GalleryPriceComponent = {
  id: string; template_id: string; option_type: string | null; qty: number;
  unit_price: number; currency: string | null; calculation_data?: { desking_role?: string } | null;
  component_group?: string | null; is_default_selected?: boolean; sort_order?: number;
};
export type GalleryPriceLink = {
  id: string; parent_template_id: string; linked_template_id: string; is_required: boolean;
  allow_multiple: boolean; add_to_parent_price: boolean; default_qty?: number;
};
export type GalleryPriceContext = {
  components?: readonly GalleryPriceComponent[];
  links?: readonly GalleryPriceLink[];
  linkedTemplates?: ReadonlyMap<string, GalleryPriceTemplate>;
  materialIds?: readonly string[];
};
export type RecipePrice =
  | { status: "priced"; sourceTotals: Array<{ currency: string; amount: number }> }
  | { status: "needs_configure"; reason: string };

type PricingRow = {
  id?: string; pricing_type?: string; variant_name?: string; display_name?: string; dimension?: string;
  price?: number | null; prices?: Record<string, number | null>; currency?: string;
  group_name?: string; is_active?: boolean; sort_order?: number;
  unavailable_categories?: string[];
};
type Accessory = PricingRow & {
  item_name?: string; supplier_price_list_code?: string; specification?: string;
  unavailable_price_categories?: string[];
};
type AccessoryGroup = Accessory & OptionItemPassGroup & {
  group_is_required?: boolean; price_categories?: Array<{ id: string }>; items?: Accessory[];
  conditional_configuration?: { applicability: Array<Record<string, unknown> & { target?: { kind?: string; group_id?: string; row_id?: string } }> };
};
type WorkstationRow = Record<string, unknown> & PricingRow & { default_price?: number; additional_price?: number };

const needs = (reason: string): RecipePrice => ({ status: "needs_configure", reason });
const amount = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rows = <T,>(value: unknown): T[] => Array.isArray(value) ? value : [];
const active = <T extends { is_active?: boolean }>(row: T) => row.is_active !== false;
const available = (template: GalleryPriceTemplate) => template.is_active === true && template.lifecycle_status === "active";
const sortRows = (a: { sort_order?: number }, b: { sort_order?: number }) => amount(a.sort_order) - amount(b.sort_order);

function accessoryGroups(value: unknown) {
  const source = rows<AccessoryGroup>(value);
  const isItem = (row: Accessory) => active(row) && (row.item_name || row.supplier_price_list_code || row.price != null || row.specification);
  const groups = source.filter((group) => group.group_name || group.items).map((group, index) => ({
    ...group,
    id: group.id ?? `add-on-group-${index}`,
    group_name: group.group_name?.trim() || "Accessories",
    group_is_required: group.group_is_required === true,
    sort_order: amount(group.sort_order, index),
    items: rows<Accessory>(group.items).filter(isItem).sort(sortRows),
  })).filter((group) => active(group) && group.items.length).sort(sortRows);
  const flat = source.filter((row) => !row.group_name && !row.items).filter(isItem).sort(sortRows);
  return flat.length ? [...groups, { id: "accessories", group_name: "Accessories", group_is_required: false, sort_order: groups.length, items: flat }] : groups;
}

const matrixGroups = (value: unknown) => groupedStandardCategoryPricingRows<PricingRow>(rows<PricingRow>(value))
  .filter(active).map((group) => ({ ...group, items: rows<PricingRow>(group.items).filter(active) }));
const isModularPriceRow = (row: PricingRow) => row.variant_name || row.dimension || amount(row.price) > 0 || Object.values(row.prices ?? {}).some((value) => amount(value) > 0);
const isMatrixPriceRow = (row: PricingRow) => row.variant_name || row.dimension || Object.values(row.prices ?? {}).some((value) => amount(value) > 0);

function categories(template: GalleryPriceTemplate) {
  return [...new Set([
    ...standardCategoryPriceColumns(rows<PricingRow>(template.category_pricing)),
    ...modularItemPricingRows<PricingRow>(rows<PricingRow>(template.category_pricing)).filter(active).filter(isMatrixPriceRow).sort(sortRows)
      .flatMap((row) => Object.keys(row.prices ?? {})),
  ])];
}

/** Source-only mirror of addProductTemplateToQuotation. See gallery-price-drift.test.mts before changing it. */
export function priceRecipe(template: GalleryPriceTemplate, rawRecipe: unknown, context: GalleryPriceContext = {}): RecipePrice {
  try {
    if (!available(template)) return needs("retired_template");
    const recipe = completeGalleryRecipe(rawRecipe, template.id);
    if (!recipe) return needs("invalid_recipe");
    const components = (context.components ?? []).filter((component) => component.template_id === template.id);
    const links = (context.links ?? []).filter((link) => link.parent_template_id === template.id);
    const modularGroups = modularItemPricingGroups<PricingRow>(rows<PricingRow>(template.category_pricing))
      .filter(active).map((group) => ({ ...group, items: rows<PricingRow>(group.items).filter(active) }));
    const workstationRows = workstationPricingGroups<WorkstationRow>(template.desking_size_pricing ?? []).filter((group) => group.is_active)
      .flatMap((group) => group.items.flatMap((row, index) => active(row) ? [{ group, row: { ...row, id: row.id ?? `${group.id}-size-${index}` } }] : []));
    const usesModular = modularGroups.some((group) => group.items.some(isModularPriceRow));
    if (usesModular && workstationRows.length) return needs("ambiguous_precedence");
    // Hidden Base / Model and Price Matrix selections are historical noise for modular rows.
    const selections = { ...recipe.selections };
    if ([selections.modular_quantities, selections.pricing_accessory_quantities, selections.component_accessory_quantities]
      .some((quantities) => Object.values(quantities).some((quantity) => !Number.isSafeInteger(quantity) || quantity < 0))) return needs("invalid_recipe");
    if (usesModular || workstationRows.length) {
      delete selections.category_group_id;
      delete selections.category_row_id;
    }
    if (usesModular) {
      delete selections.variant_group_id;
      delete selections.subgroup_id;
      delete selections.variant_row_id;
    }
    // Gallery storage keeps linked selections under linkId:instanceId but omits the instance index.
    const instances: Record<string, string[]> = Object.create(null);
    for (const key of Object.keys(recipe.linked.selections)) {
      const separator = key.indexOf(":");
      if (separator < 1 || separator === key.length - 1) return needs("unresolved_linked_product");
      const linkId = key.slice(0, separator);
      (instances[linkId] ??= []).push(key.slice(separator + 1));
    }
    const groups = accessoryGroups(template.accessory_pricing);
    const replay = evaluateSetup({ ...recipe, selections, linked: { ...recipe.linked, instances } }, neutralSpecOverrides(), { ...template, accessory_pricing: groups }, {
      componentIds: components.map(({ id }) => id),
      linkedFamilyIds: links.map(({ id }) => id),
      materialIds: context.materialIds ?? [],
    });
    const selected = replay.state;
    // The engine's exchange-rate issue means it could not combine currencies. The quotation action
    // retains these source buckets separately; later conversion is outside this module.
    if (!selected || replay.validation.problems.some((problem) =>
      problem.kind !== "rule_changed" || !problem.label.startsWith("An exchange rate is required for: "))) return needs("unresolved_choices");

    const baseGroups = activeBaseModelPricingGroups<Record<string, unknown> & PricingRow>(template.variant_pricing ?? []);
    const baseRows = baseGroups.flatMap((group) => group.items);
    const variant = selected.variantRowId ? baseRows.find((row) => row.id === selected.variantRowId && !isSystemBaseRow(row)) : null;
    const variantGroup = variant ? baseGroups.find((group) => group.items.includes(variant)) : null;
    if (selected.variantRowId && !variant) return needs("unresolved_choices");
    const system = selected.systemRowId ? nativeSystemState(baseGroups).options.find((option) => option.row.id === selected.systemRowId) : null;
    const systemQuantity = system ? strictSystemQuantity(String(selected.systemQuantity ?? 1)) : 1;
    if ((selected.systemRowId && !system) || systemQuantity === null ||
      (system && variant && system.group.id !== variantGroup?.id) ||
      (system && (!variant || workstationRows.length) && system.group.items.some((row) => !isSystemBaseRow(row))) ||
      (!system && !workstationRows.length && variantGroup?.items.some(isSystemBaseRow))) return needs("unresolved_choices");
    let matrix = !variant && !usesModular && !workstationRows.length
      ? matrixGroups(template.category_pricing).flatMap((group) => group.items.filter(isMatrixPriceRow).map((row) => ({ group, row }))).sort((a,b) => sortRows(a.row,b.row))
      : [];
    if (selected.categoryRowId) matrix = matrix.filter(({ row }) => row.id === selected.categoryRowId);
    const category = matrix[0];
    if (selected.categoryRowId && !category) return needs("unresolved_choices");
    if (!variant && !category && !usesModular && !workstationRows.length && baseRows.some((row) => !isSystemBaseRow(row))) return needs("unresolved_choices");
    const workstation = selected.workstationSizeId
      ? findWorkstationPricingRow<WorkstationRow>(template.desking_size_pricing, { rowId: selected.workstationSizeId })
      : workstationRows.length === 1 ? workstationRows[0] : null;
    if (workstationRows.length && !workstation) return needs("unresolved_choices");
    const matrixModular = usesModular && modularGroups.some((group) => !isDirectModularPricingGroup(group));
    const categoryLabel = matrixModular
      ? resolvedMatrixModularPricingCategory(modularGroups, selected.fabricCategory ?? null)
      : selected.fabricCategory || categories(template)[0] || "Cat A";
    if (!categoryLabel) return needs("unresolved_choices");
    const modular = modularGroups.flatMap((group) => group.items.flatMap((row) => {
      const id = row.id ?? row.variant_name ?? row.display_name ?? "";
      const qty = selected.modularQuantities?.[id] ?? 0;
      return qty > 0 ? [{ group, row, id, qty }] : [];
    }));
    if (usesModular && !modular.length) return needs("unresolved_choices");
    if (modular.some(({ group, row }) => !isDirectModularPricingGroup(group) &&
      (row.prices?.[categoryLabel] == null || row.unavailable_categories?.includes(categoryLabel))) ||
      (category && (category.row.prices?.[categoryLabel] == null || category.row.unavailable_categories?.includes(categoryLabel)))) return needs("unavailable_price");

    const componentQty = selected.componentAccessoryQuantities ?? {};
    const componentSelections = selected.componentOptionSelections ?? {};
    const selectedIds = new Set(Object.values(componentSelections).flat());
    const defaultGroups = new Set<string>();
    for (const option of [...components].sort((a, b) => sortRows(a, b) || a.id.localeCompare(b.id))) {
      const accessory = option.calculation_data?.desking_role === "accessory";
      if ((accessory || (workstation && option.option_type === "linked_addon")) && (componentQty[option.id] ?? 0) > 0) {
        selectedIds.add(option.id);
      }
      const key = `${option.option_type}:${option.component_group}`;
      if (!option.is_default_selected || accessory || Object.hasOwn(componentSelections, key)) continue;
      // The selector submits the first default per ordinary group, but every default for linked add-ons.
      if (option.option_type === "linked_addon" || !defaultGroups.has(key)) selectedIds.add(option.id);
      defaultGroups.add(key);
    }
    const options = components.filter((component) => selectedIds.has(component.id));
    const baseCurrency = parseSupportedCurrency(workstation?.row.currency || modular[0]?.row.currency || category?.row.currency || variant?.currency || template.currency);
    if (!baseCurrency) return needs("unknown_currency");
    const baseOptions = workstation
      ? options.filter((option) => (option.option_type === "linked_addon" || option.calculation_data?.desking_role === "accessory") && (componentQty[option.id] ?? 0) > 0)
      : !usesModular && !category && !variant ? options : [];
    // The action adds these to a single base bucket. With differing currencies there is no safe split.
    if (baseOptions.some((option) => option.unit_price > 0 && option.currency && parseSupportedCurrency(option.currency) !== baseCurrency) ||
      modular.some(({ row }) => parseSupportedCurrency(row.currency ?? template.currency) !== baseCurrency)) return needs("mixed_base_currencies");
    const optionTotal = roundSourceAmount(baseOptions.reduce((sum, option) => sum + (workstation
      ? (componentQty[option.id] ?? 0) * amount(option.unit_price)
      : (Number.isFinite(option.qty) && option.qty > 0 ? option.qty : 1) * Math.max(0, amount(option.unit_price))), 0));
    const defaultPrice = amount(template.default_unit_price);
    const workstationBase = workstation ? amount(workstation.row.default_price, defaultPrice) : 0;
    const base = workstation
      ? roundSourceAmount(workstationBase + roundSourceAmount(amount(workstation.row.additional_price, workstationBase) * Math.max(0, Math.trunc(selected.additionalClusterQuantity ?? 0))) + optionTotal) || roundSourceAmount(defaultPrice)
      : usesModular ? roundSourceAmount(modular.reduce((sum, { group, row, qty }) =>
          sum + roundSourceAmount(roundSourceAmount(amount(isDirectModularPricingGroup(group) ? row.price : row.prices?.[categoryLabel])) * qty), 0))
      : category ? roundSourceAmount(amount(category.row.prices?.[categoryLabel]))
      : variant ? roundSourceAmount(baseModelPriceOrDefault(variant.price, defaultPrice))
      : roundSourceAmount(defaultPrice + optionTotal);

    const targets = resolveMainAccessoryTargets({
      workstation: workstation ? [{ kind: "workstation", group_id: workstation.group.id, row_id: String(workstation.row.id) }] : [],
      usesModularPricing: usesModular,
      modular: modular.map(({ group, id }) => ({ kind: "modular", group_id: group.id ?? "", row_id: id })),
      baseModel: variant && variantGroup && !workstation ? nativeBaseModelTargets({
        mainGroupId: variantGroup.id, mainRowId: variant.id, systemGroupId: system?.group.id, systemRowId: system?.row.id,
      }) : [],
      priceMatrix: category ? [{ kind: "price_matrix", group_id: category.group.id ?? "", row_id: category.row.id ?? "" }] : [],
    });
    const targetQuantities = Object.fromEntries([
      ...modular.map(({ group, id, qty }) => [accessoryApplicabilityTargetKey({ kind: "modular", group_id: group.id ?? "", row_id: id }), qty]),
      ...(system ? [[accessoryApplicabilityTargetKey({ kind: "base_model", group_id: system.group.id, row_id: String(system.row.id) }), systemQuantity]] : []),
    ]);
    const authoritative = nativeSystemState(baseGroups).active ? remapBaseModelTargetsToOwnerGroups(groups, baseGroups) : groups;
    if (authoritative.some((group) => group.conditional_configuration) && !targets.length) return needs("unresolved_choices");
    const optionGroups = authoritative as OptionItemPassGroup[];
    const overrides = selected.requiredOverrides ?? {};
    const accessoryQty = selected.pricingAccessoryQuantities ?? {};
    const evaluate = (quantities: Record<string, number>, extra?: OptionItemExtraTargets) => evaluateProductAccessorySelection({
      accessoryGroups: authoritative, baseModelGroupId: variantGroup?.id, baseModelRowId: variant?.id,
      selectedModelTarget: targets[0], selectedModelTargets: [...targets, ...(extra?.targets ?? [])] as AccessoryApplicabilityTarget[],
      selectedModelTargetQuantities: { ...targetQuantities, ...extra?.quantities }, selectedQuantities: quantities, allowRequiredCompanionOverrides: true,
    });
    const firstQty = withoutOrdinaryOptionItemDependentQuantities(optionGroups, accessoryQty);
    const primary = effectiveRequiredQuantities(evaluate(firstQty).groups.filter((group) =>
      !optionGroups.some((candidate) => candidate.id === group.groupId && candidate.conditional_configuration?.applicability?.some((rule) => rule.target?.kind === "option_item"))),
    overrides, requiredComponentTriggerKey(targets, targetQuantities));
    const first = evaluate({ ...firstQty, ...primary });
    const extra = deriveOptionItemTargets({ groups: optionGroups, activeQuantities: first.activeQuantities });
    const dependentGroups = ordinaryOptionItemGroupIds(optionGroups);
    const allQty = { ...accessoryQty, ...primary };
    const final = extra.targets.length ? evaluate({
      ...allQty,
      ...effectiveRequiredQuantities(evaluate(allQty, extra).groups.filter((group) => dependentGroups.has(group.groupId)), overrides, requiredComponentTriggerKey(extra.targets, extra.quantities)),
    }, extra) : first;
    if (!final.valid || Object.keys(accessoryQty).some((id) => accessoryQty[id] > 0 && !Object.hasOwn(final.activeQuantities, id) && primary[id] !== 0)) return needs("unresolved_choices");

    const totals = new Map<string, number>();
    const add = (rawCurrency: unknown, value: number) => {
      const currency = parseSupportedCurrency(rawCurrency || baseCurrency);
      if (!currency) throw new Error("Unknown currency");
      totals.set(currency, roundSourceAmount((totals.get(currency) ?? 0) + value));
    };
    add(baseCurrency, base);
    if (system) add(system.row.currency, roundSourceAmount(amount(system.row.price) * systemQuantity));
    if (workstation && variant) add(variant.currency, roundSourceAmount(amount(variant.price)));
    for (const group of groups) for (const item of group.items) {
      const id = item.id ?? item.item_name ?? "";
      const qty = final.activeQuantities[id] ?? 0;
      const columns = group.price_categories ?? [];
      const availableColumns = columns.filter(({ id }) => item.prices?.[id] != null && !item.unavailable_price_categories?.includes(id));
      const savedColumn = selected.accessoryCategoryChoices?.[`${template.id}:${group.id}:${id}`];
      const column = savedColumn ? availableColumns.find(({ id }) => id === savedColumn)?.id : availableColumns[0]?.id;
      // The action validates category cells before it filters out unselected accessories.
      if (columns.length && (!(qty > 0) || !column)) return needs("unavailable_price");
      if (qty > 0) add(item.currency, qty * amount(column ? item.prices?.[column] : item.price));
    }

    for (const link of links) {
      const instances = selected.linkedInstances?.[link.id] ?? [];
      if ((link.is_required && !instances.length) || (!link.allow_multiple && instances.length > 1)) return needs("unresolved_linked_product");
      for (const instance of instances) {
        const choice = selected.linkedSelections?.[`${link.id}:${instance}`];
        const child = context.linkedTemplates?.get(link.linked_template_id);
        const qty = choice?.quantity ?? link.default_qty;
        if (!child || !available(child) || !choice || !Number.isInteger(qty) || Number(qty) <= 0) return needs("unresolved_linked_product");
        const childMatrix = matrixGroups(child.category_pricing).flatMap((group) => group.items).filter(isMatrixPriceRow).sort(sortRows);
        const childVariants = activeBaseModelPricingGroups<Record<string, unknown> & PricingRow>(child.variant_pricing ?? []).flatMap((group) => group.items)
          .filter((row) => row.variant_name || row.dimension || amount(row.price) > 0).sort(sortRows);
        const childCategory = choice.categoryId ? childMatrix.find((row) => row.id === choice.categoryId) : childMatrix[0];
        const childVariant = childCategory ? null : choice.variantRowId ? childVariants.find((row) => row.id === choice.variantRowId) : childVariants[0];
        if ((choice.categoryId && !childCategory) || (choice.variantRowId && !childVariant) || isSystemBaseRow(childVariant)) return needs("unresolved_linked_product");
        const childColumn = choice.fabricCategory || categories(child)[0] || "Cat A";
        if (childCategory && (childCategory.prices?.[childColumn] == null || childCategory.unavailable_categories?.includes(childColumn))) return needs("unavailable_price");
        const childCurrency = childCategory?.currency || childVariant?.currency || child.currency;
        const childPrice = roundSourceAmount(amount(childCategory ? childCategory.prices?.[childColumn] : childVariant ? childVariant.price : child.default_unit_price));
        if (link.add_to_parent_price) add(childCurrency, roundSourceAmount(childPrice * Number(qty)));
        const childItems = accessoryGroups(child.accessory_pricing).flatMap((group) => group.items);
        for (const [id, qty] of Object.entries(choice.accessoryQuantities ?? {})) {
          const item = childItems.find((row) => row.id === id);
          if (!item) return needs("unresolved_linked_product");
          if (link.add_to_parent_price) add(item.currency ?? childCurrency, qty * amount(item.price));
        }
      }
    }
    return { status: "priced", sourceTotals: [...totals].map(([currency, amount]) => ({ currency, amount })) };
  } catch {
    return needs("unresolved_choices");
  }
}
