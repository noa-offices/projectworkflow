import { formatMoney, normalizeCurrency } from "@/lib/currencies";
import { ruleConvertedPrice, ruleExactAmount, type PricingRule } from "@/lib/quotation-pricing";
import { activeBaseModelPricingGroups, nativeSystemState, normalizeSystemQuantity, systemPriceContribution } from "@/lib/quotations/native-system-base";
import { missingExchangeRateCurrencies, roundSourceAmount } from "@/lib/quotations/source-price-components";
import type { AccessoryConditionalConfiguration, StructuralSupportCompatibleTarget } from "./accessory-conditional-configuration";
import { accessoryItemPrice, accessoryPriceLines } from "./accessory-rule-setup";
import { flattenBaseModelPricingRows } from "./base-model-pricing-groups";
import { groupedStandardCategoryPricingRows, standardCategoryPriceColumns as groupedCategoryPriceColumns } from "./category-pricing-groups";
import { resolveLinkedProductFamily, type LinkedFamilyStored } from "./linked-product-family";
import { effectiveLinkedAccessoryQuantity, evaluateLinkedAccessories, linkedAccessoryRow, linkedFixedItemIds } from "./linked-accessory-rules";
import { isDirectModularPricingGroup, modularItemPricingRows, modularRowRole } from "./modular-pricing";
import { announcedQuotationDelta, announcedTotals } from "./price-announcements";
export type DeskingSizePricingRow = {
  id?: string;
  label?: string;
  supplier_price_list_code?: string;
  base_supplier_price_list_code?: string;
  length?: number;
  depth?: number;
  height?: number;
  dimension_unit?: string;
  layout_type?: string;
  default_price?: number;
  additional_price?: number;
  additional_supplier_price_list_code?: string;
  currency?: string;
  specification?: string;
  importantRequirements?: string[];
  default_dimension?: string;
  sort_order?: number;
  is_active?: boolean;
};

export type VariantPricingRow = {
  id?: string;
  /** Native System / Base row (Phase B); omitted for Main Product rows. */
  role?: "system_base";
  variant_name?: string;
  display_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  price?: number;
  currency?: string;
  specification?: string;
  importantRequirements?: string[];
  is_active?: boolean;
  sort_order?: number;
};

export type CategoryPricingRow = {
  id?: string;
  group_id?: string;
  group_name?: string;
  items?: CategoryPricingRow[];
  price_categories?: string[];
  pricing_type?: string | null;
  pricing_category_id?: string | null;
  pricing_category_name?: string | null;
  variant_name?: string;
  display_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  currency?: string;
  prices?: Record<string, number | null>;
  /** Direct-priced modular rows carry one scalar price instead of category cells. */
  price?: number | null;
  unavailable_categories?: string[];
  specification?: string;
  importantRequirements?: string[];
  modular_default_dimension?: string | null;
  modular_default_specification?: string | null;
  modular_pricing_mode?: string | null;
  modular_composition?: { min_starters?: number | null; max_starters?: number | null } | null;
  modular_role?: string | null;
  /** Opt-in one-way-only marker: the modular way and the Base Size / Main Price way cannot be selected together. */
  modular_excludes_base_models?: boolean | null;
  is_active?: boolean;
  sort_order?: number;
};

export type AccessoryPricingRow = {
  id?: string;
  group_name?: string;
  group_is_required?: boolean;
  default_item_ids?: string[];
  price_categories?: Array<{ id: string; label: string }>;
  items?: AccessoryPricingItem[];
  item_name?: string;
  supplier_price_list_code?: string;
  price?: number | null;
  currency?: string;
  dimension?: string;
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
  conditional_configuration?: AccessoryConditionalConfiguration;
  subgroups?: Array<{ id: string; subgroup_name: string; sort_order: number; is_active: boolean; row_ids: string[] }>;
};

export type AccessoryPricingItem = {
  id?: string;
  item_name?: string;
  supplier_price_list_code?: string;
  price?: number | null;
  prices?: Record<string, number | null>;
  unavailable_price_categories?: string[];
  currency?: string;
  dimension?: string;
  specification?: string;
  importantRequirements?: string[];
  is_active?: boolean;
  sort_order?: number;
  role?: "normal" | "companion" | "structural_support";
  compatible_targets?: StructuralSupportCompatibleTarget[];
};


export type ConfigurationPriceTemplate = {
  id: string;
  brand_id: string;
  template_name: string;
  currency: string;
  default_unit_price: number;
  variant_pricing?: unknown;
  category_pricing?: CategoryPricingRow[] | null;
  accessory_pricing?: AccessoryPricingRow[] | null;
};

export type ConfigurationPriceComponent = {
  id: string;
  component_name: string;
  option_type: string;
  unit_price: number;
  calculation_data?: { desking_role?: string } | null;
};

export type ConfigurationPriceLink = {
  id: string;
  linked_template_id: string;
  label: string | null;
  add_to_parent_price: boolean;
  default_qty: number;
};

type LinkedInstanceChoice = {
  instance: { id: string; label: string };
  selection: LinkedFamilyStored;
  quantity?: number;
  accessoryQuantities?: Record<string, number>;
  accessoryCategories?: Record<string, string>;
  perScreenFixedQuantities?: true;
};

type LinkedFamilyInput<Child, Link> = {
  link: Link;
  childTemplate?: Child;
  instances: readonly LinkedInstanceChoice[];
};

type ModularGroup = { id: string; group_name: string; modular_pricing_mode?: string | null; items: CategoryPricingRow[] };

type SelectionNeeds = {
  missingRequiredWorkstationSelection?: boolean;
  missingRequiredSystemSelection?: boolean;
  missingRequiredModularSelection?: boolean;
  missingRequiredAccessorySelection?: boolean;
  hasUnavailableSelectedPrice?: boolean;
};

type PriceNeed = "workstation_required" | "system_required" | "modular_required" | "accessory_required" | "unavailable_price";

/** Resolved builder selections plus the source data needed to price them. Selection state stays with the caller. */
export type ConfigurationPriceInput<Child extends ConfigurationPriceTemplate = ConfigurationPriceTemplate, Link extends ConfigurationPriceLink = ConfigurationPriceLink> = {
  template: ConfigurationPriceTemplate;
  configuration: {
    selectedVariantRow?: VariantPricingRow | null;
    selectedCategoryRow?: CategoryPricingRow | null;
    selectedFabricCategory: string;
    selectedWorkstationVariantRow?: VariantPricingRow | null;
    modularInUse: boolean;
    modularItems: ReturnType<typeof priceModularItems>;
    system?: { row?: VariantPricingRow | null; quantity?: unknown };
    usesWorkstationFlow: boolean;
    workstation?: Omit<Parameters<typeof deskingSizePricingCalculation>[0], "template" | "templateComponents" | "selectedSize"> & { selectedSize: DeskingSizePricingRow };
    accessoryConfiguration: { activeQuantities: Record<string, number>; groups: readonly { groupId: string; role?: string }[] };
    selectedAccessoryCategories: Record<string, string | undefined>;
    needs?: SelectionNeeds;
  };
  context: {
    accessoryGroups: ReturnType<typeof activeAccessoryRows>;
    components?: readonly ConfigurationPriceComponent[];
    /** Legacy prices basic linked accessories and uses the existing linked family fallbacks. */
    linkedMode?: "legacy";
    linked?: readonly LinkedFamilyInput<Child, Link>[];
  };
};

export type ConfigurationPriceBuckets = {
  originalCurrencyTotals: ReadonlyMap<string, number>;
  otherBrandTotals: Record<string, number>;
  /** The same-currency preview has its own addition order and matching rules. */
  totalPreviewUnitPrice: number;
  rowCurrency: string;
};

export type QuotePriceInput = {
  buckets: ConfigurationPriceBuckets;
  rates: Record<string, unknown>;
  announced?: { percent: number; checked: boolean } | null;
  rule: PricingRule | undefined;
  override?: number;
};

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}


function pricingDisplayName(row?: { display_name?: string; variant_name?: string } | null) {
  return row?.display_name?.trim() || row?.variant_name?.trim() || "";
}


function deskingRole(component: ConfigurationPriceComponent) {
  return component.calculation_data?.desking_role ?? "";
}


export function activeVariantRows(rows: unknown) {
  return flattenBaseModelPricingRows<VariantPricingRow>(Array.isArray(rows) ? rows : [], { activeGroupsOnly: true })
    .filter((row) => row.is_active !== false)
    .filter((row) => row.variant_name || row.display_name || row.dimension || numberValue(row.price) > 0)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

function activeModularRows(rows?: CategoryPricingRow[] | null) {
  return modularItemPricingRows(rows)
    .filter((row) => row.is_active !== false)
    .filter((row) => row.variant_name || row.display_name || row.dimension || numberValue(row.price) > 0 || Object.values(row.prices ?? {}).some((price) => numberValue(price) > 0))
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
}

export function categoryPriceColumns(rows?: CategoryPricingRow[] | null) {
  return Array.from(new Set([
    ...groupedCategoryPriceColumns(rows),
    ...activeModularRows(rows).flatMap((row) => Object.keys(row.prices ?? {})),
  ]));
}

export function activeAccessoryRows(rows?: AccessoryPricingRow[] | null): Array<AccessoryPricingRow & { id: string; group_name: string; group_is_required: boolean; is_active: boolean; sort_order: number; items: AccessoryPricingItem[]; subgroups: NonNullable<AccessoryPricingRow["subgroups"]> }> {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const groups = sourceRows
    .filter((row) => row.group_name || row.items)
    .map((group, groupIndex) => {
      const activeItems = (group.items ?? [])
        .filter((item) => item.is_active !== false)
        .filter((item) => item.item_name || item.supplier_price_list_code || item.price !== null && item.price !== undefined || item.specification)
        .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
      const subgroups = [...(group.subgroups ?? [])].filter((subgroup) => subgroup.is_active).sort((left, right) => left.sort_order - right.sort_order);
      const groupedIds = new Set(subgroups.flatMap((subgroup) => subgroup.row_ids));
      return ({
      id: group.id ?? `add-on-group-${groupIndex}`,
      group_name: group.group_name?.trim() || "Accessories",
      group_is_required: group.group_is_required === true,
      default_item_ids: (group.default_item_ids ?? []).filter((id) => activeItems.some((item) => item.id === id)),
      price_categories: group.price_categories,
      conditional_configuration: group.conditional_configuration,
      is_active: group.is_active !== false,
      sort_order: numberValue(group.sort_order, groupIndex),
      subgroups,
      items: [...subgroups.flatMap((subgroup) => subgroup.row_ids.flatMap((id) => activeItems.find((item) => item.id === id) ?? [])), ...activeItems.filter((item) => !item.id || !groupedIds.has(item.id))],
    }); })
    .filter((group) => group.is_active && group.items.length)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));
  const flatRows = sourceRows
    .filter((row) => !row.group_name && !row.items)
    .filter((row) => row.is_active !== false)
    .filter((row) => row.item_name || row.supplier_price_list_code || row.price !== null && row.price !== undefined || row.specification)
    .sort((left, right) => numberValue(left.sort_order) - numberValue(right.sort_order));

  return flatRows.length
    ? [
        ...groups,
        {
          id: "accessories",
          group_name: "Accessories",
          group_is_required: false,
          conditional_configuration: undefined,
          is_active: true,
          sort_order: groups.length,
          subgroups: [],
          items: flatRows,
        },
      ]
    : groups;
}


function deskingSizePricingCalculation({
  accessoryQuantities,
  additionalClusterQty,
  configuredDimension,
  selectedLayoutType,
  selectedSize,
  template,
  templateComponents,
}: {
  accessoryQuantities: Record<string, number>;
  additionalClusterQty: number;
  configuredDimension?: string | null;
  selectedLayoutType?: string | null;
  selectedSize: DeskingSizePricingRow;
  template: Pick<ConfigurationPriceTemplate, "currency" | "default_unit_price">;
  templateComponents: readonly ConfigurationPriceComponent[];
}) {
  const accessoryLines = templateComponents
    .filter((component) => component.option_type === "linked_addon" || deskingRole(component) === "accessory")
    .map((component) => ({
      component,
      qty: Math.max(0, Math.trunc(numberValue(accessoryQuantities[component.id], 0))),
    }))
    .filter((line) => line.qty > 0);
  const baseSeats = 2;
  const seatsPerCluster = 2;
  const modulesPerCluster = 1;
  const additionalSeats = additionalClusterQty * seatsPerCluster;
  const totalSeats = baseSeats + additionalSeats;
  const baseModules = 1;
  const additionalModules = additionalClusterQty * modulesPerCluster;
  const totalModules = baseModules + additionalModules;
  const moduleLength = numberValue(selectedSize.length, 0);
  const depth = numberValue(selectedSize.depth, 0);
  const height = numberValue(selectedSize.height, 0);
  const dimensionUnit = selectedSize.dimension_unit ?? "cm";
  const calculatedDimension =
    moduleLength && depth && height && totalModules
      ? `${moduleLength * totalModules} x ${depth} x ${height} ${dimensionUnit}`
      : "";
  const dimension = configuredDimension?.trim() || selectedSize.default_dimension?.trim() || calculatedDimension;
  const clusterName = "CL2";
  const clusterLabel =
    additionalClusterQty > 0
      ? `${clusterName} + ${additionalClusterQty} additional / Cluster of ${totalSeats}`
      : `Cluster of ${totalSeats}`;
  const basePrice = numberValue(selectedSize.default_price, numberValue(template.default_unit_price));
  const additionalPrice = numberValue(selectedSize.additional_price, basePrice);
  const accessoryPrice = accessoryLines.reduce(
    (total, line) => total + line.qty * numberValue(line.component.unit_price),
    0,
  );
  const unitPrice = basePrice + additionalPrice * additionalClusterQty + accessoryPrice;
  const selectedOptionNames = [
    selectedSize.label || `${moduleLength} x ${depth} x ${height}`,
    clusterName,
    ...accessoryLines.map((line) => `${line.component.component_name} x${line.qty}`),
  ];

  return {
    accessoryLines,
    accessoryPrice,
    additionalClusterQty,
    additionalPrice,
    additionalSupplierPriceListCode: selectedSize.additional_supplier_price_list_code ?? null,
    basePrice,
    baseSupplierPriceListCode: selectedSize.base_supplier_price_list_code ?? selectedSize.supplier_price_list_code ?? null,
    clusterLabel,
    clusterName,
    dimension,
    layoutType: selectedLayoutType || selectedSize.layout_type || "Linear",
    mainCurrency: selectedSize.currency ?? template.currency,
    formula:
      additionalClusterQty > 0
        ? `${formatMoney(selectedSize.currency ?? template.currency, basePrice)} + (${formatMoney(selectedSize.currency ?? template.currency, additionalPrice)} x ${additionalClusterQty}) = ${formatMoney(selectedSize.currency ?? template.currency, unitPrice)}`
        : `${formatMoney(selectedSize.currency ?? template.currency, basePrice)} x 1 = ${formatMoney(selectedSize.currency ?? template.currency, unitPrice)}`,
    finishNames: [] as string[],
    selectedOptionNames,
    sizeLabel: selectedSize.label ?? `${moduleLength}x${depth}x${height}`,
    totalModules,
    totalSeats,
    unitPrice: unitPrice || numberValue(template.default_unit_price),
  };
}
// The builder also needs these selected rows before it evaluates accessory applicability.
export function priceModularItems(modularGroups: readonly ModularGroup[], templateModularQuantities: Record<string, number>, selectedFabricCategory: string) {
  return modularGroups
    .flatMap((group) => group.items.map((row) => {
      const id = row.id ?? row.variant_name ?? row.display_name ?? "";
      const qty = Math.max(0, Math.trunc(numberValue(templateModularQuantities[id])));
      // Direct-priced modules carry one authoritative scalar price; matrix modules stay category-priced.
      const price = isDirectModularPricingGroup(group)
        ? numberValue(row.price)
        : numberValue(row.prices?.[selectedFabricCategory]);

      return {
        groupId: group.id,
        groupName: group.group_name,
        id,
        qty,
        role: modularRowRole(row),
        row,
        total: qty * price,
        unitPrice: price,
      };
    }))
    .filter((line) => line.qty > 0);
}

function priceLegacyLinked<Child extends ConfigurationPriceTemplate, Link extends ConfigurationPriceLink>(
  link: Link, childTemplate: Child, { instance, selection, quantity, accessoryQuantities, accessoryCategories, perScreenFixedQuantities }: LinkedInstanceChoice,
) {
  const instanceKey = `${link.id}:${instance.id}`;
  const childCategoryGroups = groupedStandardCategoryPricingRows(childTemplate.category_pricing);
  const childAllVariantRows = activeVariantRows(childTemplate.variant_pricing);
  const childVariantGroups = activeBaseModelPricingGroups<VariantPricingRow>(childTemplate.variant_pricing);
  const family = resolveLinkedProductFamily({
    variantGroups: childVariantGroups,
    categoryGroups: childCategoryGroups,
    variantRows: childAllVariantRows,
    nativeSystemActive: nativeSystemState(childVariantGroups).active,
    stored: selection,
  });
  const selectedChildCategoryGroup = family.categoryGroup;
  const childCategoryRows = family.categoryRows;
  const childVariantRows = family.variantRows;
  const childAccessoryGroups = activeAccessoryRows(childTemplate.accessory_pricing);
  const childAccessoryQuantities = accessoryQuantities ?? {};
  const childCategoryRow = family.categoryRow;
  const childVariantRow = family.variantRow;
  const childCategoryColumns = selectedChildCategoryGroup?.price_categories ?? categoryPriceColumns(childTemplate.category_pricing);
  const savedChildCategory = selection.fabricCategory;
  const childCategory = savedChildCategory && childCategoryColumns.includes(savedChildCategory)
    ? savedChildCategory
    : childCategoryColumns[0] ?? "";
  const unitPrice = childCategoryRow
    ? numberValue(childCategoryRow.prices?.[childCategory])
    : childVariantRow
      ? numberValue(childVariantRow.price)
      : numberValue(childTemplate.default_unit_price);
  const currency = childCategoryRow?.currency ?? childVariantRow?.currency ?? childTemplate.currency;
  const qty = Math.max(0, Math.trunc(numberValue(
    quantity,
    numberValue(link.default_qty),
  )));
  const fixedItemIds = perScreenFixedQuantities === true && qty !== 1
    ? linkedFixedItemIds(evaluateLinkedAccessories({
        groups: childAccessoryGroups,
        row: linkedAccessoryRow({ childCategoryRow, selectedChildCategoryGroup, childVariantRow, childVariantGroups }),
        quantities: childAccessoryQuantities,
      }).configuration.groups)
    : undefined;
  const selectedAccessories = childAccessoryGroups
    .flatMap((group) =>
      group.items.map((accessory) => {
        const id = accessory.id ?? accessory.item_name ?? "";
        const accessoryQty = Math.max(0, Math.trunc(numberValue(childAccessoryQuantities[id])));

        return {
          accessory: accessoryCategories?.[id]
            ? { ...accessory, price: accessoryItemPrice(group, accessory, accessoryCategories[id]).unitPrice }
            : accessory,
          groupName: group.group_name,
          id,
          qty: effectiveLinkedAccessoryQuantity(accessoryQty, fixedItemIds?.has(id) === true, qty),
        };
      }),
    )
    .filter((line) => line.qty > 0);
  const baseLineTotal = qty * unitPrice;
  const matchingAccessoryTotal = selectedAccessories
    .filter((line) => normalizeCurrency(line.accessory.currency ?? currency) === normalizeCurrency(currency))
    .reduce((total, line) => total + line.qty * numberValue(line.accessory.price), 0);
  const accessoryTotal = selectedAccessories.reduce(
    (total, line) => total + line.qty * numberValue(line.accessory.price),
    0,
  );
  const hasMixedAccessoryCurrencies = selectedAccessories.some(
    (line) => normalizeCurrency(line.accessory.currency ?? currency) !== normalizeCurrency(currency),
  );

  return {
    accessoryTotal,
    baseLineTotal,
    childCategory,
    childCategoryColumns,
    childCategoryGroups,
    childCategoryRow,
    childCategoryRows,
    childAccessoryGroups,
    childAllVariantRows,
    childTemplate,
    childVariantGroups,
    family,
    childVariantRow,
    childVariantRows,
    currency,
    hasMixedAccessoryCurrencies,
    instance,
    instanceKey,
    link,
    matchingAccessoryTotal,
    qty,
    selectedAccessories,
    selectedChildCategoryGroup,
    unitPrice,
  };
}

export function priceConfiguration<Child extends ConfigurationPriceTemplate, Link extends ConfigurationPriceLink>({
  template, configuration, context,
}: ConfigurationPriceInput<Child, Link>) {
  const { selectedVariantRow, selectedCategoryRow, selectedFabricCategory, selectedWorkstationVariantRow,
    modularInUse, modularItems: selectedModularItems, accessoryConfiguration, selectedAccessoryCategories,
    usesWorkstationFlow, workstation, system, needs = {} } = configuration;
  const allAccessoryGroups = context.accessoryGroups;
  const selectedSizeRow = workstation?.selectedSize;
  const additionalClusterQty = workstation?.additionalClusterQty ?? 0;
  const derivedDesking = workstation ? deskingSizePricingCalculation({
    ...workstation, template, templateComponents: context.components ?? [],
  }) : null;
  const selectedCategoryPrice = selectedCategoryRow ? numberValue(selectedCategoryRow.prices?.[selectedFabricCategory]) : 0;
  const rowCurrency = derivedDesking?.mainCurrency ??
    selectedModularItems[0]?.row.currency ??
    selectedCategoryRow?.currency ??
    selectedVariantRow?.currency ??
    template.currency;
  const selectedWorkstationVariantPrice = selectedWorkstationVariantRow
    ? numberValue(selectedWorkstationVariantRow.price)
    : 0;
  const selectedPricingAccessories = accessoryPriceLines(allAccessoryGroups, accessoryConfiguration.activeQuantities, (groupId, id) => selectedAccessoryCategories[`${template.id}:${groupId}:${id}`]);
  const matchingAccessoryTotal = selectedPricingAccessories
    .filter((line) => normalizeCurrency(line.accessory.currency ?? rowCurrency) === normalizeCurrency(rowCurrency))
    .reduce((total, line) => total + line.qty * line.unitPrice, 0);
  const hasMixedAccessoryCurrencies = selectedPricingAccessories.some(
    (line) => normalizeCurrency(line.accessory.currency ?? rowCurrency) !== normalizeCurrency(rowCurrency),
  );
  // Native System / Base: its own priced selection, added once (never through accessory totals).
  const systemQuantity = normalizeSystemQuantity(system?.quantity);
  const systemContribution = systemPriceContribution(system?.row, normalizeCurrency(rowCurrency), systemQuantity);
  const selectedSystemPrice = systemContribution.amount;
  const matchingSystemTotal = systemContribution.matching;
  const { linkedMode = "legacy" } = context;
  const selectedLinkedProducts = linkedMode === "legacy" ? (context.linked ?? []).flatMap(({ link, childTemplate, instances }) =>
    childTemplate ? instances.map((choice) => priceLegacyLinked(link, childTemplate, choice)) : [],
  ) : [];
  const matchingLinkedProductTotal = selectedLinkedProducts
    .filter((line) => line.qty > 0 && line.link.add_to_parent_price)
    .filter((line) => normalizeCurrency(line.currency) === normalizeCurrency(rowCurrency))
    .reduce((total, line) => total + line.baseLineTotal + line.matchingAccessoryTotal, 0);
  const hasMixedLinkedProductCurrencies = selectedLinkedProducts
    .filter((line) => line.qty > 0 && line.link.add_to_parent_price)
    .some((line) =>
      normalizeCurrency(line.currency) !== normalizeCurrency(rowCurrency) ||
      line.selectedAccessories.some(
        (accessoryLine) =>
          normalizeCurrency(accessoryLine.accessory.currency ?? line.currency) !== normalizeCurrency(rowCurrency),
      ),
    );
  const baseProductPrice =
    modularInUse
      ? selectedModularItems.reduce((total, line) => total + line.total, 0)
      : derivedDesking?.unitPrice ??
        (selectedCategoryRow ? selectedCategoryPrice : undefined) ??
        selectedVariantRow?.price ??
        template.default_unit_price;
  const previewUnitPrice = baseProductPrice + selectedWorkstationVariantPrice + matchingSystemTotal + matchingAccessoryTotal;
  const totalPreviewUnitPrice = previewUnitPrice + matchingLinkedProductTotal;
  const originalCurrencyTotals = new Map<string, number>();
  const addCurrencyTotal = (currency: string | undefined, amount: number) => {
    const normalizedCurrency = normalizeCurrency(currency ?? "AED");
    originalCurrencyTotals.set(
      normalizedCurrency,
      (originalCurrencyTotals.get(normalizedCurrency) ?? 0) + amount,
    );
  };

  addCurrencyTotal(rowCurrency, baseProductPrice);
  if (system?.row) addCurrencyTotal(system.row.currency ?? rowCurrency, selectedSystemPrice);
  if (selectedWorkstationVariantRow) {
    addCurrencyTotal(
      selectedWorkstationVariantRow.currency ?? rowCurrency,
      selectedWorkstationVariantPrice,
    );
  }
  for (const line of selectedPricingAccessories) {
    addCurrencyTotal(line.accessory.currency ?? rowCurrency, line.qty * line.unitPrice);
  }
  const otherBrandTotals: Record<string, number> = {};
  const addOtherBrandTotal = (currency: string | undefined, amount: number) => {
    const normalizedCurrency = normalizeCurrency(currency ?? "AED");
    otherBrandTotals[normalizedCurrency] = (otherBrandTotals[normalizedCurrency] ?? 0) + amount;
  };
  for (const line of selectedLinkedProducts) {
    if (line.qty > 0 && line.link.add_to_parent_price) {
      const otherBrand = line.childTemplate.brand_id !== template.brand_id;
      addCurrencyTotal(line.currency, line.baseLineTotal);
      if (otherBrand) addOtherBrandTotal(line.currency, line.baseLineTotal);
      for (const accessoryLine of line.selectedAccessories) {
        addCurrencyTotal(
          accessoryLine.accessory.currency ?? line.currency,
          accessoryLine.qty * numberValue(accessoryLine.accessory.price),
        );
        if (otherBrand) addOtherBrandTotal(accessoryLine.accessory.currency ?? line.currency, accessoryLine.qty * numberValue(accessoryLine.accessory.price));
      }
    }
  }

  const mainItemCurrency = normalizeCurrency(
    usesWorkstationFlow
      ? selectedSizeRow?.currency ?? rowCurrency
      : rowCurrency,
  );
  const mainItemUnitPrice = roundSourceAmount(
    usesWorkstationFlow
      ? numberValue(selectedSizeRow?.default_price)
      : baseProductPrice,
  );
  const mainItemLabel = usesWorkstationFlow
    ? selectedSizeRow?.label ?? selectedSizeRow?.id ?? template.template_name
    : modularInUse
      ? template.template_name
    : selectedCategoryRow
      ? `${pricingDisplayName(selectedCategoryRow)} / ${selectedFabricCategory}`
      : pricingDisplayName(selectedVariantRow) || template.template_name;
  const additionalClusterLine =
    usesWorkstationFlow && selectedSizeRow && additionalClusterQty > 0
      ? {
          currency: normalizeCurrency(selectedSizeRow.currency ?? rowCurrency),
          label: `Additional ${derivedDesking?.clusterName ?? "CL2"}`,
          qty: additionalClusterQty,
          total: roundSourceAmount(numberValue(selectedSizeRow.additional_price) * additionalClusterQty),
          unitPrice: roundSourceAmount(numberValue(selectedSizeRow.additional_price)),
        }
      : null;
  const workstationOptionalLine = selectedWorkstationVariantRow
    ? {
        currency: normalizeCurrency(selectedWorkstationVariantRow.currency ?? rowCurrency),
        detail: selectedWorkstationVariantRow.dimension ?? selectedWorkstationVariantRow.specification ?? null,
        label: pricingDisplayName(selectedWorkstationVariantRow) || selectedWorkstationVariantRow.variant_name || "Optional item",
        supplierCode: selectedWorkstationVariantRow.supplier_price_list_code ?? null,
        qty: 1,
        total: roundSourceAmount(selectedWorkstationVariantPrice),
        unitPrice: roundSourceAmount(selectedWorkstationVariantPrice),
      }
    : null;
  const pricingAccessorySummary = selectedPricingAccessories.map((line) => ({
    currency: normalizeCurrency(line.accessory.currency ?? rowCurrency),
    dimension: line.accessory.dimension ?? null,
    label: line.accessory.item_name || "Accessory",
    required: accessoryConfiguration.groups.some((group) => group.groupId === line.groupId && group.role === "companion"),
    supplierCode: line.accessory.supplier_price_list_code ?? null,
    qty: line.qty,
    detail: [line.selectedCategory?.label ? `Category: ${line.selectedCategory.label}` : null, line.accessory.specification ?? line.groupName].filter(Boolean).join(" / "),
    total: roundSourceAmount(line.qty * line.unitPrice),
    unitPrice: roundSourceAmount(line.unitPrice),
  }));
  const modularSummary = selectedModularItems.map((line) => ({
    currency: normalizeCurrency(line.row.currency ?? rowCurrency),
    detail: [line.groupName, line.row.supplier_price_list_code, line.row.dimension].filter(Boolean).join(" / ") || null,
    label: pricingDisplayName(line.row) || line.row.variant_name || "Modular item",
    supplierCode: line.row.supplier_price_list_code ?? null,
    qty: line.qty,
    total: roundSourceAmount(line.total),
    unitPrice: roundSourceAmount(line.unitPrice),
  }));
  const linkedProductSummary = selectedLinkedProducts
    .filter((line) => line.qty > 0)
    .map((line) => ({
      currency: normalizeCurrency(line.currency),
      detail: [
        pricingDisplayName(line.childVariantRow) ||
          (line.childCategoryRow ? `${pricingDisplayName(line.childCategoryRow)} / ${line.childCategory}` : null),
        line.childCategoryRow?.dimension ?? line.childVariantRow?.dimension ?? null,
      ]
        .filter(Boolean)
        .join(" - "),
      label: line.instance.label.trim() || line.link.label || line.childTemplate.template_name,
      supplierCode:
        line.childCategoryRow?.supplier_price_list_code ??
        line.childVariantRow?.supplier_price_list_code ??
        null,
      qty: line.qty,
      total: roundSourceAmount(line.baseLineTotal),
      unitPrice: roundSourceAmount(line.unitPrice),
    }));
  const linkedAccessorySummary = selectedLinkedProducts.flatMap((line) =>
    line.qty > 0
      ? line.selectedAccessories.map((accessoryLine) => ({
          currency: normalizeCurrency(accessoryLine.accessory.currency ?? line.currency),
          detail: line.childTemplate.template_name,
          label: accessoryLine.accessory.item_name || "Accessory",
          supplierCode: accessoryLine.accessory.supplier_price_list_code ?? null,
          qty: accessoryLine.qty,
          total: roundSourceAmount(accessoryLine.qty * numberValue(accessoryLine.accessory.price)),
          unitPrice: roundSourceAmount(numberValue(accessoryLine.accessory.price)),
        }))
      : [],
  );
  const reasons: PriceNeed[] = [];
  if (needs.missingRequiredWorkstationSelection) reasons.push("workstation_required");
  if (needs.missingRequiredSystemSelection) reasons.push("system_required");
  if (needs.missingRequiredModularSelection) reasons.push("modular_required");
  if (needs.missingRequiredAccessorySelection) reasons.push("accessory_required");
  if (needs.hasUnavailableSelectedPrice) reasons.push("unavailable_price");
  return {
    status: reasons.length ? "needs" as const : "priced" as const,
    reasons,
    buckets: { originalCurrencyTotals, otherBrandTotals, totalPreviewUnitPrice, rowCurrency },
    lines: { mainItemCurrency, mainItemUnitPrice, mainItemLabel, additionalClusterLine, workstationOptionalLine,
      pricingAccessorySummary, modularSummary, linkedProductSummary, linkedAccessorySummary, systemContribution, selectedPricingAccessories },
    linked: selectedLinkedProducts,
    derivedDesking, selectedCategoryPrice, systemQuantity, matchingAccessoryTotal, matchingLinkedProductTotal,
    hasMixedAccessoryCurrencies, hasMixedLinkedProductCurrencies,
  };
}

/** Apply quotation conversion, the announcement adjustment and any override. */
export function toQuotePrice({ buckets, rates: templateExchangeRates, announced, rule: pricingRule, override }: QuotePriceInput) {
  const { originalCurrencyTotals, otherBrandTotals, totalPreviewUnitPrice, rowCurrency } = buckets;
  const announcedBlocked = Boolean(announced) && override !== undefined;
  const announcedChange = announced?.checked && !announcedBlocked
    ? announcedTotals({ totals: Object.fromEntries(originalCurrencyTotals), excluded: otherBrandTotals, percent: announced.percent })
    : null;
  const nonAedCurrencies = Array.from(originalCurrencyTotals.keys())
    .filter((currency) => currency !== "AED" && (originalCurrencyTotals.get(currency) ?? 0) > 0);
  const missingExchangeRateCurrencyList = missingExchangeRateCurrencies(originalCurrencyTotals, templateExchangeRates);
  const missingExchangeRate = missingExchangeRateCurrencyList.length > 0;
  const convertedPreviewTotal = Array.from(originalCurrencyTotals.entries()).reduce(
    (total, [currency, amount]) =>
      currency === "AED"
        ? total + amount
        : total + amount * numberValue(templateExchangeRates[currency]),
    announcedChange ? announcedQuotationDelta(announcedChange.delta, templateExchangeRates) : 0,
  );
  const previewCurrency = nonAedCurrencies.length ? "AED" : rowCurrency;
  const previewBeforeAnnounced = nonAedCurrencies.length
    ? convertedPreviewTotal
    : totalPreviewUnitPrice + (announcedChange ? announcedQuotationDelta(announcedChange.delta, templateExchangeRates) : 0);
  // The ticked amount is rounded to 2 decimals first, so a binary fraction cannot push the round-up-to-5 one step too far.
  const rawPreviewUnitPriceWithConversion = announcedChange ? roundSourceAmount(previewBeforeAnnounced) : previewBeforeAnnounced;
  const previewUnitPriceWithConversion = ruleConvertedPrice(pricingRule, rawPreviewUnitPriceWithConversion);
  const effectiveQuoteUnitPrice = ruleExactAmount(
    pricingRule,
    override ?? previewUnitPriceWithConversion,
  );
  return { announcedBlocked, announcedChange, nonAedCurrencies, missingExchangeRateCurrencyList, missingExchangeRate,
    convertedPreviewTotal, previewCurrency, rawPreviewUnitPriceWithConversion, previewUnitPriceWithConversion, effectiveQuoteUnitPrice };
}
