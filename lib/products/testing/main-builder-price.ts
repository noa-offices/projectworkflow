// Pricing excerpts from 48c9d927e102dc7f0b8b66466005b0118d8ca4ad. Keep the excerpts verbatim. The adapter immediately around them is test-only.
import { formatMoney, normalizeCurrency } from "@/lib/currencies";
import { ruleConvertedPrice, ruleExactAmount } from "@/lib/quotation-pricing";
import { missingExchangeRateCurrencies, roundSourceAmount } from "@/lib/quotations/source-price-components";
import { activeBaseModelPricingGroups, nativeSystemState, normalizeSystemQuantity, systemPriceContribution } from "@/lib/quotations/native-system-base";
import { accessoryPriceLines } from "../accessory-rule-setup";
import { flattenBaseModelPricingRows } from "../base-model-pricing-groups";
import { groupedStandardCategoryPricingRows, standardCategoryPriceColumns as groupedCategoryPriceColumns } from "../category-pricing-groups";
import { resolveLinkedProductFamily } from "../linked-product-family";
import { isDirectModularPricingGroup, modularItemPricingRows, modularRowRole } from "../modular-pricing";
import type { AccessoryPricingItem, AccessoryPricingRow, CategoryPricingRow, ConfigurationPriceTemplate as ProductLibraryTemplate, ConfigurationPriceComponent as ProductLibraryComponent, ConfigurationPriceInput, DeskingSizePricingRow, QuotePriceInput, VariantPricingRow } from "../configuration-price";
import { announcedQuotationDelta, announcedTotals } from "../price-announcements";

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function linkedProductInstanceKey(linkId: string, instanceId: string) {
  return `${linkId}:${instanceId}`;
}

function activeVariantRows(rows: unknown) {
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

function pricingDisplayName(row?: { display_name?: string; variant_name?: string } | null) {
  return row?.display_name?.trim() || row?.variant_name?.trim() || "";
}

function categoryPriceColumns(rows?: CategoryPricingRow[] | null) {
  return Array.from(new Set([
    ...groupedCategoryPriceColumns(rows),
    ...activeModularRows(rows).flatMap((row) => Object.keys(row.prices ?? {})),
  ]));
}

function activeAccessoryRows(rows?: AccessoryPricingRow[] | null): Array<AccessoryPricingRow & { id: string; group_name: string; group_is_required: boolean; is_active: boolean; sort_order: number; items: AccessoryPricingItem[]; subgroups: NonNullable<AccessoryPricingRow["subgroups"]> }> {
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

function deskingRole(component: ProductLibraryComponent) {
  return component.calculation_data?.desking_role ?? "";
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
  template: ProductLibraryTemplate;
  templateComponents: ProductLibraryComponent[];
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

export function mainBuilderPrice(
  { template: source, configuration, context }: ConfigurationPriceInput,
  quote: Omit<QuotePriceInput, "buckets">,
  modular: { groups: { id: string; group_name: string; modular_pricing_mode?: string; items: CategoryPricingRow[] }[]; quantities: Record<string, number> },
) {
  const template = { ...source, announced_price_change: quote.announced ? { state: "active", percent: quote.announced.percent } : null };
  const { selectedVariantRow, selectedCategoryRow, selectedFabricCategory, selectedWorkstationVariantRow,
    modularInUse, usesWorkstationFlow, accessoryConfiguration, selectedAccessoryCategories, needs = {} } = configuration;
  const { missingRequiredWorkstationSelection = false, missingRequiredSystemSelection = false,
    missingRequiredModularSelection = false, missingRequiredAccessorySelection = false, hasUnavailableSelectedPrice = false } = needs;
  const { workstation, system } = configuration;
  const isDesking = Boolean(workstation);
  const selectedSizeRow = workstation?.selectedSize;
  const additionalClusterQty = workstation?.additionalClusterQty ?? 0;
  const configuredDimension = workstation?.configuredDimension;
  const selectedWorkstationLayout = workstation?.selectedLayoutType;
  const templateAccessoryQuantities = workstation?.accessoryQuantities ?? {};
  const templateComponents = [...(context.components ?? [])];
  const localDimension = null;
  const allAccessoryGroups = context.accessoryGroups;
  const nativeSystem = { selected: system?.row ? { row: system.row } : null };
  const selectedSystemQuantities = { [template.id]: system?.quantity };
  const modularGroups = modular.groups;
  const templateModularQuantities = modular.quantities;
  const templateLinkedFamilies = (context.linked ?? []).map(({ link }) => link);
  const templateById = new Map((context.linked ?? []).filter(({ childTemplate }) => childTemplate).map(({ link, childTemplate }) => [link.linked_template_id, childTemplate]));
  const linkedInstancesForLink = (link: { id: string }) => (context.linked ?? []).find((entry) => entry.link.id === link.id)?.instances.map(({ instance }) => instance) ?? [];
  const instances = (context.linked ?? []).flatMap(({ link, instances }) => instances.map((entry) => ({ ...entry, key: linkedProductInstanceKey(link.id, entry.instance.id) })));
  const selectedLinkedVariants = Object.fromEntries(instances.map(({ key, selection }) => [key, selection.variantRowId]));
  const selectedLinkedCategoryGroups = Object.fromEntries(instances.map(({ key, selection }) => [key, selection.categoryGroupId]));
  const selectedLinkedCategories = Object.fromEntries(instances.map(({ key, selection }) => [key, selection.categoryId]));
  const selectedLinkedFabricCategories = Object.fromEntries(instances.map(({ key, selection }) => [key, selection.fabricCategory]));
  const linkedProductQuantities = Object.fromEntries(instances.map(({ key, quantity }) => [key, quantity]));
  const linkedAccessoryQuantities = Object.fromEntries(instances.map(({ key, accessoryQuantities }) => [key, accessoryQuantities]));
  const pricingRule = quote.rule;
  const templatePriceOverrides = { [template.id]: quote.override };
  const announcedTicks = { [template.id]: quote.announced?.checked };
  const exchangeRates = { [template.id]: quote.rates };
  const needsUpdatedPriceDecision = false;

/* Main excerpts */
                  const selectedCategoryPrice = selectedCategoryRow
                    ? numberValue(selectedCategoryRow.prices?.[selectedFabricCategory])
                    : 0;
                  const selectedModularItems = modularGroups
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
                  const derivedDesking = isDesking && selectedSizeRow
                    ? deskingSizePricingCalculation({
                        accessoryQuantities: templateAccessoryQuantities,
                        additionalClusterQty,
                        configuredDimension,
                        selectedLayoutType: selectedWorkstationLayout,
                        selectedSize: selectedSizeRow,
                        template,
                        templateComponents,
                      })
                    : null;
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
                  const systemQuantity = normalizeSystemQuantity(selectedSystemQuantities[template.id]);
                  const systemContribution = systemPriceContribution(nativeSystem.selected?.row, normalizeCurrency(rowCurrency), systemQuantity);
                  const selectedSystemPrice = systemContribution.amount;
                  const matchingSystemTotal = systemContribution.matching;
                  const previewUnitPrice =
                    (modularInUse
                      ? selectedModularItems.reduce((total, line) => total + line.total, 0)
                      : derivedDesking?.unitPrice ??
                      (selectedCategoryRow ? selectedCategoryPrice : undefined) ??
                      selectedVariantRow?.price ??
                      template.default_unit_price) +
                    selectedWorkstationVariantPrice +
                    matchingSystemTotal +
                    matchingAccessoryTotal;
                  const selectedLinkedProducts = templateLinkedFamilies
                    .flatMap((link) => {
                      const childTemplate = templateById.get(link.linked_template_id);
                      if (!childTemplate) return [];

                      return linkedInstancesForLink(link).map((instance) => {
                        const instanceKey = linkedProductInstanceKey(link.id, instance.id);
                        const childCategoryGroups = groupedStandardCategoryPricingRows(childTemplate.category_pricing);
                        const childAllVariantRows = activeVariantRows(childTemplate.variant_pricing);
                        const childVariantGroups = activeBaseModelPricingGroups<VariantPricingRow>(childTemplate.variant_pricing);
                        const family = resolveLinkedProductFamily({
                          variantGroups: childVariantGroups,
                          categoryGroups: childCategoryGroups,
                          variantRows: childAllVariantRows,
                          nativeSystemActive: nativeSystemState(childVariantGroups).active,
                          stored: { variantRowId: selectedLinkedVariants[instanceKey], categoryGroupId: selectedLinkedCategoryGroups[instanceKey], categoryId: selectedLinkedCategories[instanceKey] },
                        });
                        const selectedChildCategoryGroup = family.categoryGroup;
                        const childCategoryRows = family.categoryRows;
                        const childVariantRows = family.variantRows;
                        const childAccessoryGroups = activeAccessoryRows(childTemplate.accessory_pricing);
                        const childAccessoryQuantities = linkedAccessoryQuantities[instanceKey] ?? {};
                        const childCategoryRow = family.categoryRow;
                        const childVariantRow = family.variantRow;
                        const childCategoryColumns = selectedChildCategoryGroup?.price_categories ?? categoryPriceColumns(childTemplate.category_pricing);
                        const savedChildCategory = selectedLinkedFabricCategories[instanceKey];
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
                          linkedProductQuantities[instanceKey],
                          numberValue(link.default_qty),
                        )));
                        const selectedAccessories = childAccessoryGroups
                          .flatMap((group) =>
                            group.items.map((accessory) => {
                              const id = accessory.id ?? accessory.item_name ?? "";
                              const accessoryQty = Math.max(0, Math.trunc(numberValue(childAccessoryQuantities[id])));

                              return {
                                accessory,
                                groupName: group.group_name,
                                id,
                                qty: accessoryQty,
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
                      });
                    })
                    .filter((line): line is NonNullable<typeof line> => Boolean(line));
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
                  const totalPreviewUnitPrice = previewUnitPrice + matchingLinkedProductTotal;
                  const baseProductPrice =
                    modularInUse
                      ? selectedModularItems.reduce((total, line) => total + line.total, 0)
                      : derivedDesking?.unitPrice ??
                        (selectedCategoryRow ? selectedCategoryPrice : undefined) ??
                        selectedVariantRow?.price ??
                        template.default_unit_price;
                  const originalCurrencyTotals = new Map<string, number>();
                  const addCurrencyTotal = (currency: string | undefined, amount: number) => {
                    const normalizedCurrency = normalizeCurrency(currency ?? "AED");
                    originalCurrencyTotals.set(
                      normalizedCurrency,
                      (originalCurrencyTotals.get(normalizedCurrency) ?? 0) + amount,
                    );
                  };

                  addCurrencyTotal(rowCurrency, baseProductPrice);
                  if (nativeSystem.selected) addCurrencyTotal(nativeSystem.selected.row.currency ?? rowCurrency, selectedSystemPrice);
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

                  // Announced price change: added to the supplier totals, before conversion, rounding and discount. A fixed quote price (override) is left alone.
                  const activeAnnouncement = template.announced_price_change?.state === "active" ? template.announced_price_change : null;
                  const announcedBlocked = Boolean(activeAnnouncement) && templatePriceOverrides[template.id] !== undefined;
                  const announcedChange = activeAnnouncement && announcedTicks[template.id] && !announcedBlocked
                    ? announcedTotals({ totals: Object.fromEntries(originalCurrencyTotals), excluded: otherBrandTotals, percent: activeAnnouncement.percent })
                    : null;

                  const templateExchangeRates = exchangeRates[template.id] ?? {};
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
                    templatePriceOverrides[template.id] ?? previewUnitPriceWithConversion,
                  );
                  const existingAddBlocked = missingExchangeRate || missingRequiredWorkstationSelection || missingRequiredSystemSelection || missingRequiredModularSelection || missingRequiredAccessorySelection || needsUpdatedPriceDecision || hasUnavailableSelectedPrice;
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
                  const mainItemDimension = usesWorkstationFlow
                    ? selectedSizeRow?.label ?? derivedDesking?.dimension ?? null
                    : modularInUse
                      ? localDimension
                    : selectedCategoryRow?.dimension ?? selectedVariantRow?.dimension ?? localDimension;
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

  // Project the main screen's add gate into the public pricing result.
  const reasons = [
    ...(missingRequiredWorkstationSelection ? ["workstation_required"] : []),
    ...(missingRequiredSystemSelection ? ["system_required"] : []),
    ...(missingRequiredModularSelection ? ["modular_required"] : []),
    ...(missingRequiredAccessorySelection ? ["accessory_required"] : []),
    ...(hasUnavailableSelectedPrice ? ["unavailable_price"] : []),
  ];
  return {
    reasons, status: existingAddBlocked && reasons.length ? "needs" : "priced",
    buckets: { originalCurrencyTotals, otherBrandTotals, totalPreviewUnitPrice, rowCurrency },
    lines: { mainItemCurrency, mainItemUnitPrice, mainItemLabel, additionalClusterLine, workstationOptionalLine,
      pricingAccessorySummary, modularSummary, linkedProductSummary, linkedAccessorySummary, systemContribution, selectedPricingAccessories },
    linked: selectedLinkedProducts,
    derivedDesking, selectedCategoryPrice, mainItemDimension, matchingLinkedProductTotal,
    hasMixedAccessoryCurrencies, hasMixedLinkedProductCurrencies,
    quote: { announcedBlocked, announcedChange, nonAedCurrencies, missingExchangeRateCurrencyList,
      missingExchangeRate, convertedPreviewTotal, previewCurrency, rawPreviewUnitPriceWithConversion, previewUnitPriceWithConversion, effectiveQuoteUnitPrice },
    addBlocked: existingAddBlocked,
  };
}
