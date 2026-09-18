"use client";

import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import {
  groupedStandardCategoryPricingRows,
  normalizeCategoryPriceLabel,
  standardCategoryPriceColumns,
} from "@/lib/products/category-pricing-groups";
import {
  explicitCategoryPriceValue,
  explicitPricingCategoryLabels,
  manualDefaultPriceCategories,
} from "@/lib/products/pricing-category-columns";
import {
  MODULAR_GROUP_PRICING_TYPE,
  MODULAR_ITEM_PRICING_TYPE,
  isDirectModularPricingGroup,
  modularItemPricingGroups,
  modularPricingDefaultsFromRows,
} from "@/lib/products/modular-pricing";
import { resolveDefaultPricingCurrency } from "@/components/products/pricing-default-currency";
import { PricingGroupShell } from "@/components/products/pricing-group-shell";
import { PricingRowReferenceImage } from "@/components/products/pricing-row-reference-image";
import { PricingSubgroupReferenceImage } from "@/components/products/pricing-subgroup-reference-image";
import { FinishCategoryGroupJsonImport } from "@/components/products/finish-category-group-json-import";
import {
  FinishCategoryGroupReferenceImages,
  PricingGroupReferenceImages,
} from "@/components/products/finish-category-group-reference-images";
import { replaceFinishCategoryGroup } from "@/lib/products/finish-category-group-json-import";
import {
  finishCategoryReferenceAvailability,
  baseModelPricingGroupReferenceAvailability,
  persistedBaseModelPricingGroupIds,
  persistedPricingGroupIds,
  persistedFinishCategoryGroupIds,
  pricingGroupReferenceAvailability,
} from "@/lib/products/finish-category-reference-ui";
import { hasExplicitPricingNumber, parseNullablePricingNumber } from "@/lib/products/nullable-pricing";
import { hasMeaningfulBaseModelPricing } from "@/lib/products/base-model-pricing-state";
import {
  baseModelPricingGroups,
  flattenBaseModelPricingRows,
  serializeBaseModelPricingGroups,
  LEGACY_BASE_MODEL_GROUP_ID,
  type BaseModelPricingGroup,
  type BaseModelPricingSubgroup,
} from "@/lib/products/base-model-pricing-groups";
import { assignBaseModelRowToSubgroup, baseModelPricingSubgroupForRow, createBaseModelPricingSubgroup, removeBaseModelPricingSubgroup, updateBaseModelPricingSubgroup } from "@/lib/products/base-model-pricing-subgroups";
import {
  addBaseModelPricingRow,
  createBaseModelPricingGroup,
  removeBaseModelPricingGroup,
  removeBaseModelPricingRow,
  replaceWholeTemplateBaseModelPricing,
  shouldApplyBaseModelReplacement,
  updateBaseModelPricingGroup,
  updateBaseModelPricingRow,
} from "@/lib/products/base-model-pricing-ui-state";
import { hasMeaningfulCategoryPricing } from "@/lib/products/category-pricing-state";
import { hasMeaningfulModularPricing } from "@/lib/products/modular-pricing-state";
import { hasMeaningfulAccessoryPricing } from "@/lib/products/accessory-pricing-state";
import { reviewImportantRequirements } from "@/lib/products/smart-product-review";
import {
  accessoryApplicabilityTargetKey,
  parseAccessoryConfigurationGroups,
  resolveAccessoryApplicabilityTarget,
  serializeAccessoryConfigurationGroups,
  type AccessoryConditionalConfiguration,
  type AccessoryConfigurationGroup,
  type AccessoryConfigurationRole,
  type AccessorySelectionMode,
} from "@/lib/products/accessory-conditional-configuration";
import {
  removeAccessoryApplicabilityRule,
  setAccessoryConditionalEnabled,
  setAccessoryApplicabilityTargets,
  setAccessoryConfigurationRole,
  setAccessoryRuleAllowedItems,
  setAccessorySelectionMode,
  staleAccessoryRuleItemIds,
  updateAccessoryApplicabilityRule,
} from "@/lib/products/accessory-conditional-configuration-ui-state";
import { applicabilityTargetChoiceLabel, applicabilityTargetChoices } from "@/lib/products/applicability-target-choices";
import type { WorkstationPricingGroup, WorkstationPricingRow } from "@/lib/products/workstation-pricing-groups";
import {
  TEMPLATE_IMPORT_APPLY_EVENT,
  TEMPLATE_IMPORT_RESET_EVENT,
  TEMPLATE_IMPORT_STATUS_EVENT,
  type QuotationRowImportDraft,
} from "@/components/products/template-import-controls";

export type VariantPricingRow = {
  id?: string;
  variant_name?: string;
  display_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  price?: number | null;
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
  /** Optional cross-group exclusivity marker: only one Direct Modular group sharing this value may hold a selection. */
  modular_selection_family?: string | null;
  is_active?: boolean;
  sort_order?: number;
  subgroups?: BaseModelPricingSubgroup[];
};

export type AccessoryPricingRow = {
  id?: string;
  group_name?: string;
  group_is_required?: boolean;
  price_categories?: Array<{ id: string; label: string }>;
  items?: AccessoryPricingItem[];
  item_name?: string;
  supplier_price_list_code?: string;
  price?: number | null;
  currency?: string;
  dimension?: string;
  specification?: string;
  importantRequirements?: string[];
  is_active?: boolean;
  sort_order?: number;
  conditional_configuration?: AccessoryConditionalConfiguration;
  subgroups?: BaseModelPricingSubgroup[];
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
};

const defaultPriceCategories = manualDefaultPriceCategories;

function idFor(prefix: string, sortOrder: number) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${sortOrder}`;
}

function normalizedPriceMap(prices?: Record<string, unknown> | null, includeDefaultPriceCategories = true) {
  const normalized = new Map<string, number | null>();

  if (includeDefaultPriceCategories) {
    defaultPriceCategories.forEach((category) => {
      normalized.set(category, null);
    });
  }

  Object.entries(prices ?? {}).forEach(([key, value]) => {
    const label = normalizeCategoryPriceLabel(key);
    if (!label) {
      return;
    }

    normalized.set(label, parseNullablePricingNumber(value));
  });

  return Object.fromEntries(normalized.entries());
}

function resolveDefaultModularPricingCurrency({
  brandDefaultCurrency,
  existingRows: _existingRows = [],
  savedTemplateCurrency,
  trigger,
}: {
  brandDefaultCurrency?: string | null;
  existingRows?: Array<{ currency?: string | null }>;
  savedTemplateCurrency?: string | null;
  trigger?: HTMLElement | null;
}) {
  void _existingRows;
  return resolveDefaultPricingCurrency({
    brandDefaultCurrency,
    savedTemplateCurrency,
    trigger,
  });
}

function normalizeVariant(row: VariantPricingRow, index: number): VariantPricingRow {
  return {
    id: row.id || `variant-${index}`,
    variant_name: row.variant_name?.trim() ?? "",
    display_name: row.display_name?.trim() ?? "",
    supplier_price_list_code: row.supplier_price_list_code?.trim() ?? "",
    dimension: row.dimension?.trim() ?? "",
    price: parseNullablePricingNumber(row.price),
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    specification: row.specification?.trim() ?? "",
    ...(row.importantRequirements?.length ? { importantRequirements: reviewImportantRequirements(row.importantRequirements.join("\n")) } : {}),
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function normalizeCategory(row: CategoryPricingRow, index: number, priceCategories?: string[]): CategoryPricingRow {
  // Same Modular role enum as Direct Modular rows; supports Matrix Modular composition
  // (for example a starter Bench row alongside intermediate Bench Extension rows that also
  // carry finish/category-dependent prices). Harmless for ordinary Category/Matrix rows.
  const role = row.modular_role === "starter" || row.modular_role === "intermediate" || row.modular_role === "terminal" ? row.modular_role : undefined;
  return {
    id: row.id || `category-${index}`,
    pricing_type: typeof row.pricing_type === "string" && row.pricing_type.trim()
      ? row.pricing_type.trim()
      : null,
    pricing_category_id:
      typeof row.pricing_category_id === "string" && row.pricing_category_id.trim()
        ? row.pricing_category_id.trim()
        : null,
    pricing_category_name:
      typeof row.pricing_category_name === "string" && row.pricing_category_name.trim()
        ? row.pricing_category_name.trim()
        : null,
    variant_name: row.variant_name?.trim() ?? "",
    display_name: row.display_name?.trim() ?? "",
    supplier_price_list_code: row.supplier_price_list_code?.trim() ?? "",
    dimension: row.dimension?.trim() ?? "",
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    prices: priceCategories
      ? Object.fromEntries(priceCategories.map((category) => [category, parseNullablePricingNumber(explicitCategoryPriceValue(row.prices, category))]))
      : normalizedPriceMap(row.prices),
    unavailable_categories: Array.from(new Set((row.unavailable_categories ?? []).filter((category) => !priceCategories || priceCategories.includes(category)))),
    specification: row.specification?.trim() ?? "",
    ...(row.importantRequirements?.length ? { importantRequirements: reviewImportantRequirements(row.importantRequirements.join("\n")) } : {}),
    modular_default_dimension:
      typeof row.modular_default_dimension === "string" && row.modular_default_dimension.trim()
        ? row.modular_default_dimension.trim()
        : null,
    modular_default_specification:
      typeof row.modular_default_specification === "string" && row.modular_default_specification.trim()
        ? row.modular_default_specification.trim()
        : null,
    ...(role ? { modular_role: role } : {}),
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function normalizeDirectModularRow(row: CategoryPricingRow, index: number): CategoryPricingRow {
  return {
    ...row,
    id: row.id || `modular-${index}`,
    pricing_type: MODULAR_ITEM_PRICING_TYPE,
    variant_name: row.variant_name?.trim() ?? "",
    display_name: row.display_name?.trim() ?? "",
    supplier_price_list_code: row.supplier_price_list_code?.trim() ?? "",
    dimension: row.dimension?.trim() ?? "",
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    price: parseNullablePricingNumber(row.price),
    modular_role: row.modular_role === "starter" || row.modular_role === "intermediate" || row.modular_role === "terminal" ? row.modular_role : undefined,
    specification: row.specification?.trim() ?? "",
    ...(row.importantRequirements?.length ? { importantRequirements: reviewImportantRequirements(row.importantRequirements.join("\n")) } : {}),
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function normalizeAccessoryItem(row: AccessoryPricingItem, index: number): AccessoryPricingItem {
  return {
    id: row.id || `add-on-${index}`,
    item_name: row.item_name?.trim() ?? "",
    supplier_price_list_code: row.supplier_price_list_code?.trim() ?? "",
    price: parseNullablePricingNumber(row.price),
    ...(row.prices ? { prices: Object.fromEntries(Object.entries(row.prices).map(([key, value]) => [key, parseNullablePricingNumber(value)])) } : {}),
    ...(row.unavailable_price_categories?.length ? { unavailable_price_categories: Array.from(new Set(row.unavailable_price_categories)) } : {}),
    currency: normalizeCurrency(row.currency ?? defaultCurrency),
    dimension: row.dimension?.trim() ?? "",
    specification: row.specification?.trim() ?? "",
    ...(row.importantRequirements?.length ? { importantRequirements: reviewImportantRequirements(row.importantRequirements.join("\n")) } : {}),
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
  };
}

function normalizeAccessoryGroup(row: AccessoryPricingRow, index: number): AccessoryPricingRow {
  const flatItem = row.item_name || row.supplier_price_list_code || row.price || row.dimension || row.specification
    ? [normalizeAccessoryItem(row, 0)]
    : [];

  return {
    id: row.id || `add-on-group-${index}`,
    group_name: row.group_name?.trim() || "Accessories",
    group_is_required: row.group_is_required === true,
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    ...(row.price_categories?.length ? { price_categories: row.price_categories.map((category) => ({ ...category })) } : {}),
    items: (row.items?.length ? row.items : flatItem).map(normalizeAccessoryItem),
    ...(row.conditional_configuration ? { conditional_configuration: row.conditional_configuration } : {}),
    ...(row.subgroups ? { subgroups: row.subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] })) } : {}),
  };
}

function normalizeAccessoryGroups(rows?: AccessoryPricingRow[] | null) {
  const sourceRows = parseAccessoryConfigurationGroups(Array.isArray(rows) ? rows : []).groups as AccessoryPricingRow[];
  const groupedRows = sourceRows.filter((row) => row.group_name || row.items);
  const flatRows = sourceRows.filter((row) => !row.group_name && !row.items);
  const normalizedGroups = groupedRows.map(normalizeAccessoryGroup);

  if (flatRows.length) {
    normalizedGroups.push({
      id: "accessories",
      group_name: "Accessories",
      is_active: true,
      sort_order: normalizedGroups.length,
      items: flatRows.map(normalizeAccessoryItem),
    });
  }

  return normalizedGroups.length ? normalizedGroups : [];
}


function CurrencySelect({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value?: string;
}) {
  return (
    <select
      value={normalizeCurrency(value ?? defaultCurrency)}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-24 border border-zinc-200 bg-white px-2 outline-none focus:border-emerald-800"
    >
      {supportedCurrencies.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.code}
        </option>
      ))}
    </select>
  );
}

function AutoGrowTextarea({
  minHeightClass = "min-h-[56px]",
  onChange,
  placeholder,
  rows = 2,
  value,
  widthClass = "min-w-[320px]",
}: {
  minHeightClass?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  value: string;
  widthClass?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`${minHeightClass} ${widthClass} resize-y overflow-hidden rounded-sm border border-zinc-200 px-3 py-2 leading-5 outline-none focus:border-emerald-800`}
    />
  );
}

function ImportantRequirementsTextarea({ onChange, value }: { onChange: (value: string[]) => void; value?: string[] }) {
  return <label className="mt-2 block"><span className="text-[10px] font-bold uppercase text-zinc-500">Important Requirements</span><AutoGrowTextarea value={(value ?? []).join("\n")} onChange={(next) => onChange(reviewImportantRequirements(next))} placeholder="One requirement per line" rows={2} minHeightClass="min-h-[56px]" widthClass="min-w-[360px]" /></label>;
}

/** Keeps a viewport-fixed scrollbar synchronized with the real table scroller. */
function SyncedHorizontalScrollContainer({ children }: { children: ReactNode }) {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [proxyPosition, setProxyPosition] = useState<{ left: number; width: number } | null>(null);
  const measure = useCallback(() => {
    const primary = primaryRef.current;
    const group = groupRef.current;
    if (!primary || !group) return;
    const hasOverflow = primary.scrollWidth > primary.clientWidth + 1;
    const rect = group.getBoundingClientRect();
    const viewportVisible = rect.bottom > 0 && rect.top < window.innerHeight;
    const left = Math.max(8, rect.left);
    const width = Math.max(0, Math.min(rect.width, window.innerWidth - left - 8));
    setOverflow(hasOverflow);
    setScrollWidth(primary.scrollWidth);
    setProxyPosition(hasOverflow && viewportVisible && width > 0 ? { left, width } : null);
  }, []);
  useEffect(() => {
    const primary = primaryRef.current;
    if (!primary) return;
    const observer = new ResizeObserver(measure);
    observer.observe(primary);
    Array.from(primary.children).forEach((child) => observer.observe(child));
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, children]);
  const syncPrimary = () => { if (stickyRef.current && primaryRef.current) stickyRef.current.scrollLeft = primaryRef.current.scrollLeft; };
  const syncSticky = () => { if (stickyRef.current && primaryRef.current) primaryRef.current.scrollLeft = stickyRef.current.scrollLeft; };
  return <div ref={groupRef}><div ref={primaryRef} onScroll={syncPrimary} className="overflow-x-auto">{children}</div>{overflow && proxyPosition ? <div ref={stickyRef} onScroll={syncSticky} aria-label="Floating horizontal table scrollbar" className="fixed bottom-20 z-50 overflow-x-auto rounded border border-zinc-200 bg-white/95 shadow-sm" style={proxyPosition}><div style={{ width: scrollWidth, height: 1 }} /></div> : null}</div>;
}

function categoryPricingRowWithColumns(
  row: CategoryPricingRow,
  priceCategories: string[],
): CategoryPricingRow {
  return {
    ...row,
    prices: Object.fromEntries(
      priceCategories.map((category) => [category, parseNullablePricingNumber(explicitCategoryPriceValue(row.prices, category))]),
    ),
    unavailable_categories: (row.unavailable_categories ?? []).filter((category) => priceCategories.includes(category)),
  };
}

function newCategoryPricingRow(
  sortOrder: number,
  priceCategories: string[],
  currency: string,
): CategoryPricingRow {
  return {
    id: idFor("category", sortOrder),
    currency: normalizeCurrency(currency),
    prices: Object.fromEntries(priceCategories.map((category) => [category, null])),
    is_active: true,
    sort_order: sortOrder,
  };
}

function rowHasMeaningfulValues(row: CategoryPricingRow) {
  if (
    row.variant_name?.trim() ||
    row.display_name?.trim() ||
    row.supplier_price_list_code?.trim() ||
    row.dimension?.trim() ||
    row.dimension?.trim() ||
    row.specification?.trim()
  ) {
    return true;
  }

  return Object.values(row.prices ?? {}).some((value) => hasExplicitPricingNumber(value));
}

function normalizeCategoryGroup(
  row: CategoryPricingRow,
  index: number,
  includeDefaultPriceCategories = true,
): CategoryPricingRow {
  const explicitCategories = explicitPricingCategoryLabels(row.price_categories);
  const priceCategories = Array.from(new Set([
    ...(explicitCategories.length ? explicitCategories : includeDefaultPriceCategories ? defaultPriceCategories : []),
    ...(explicitCategories.length ? [] : (row.price_categories ?? []).map(normalizeCategoryPriceLabel).filter(Boolean)),
    ...(explicitCategories.length ? [] : (row.items ?? []).flatMap((item) => Object.keys(item.prices ?? {}).map(normalizeCategoryPriceLabel).filter(Boolean))),
  ]));
  const items = Array.isArray(row.items)
    ? row.items.map((item, itemIndex) => normalizeCategory(item, itemIndex, priceCategories))
    : [];

  return {
    id: row.id || `category-group-${index}`,
    group_name: row.group_name?.trim() || "Finish Category Pricing",
    price_categories: priceCategories,
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    items,
    ...(row.subgroups ? { subgroups: row.subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] })) } : {}),
  };
}

function normalizeModularGroups(rows?: CategoryPricingRow[] | null, includeDefaultPriceCategories = true) {
  return modularItemPricingGroups(rows).map((group, groupIndex) => {
    const sourceGroup = group as CategoryPricingRow;
    const direct = isDirectModularPricingGroup(sourceGroup);
    const explicitCategories = explicitPricingCategoryLabels(sourceGroup.price_categories);
    const priceCategories = Array.from(new Set([
      ...(direct ? [] : explicitCategories.length ? explicitCategories : includeDefaultPriceCategories ? defaultPriceCategories : []),
      ...(explicitCategories.length ? [] : (sourceGroup.price_categories ?? []).map(normalizeCategoryPriceLabel).filter(Boolean)),
      ...(explicitCategories.length ? [] : (sourceGroup.items ?? []).flatMap((item) => Object.keys(item.prices ?? {}).map(normalizeCategoryPriceLabel).filter(Boolean))),
    ]));

    return {
      ...sourceGroup,
      id: sourceGroup.id || `modular-group-${groupIndex}`,
      group_name: sourceGroup.group_name?.trim() || "Modular Items",
      is_active: sourceGroup.is_active !== false,
      pricing_type: MODULAR_GROUP_PRICING_TYPE,
      price_categories: direct ? [] : priceCategories,
      ...(direct ? { modular_pricing_mode: "direct" } : {}),
      ...(direct && sourceGroup.modular_composition ? { modular_composition: sourceGroup.modular_composition } : {}),
      sort_order: Number.isFinite(Number(sourceGroup.sort_order)) ? Number(sourceGroup.sort_order) : groupIndex,
      items: (sourceGroup.items ?? []).map((item, itemIndex) =>
        direct ? normalizeDirectModularRow(item, itemIndex) : normalizeCategory({
          ...item,
          pricing_type: MODULAR_ITEM_PRICING_TYPE,
        }, itemIndex, priceCategories)),
    };
  });
}

function modularPriceCategories(groups: CategoryPricingRow[], includeDefaultPriceCategories = true) {
  const matrixGroups = groups.filter((group) => !isDirectModularPricingGroup(group));
  const declared = matrixGroups.flatMap((group) => explicitPricingCategoryLabels(group.price_categories));
  return Array.from(new Set([
    ...(declared.length || !matrixGroups.length ? [] : includeDefaultPriceCategories ? defaultPriceCategories : []),
    ...matrixGroups.flatMap((group) => [
      ...explicitPricingCategoryLabels(group.price_categories),
      ...(explicitPricingCategoryLabels(group.price_categories).length ? [] : (group.price_categories ?? []).map(normalizeCategoryPriceLabel).filter(Boolean)),
      ...(explicitPricingCategoryLabels(group.price_categories).length ? [] : (group.items ?? []).flatMap((row) =>
        Object.keys(row.prices ?? {}).map(normalizeCategoryPriceLabel).filter(Boolean),
      )),
    ]),
  ]));
}

function accessoryItemHasMeaningfulValues(row: AccessoryPricingItem) {
  return Boolean(
    row.item_name?.trim() ||
    row.supplier_price_list_code?.trim() ||
    row.specification?.trim() ||
    hasExplicitPricingNumber(row.price),
  );
}

export function VariantPricingTable({
  brandDefaultCurrency,
  onGroupsChange,
  onHasDataChange,
  replacementGroups,
  replacementFlatSubgroups,
  replacementRows,
  replacementVersion,
  rows,
  templateIsPersisted,
  templateId,
  templateCurrency,
}: {
  brandDefaultCurrency?: string | null;
  onGroupsChange?: (groups: BaseModelPricingGroup<VariantPricingRow>[]) => void;
  onHasDataChange?: (hasBaseModelData: boolean) => void;
  replacementGroups?: BaseModelPricingGroup<VariantPricingRow>[] | null;
  replacementFlatSubgroups?: BaseModelPricingSubgroup[] | null;
  replacementRows?: VariantPricingRow[] | null;
  replacementVersion?: number;
  rows?: unknown;
  templateIsPersisted: boolean;
  templateId: string;
  templateCurrency?: string | null;
}) {
  const initialGroups = useMemo(() => baseModelPricingGroups<VariantPricingRow>(Array.isArray(rows) ? rows : []).map((group) => ({
    id: group.id,
    pricing_type: group.pricing_type,
    group_name: group.group_name,
    is_active: group.is_active,
    sort_order: group.sort_order,
    items: group.items.map(normalizeVariant),
    ...(group.subgroups?.length ? { subgroups: group.subgroups } : {}),
  })) as BaseModelPricingGroup<VariantPricingRow>[], [rows]);
  const importedIdsRef = useRef<Set<string>>(new Set());
  const [groups, setGroups] = useState<BaseModelPricingGroup<VariantPricingRow>[]>(() => initialGroups);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(initialGroups.map((group) => [group.id, true])));
  const [collapsedSubgroups, setCollapsedSubgroups] = useState<Record<string, boolean>>({});
  const [expandedRowByGroup, setExpandedRowByGroup] = useState<Record<string, string | null>>({});
  const [groupActionNotices, setGroupActionNotices] = useState<Record<string, string>>({});
  const [referenceTargetGroupId, setReferenceTargetGroupId] = useState<string | null>(null);
  const persistedGroupIds = useMemo(() => persistedBaseModelPricingGroupIds(rows), [rows]);
  const appliedReplacementVersion = useRef<number | undefined>(undefined);
  const userEditedCurrencyRowIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: flattenBaseModelPricingRows<VariantPricingRow>(initialGroups),
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const serialized = useMemo(() => JSON.stringify(serializeBaseModelPricingGroups(groups.map((group) => ({
    ...group,
    items: group.items.map(normalizeVariant),
  })))), [groups]);

  useEffect(() => {
    if (!shouldApplyBaseModelReplacement(replacementVersion, appliedReplacementVersion.current)) return;
    appliedReplacementVersion.current = replacementVersion;
    setGroups((current) => {
      const convertedGroups = (replacementGroups ?? []).map((group) => ({ ...group, items: group.items.map(normalizeVariant) }));
      const rows = (replacementRows ?? []).map(normalizeVariant);
      const next = replaceWholeTemplateBaseModelPricing(current, rows, convertedGroups, LEGACY_BASE_MODEL_GROUP_ID);
      const flatRowIds = new Set(rows.flatMap((row) => row.id ? [row.id] : []));
      return next.map((group) => replacementFlatSubgroups?.length && group.items.some((row) => row.id && flatRowIds.has(row.id)) ? { ...group, subgroups: replacementFlatSubgroups } : group);
    });
    setCollapsedGroups((current) => ({ ...current, ...(replacementGroups ?? []).reduce<Record<string, boolean>>((next, group) => ({ ...next, [group.id]: true }), {}) }));
  }, [replacementFlatSubgroups, replacementGroups, replacementRows, replacementVersion]);

  useEffect(() => {
    onHasDataChange?.(hasMeaningfulBaseModelPricing(flattenBaseModelPricingRows(groups)));
    onGroupsChange?.(groups);
  }, [groups, onGroupsChange, onHasDataChange]);

  useEffect(() => {
    const handleApply = (event: Event) => {
      const detail = (event as CustomEvent<{
        action: string;
        draft: QuotationRowImportDraft;
        templateId: string;
      }>).detail;

      if (!detail || detail.templateId !== templateId || detail.action !== "variant") {
        return;
      }

      const row = normalizeVariant({
        id: idFor("variant", flattenBaseModelPricingRows(groups).length),
        variant_name: detail.draft.model_snapshot || detail.draft.item_name_snapshot || "Imported row",
        display_name: detail.draft.item_name_snapshot || detail.draft.model_snapshot || "Imported row",
        dimension: detail.draft.size_snapshot || "",
        price: Number(detail.draft.unit_price) || 0,
        currency: normalizeCurrency(detail.draft.currency ?? templateCurrency ?? brandDefaultCurrency ?? defaultCurrency),
        specification: detail.draft.specification_snapshot || "",
        is_active: true,
        sort_order: flattenBaseModelPricingRows(groups).length,
      }, flattenBaseModelPricingRows(groups).length);

      importedIdsRef.current.add(row.id ?? "");
      setGroups((current) => {
        if (current.length) return addBaseModelPricingRow(current, current[0].id, row);
        const group = createBaseModelPricingGroup<VariantPricingRow>(idFor("base-model-group", 0), 0);
        return [{ ...group, items: [row] }];
      });
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "variant",
          status: "Base/model row added.",
          templateId,
        },
      }));
    };

    const handleReset = (event: Event) => {
      const detail = (event as CustomEvent<{ templateId: string }>).detail;
      if (!detail || detail.templateId !== templateId) {
        return;
      }

      if (importedIdsRef.current.size) {
        setGroups((current) => current.map((group) => ({
          ...group,
          items: group.items.filter((row) => !importedIdsRef.current.has(row.id ?? "")),
        })));
      }
      importedIdsRef.current = new Set();
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "variant",
          status: "",
          templateId,
        },
      }));
    };

    window.addEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
    window.addEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    return () => {
      window.removeEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
      window.removeEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    };
  }, [brandDefaultCurrency, groups, templateCurrency, templateId]);

  useEffect(() => {
    const nextDefaultCurrency = resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: flattenBaseModelPricingRows(groups),
      savedTemplateCurrency: templateCurrency,
    });

    setGroups((current) => {
      let didChange = false;
      const nextGroups = current.map((group) => ({ ...group, items: group.items.map((row, index) => {
        const key = `${group.id}:${row.id ?? `variant-${index}`}`;
        if (userEditedCurrencyRowIds.current.has(key) || hasMeaningfulBaseModelPricing([row])) {
          return row;
        }

        const currentCurrency = row.currency?.trim() ? normalizeCurrency(row.currency) : null;
        const previousDefaultCurrency = previousDefaultCurrencyRef.current;
        if (
          currentCurrency &&
          currentCurrency !== previousDefaultCurrency &&
          currentCurrency !== defaultCurrency
        ) {
          return row;
        }

        if (currentCurrency === nextDefaultCurrency) {
          return row;
        }

        didChange = true;
        return {
          ...row,
          currency: nextDefaultCurrency,
        };
      }) }));

      return didChange ? nextGroups : current;
    });

    previousDefaultCurrencyRef.current = nextDefaultCurrency;
  }, [brandDefaultCurrency, groups, templateCurrency]);

  function update(groupId: string, index: number, patch: Partial<VariantPricingRow>) {
    if (typeof patch.currency === "string") {
      const group = groups.find((entry) => entry.id === groupId);
      userEditedCurrencyRowIds.current.add(`${groupId}:${group?.items[index]?.id ?? `variant-${index}`}`);
    }

    setGroups((current) => updateBaseModelPricingRow(current, groupId, index, patch));
  }

  function openReferenceImages(groupId: string) {
    const availability = baseModelPricingGroupReferenceAvailability({
      templateIsPersisted,
      persistedGroupIds,
      groupId,
    });
    if (!availability.available) {
      setGroupActionNotices((current) => ({ ...current, [groupId]: availability.message ?? "Reference images are unavailable." }));
      return;
    }
    setGroupActionNotices((current) => ({ ...current, [groupId]: "" }));
    setReferenceTargetGroupId(groupId);
  }

  const referenceTargetGroup = groups.find((group) => group.id === referenceTargetGroupId) ?? null;

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="variant_pricing" value={serialized} />
      <div className="space-y-4">
      {groups.map((group) => (
      <section key={group.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <header className="border-b border-zinc-200 bg-zinc-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-expanded={!collapsedGroups[group.id]} aria-label={collapsedGroups[group.id] ? "Expand pricing group" : "Collapse pricing group"} onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !current[group.id] }))} className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-700">
              {collapsedGroups[group.id] ? ">" : "v"}
            </button>
            <input aria-label="Base / Model group title" value={group.group_name} onChange={(event) => setGroups((current) => updateBaseModelPricingGroup(current, group.id, { group_name: event.target.value }))} className="h-8 min-w-64 flex-1 border border-zinc-200 bg-white px-2 text-sm font-semibold outline-none focus:border-emerald-800" />
            <p className="text-xs text-zinc-500">{group.items.length} models · {group.is_active ? "Active" : "Inactive"}</p>
            <button type="button" onClick={() => openReferenceImages(group.id)} className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-600 hover:text-emerald-900">Reference images</button>
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-600"><input type="checkbox" checked={group.is_active} onChange={(event) => setGroups((current) => updateBaseModelPricingGroup(current, group.id, { is_active: event.target.checked }))} />Active</label>
            <button type="button" onClick={() => setGroups((current) => removeBaseModelPricingGroup(current, group.id))} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Remove group</button>
          </div>
          {!collapsedGroups[group.id] ? <button type="button" onClick={(event) => {
            const nextSortOrder = Math.max(-1, ...group.items.map((row) => Number(row.sort_order) || 0)) + 1;
            setGroups((current) => addBaseModelPricingRow(current, group.id, { id: idFor("variant", nextSortOrder), currency: resolveDefaultPricingCurrency({ brandDefaultCurrency, existingRows: flattenBaseModelPricingRows(current), savedTemplateCurrency: templateCurrency, trigger: event.currentTarget }), is_active: true, sort_order: nextSortOrder }));
          }} className="mt-3 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-600 hover:text-emerald-900">+ Add row</button> : null}
          {!collapsedGroups[group.id] ? <button type="button" onClick={() => setGroups((current) => current.map((entry) => entry.id === group.id ? { ...entry, subgroups: [...(entry.subgroups ?? []), createBaseModelPricingSubgroup(idFor("base-model-subgroup", entry.subgroups?.length ?? 0), "New Subgroup", entry.subgroups?.length ?? 0)] } : entry))} className="ml-2 mt-3 rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-900">+ Add Subgroup</button> : null}
          {groupActionNotices[group.id] ? <p className="mt-2 text-xs font-medium text-amber-800">{groupActionNotices[group.id]}</p> : null}
          {!collapsedGroups[group.id] && group.subgroups?.length ? <div className="mt-3 space-y-2">{[...group.subgroups].sort((a, b) => a.sort_order - b.sort_order).map((subgroup) => <div key={subgroup.id} className="rounded-md border border-zinc-200 bg-white p-2"><div className="flex flex-wrap items-start gap-2"><button type="button" onClick={() => setCollapsedSubgroups((current) => ({ ...current, [subgroup.id]: !current[subgroup.id] }))} className="h-8 w-8 rounded border border-zinc-200 text-xs">{collapsedSubgroups[subgroup.id] ? ">" : "v"}</button><PricingSubgroupReferenceImage templateId={templateId} templateIsPersisted={templateIsPersisted} groupId={group.id} subgroupId={subgroup.id} /><div className="min-w-52 flex-1"><input value={subgroup.subgroup_name} onChange={(event) => setGroups((current) => current.map((entry) => entry.id === group.id ? updateBaseModelPricingSubgroup(entry, subgroup.id, { subgroup_name: event.target.value }) : entry))} className="h-8 w-full border border-zinc-200 px-2 text-sm font-semibold outline-none focus:border-emerald-800" /><p className="mt-1 text-xs text-zinc-500">{subgroup.row_ids.length} models</p></div><label className="flex items-center gap-1 text-xs text-zinc-600"><input type="checkbox" checked={subgroup.is_active} onChange={(event) => setGroups((current) => current.map((entry) => entry.id === group.id ? updateBaseModelPricingSubgroup(entry, subgroup.id, { is_active: event.target.checked }) : entry))} />Active</label><button type="button" onClick={() => setGroups((current) => current.map((entry) => entry.id === group.id ? removeBaseModelPricingSubgroup(entry, subgroup.id) : entry))} className="text-xs font-semibold text-red-700">Remove subgroup</button></div>{!collapsedSubgroups[subgroup.id] ? <p className="mt-2 border-t border-zinc-100 pt-2 text-xs text-zinc-500">Rows assigned below are visible while this subgroup is expanded.</p> : null}</div>)}</div> : null}
        </header>
      <div hidden={collapsedGroups[group.id]}>
        <SyncedHorizontalScrollContainer>
        <table className="min-w-[1760px] w-full text-left text-xs">
          <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
            <tr>
              <th className="w-20 px-2 py-2">Image</th>
              <th className="px-2 py-2">Subgroup</th>
              <th className="px-2 py-2">Variant Code / Short Name</th>
              <th className="px-2 py-2">Display Name</th>
              <th className="px-2 py-2">Supplier / Price List Code</th>
              <th className="px-2 py-2">Dimension</th>
              <th className="px-2 py-2">Price</th>
              <th className="px-2 py-2">Currency</th>
              <th className="px-2 py-2">Details</th>
              <th className="px-2 py-2">Active</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((row, index) => {
              const subgroup = row.id ? baseModelPricingSubgroupForRow(group, row.id) : null;
              const rowId = row.id ?? `variant-${index}`;
              const expanded = expandedRowByGroup[group.id] === rowId;
              return <>
              <tr key={rowId} hidden={Boolean(subgroup && collapsedSubgroups[subgroup.id])} className="border-t border-zinc-100 align-top">
                <td className="px-2 py-2 align-top">{row.id ? <PricingRowReferenceImage templateId={templateId} templateIsPersisted={templateIsPersisted} pricingType="base_model" groupId={group.id} rowId={row.id} /> : <span className="text-[10px] text-zinc-400">Save row first</span>}</td>
                <td className="px-2 py-2 align-top">{row.id ? <select value={subgroup?.id ?? ""} onChange={(event) => setGroups((current) => current.map((entry) => entry.id === group.id ? assignBaseModelRowToSubgroup(entry, row.id!, event.target.value || null) : entry))} className="h-10 min-w-[170px] border border-zinc-200 bg-white px-2"><option value="">Ungrouped</option>{(group.subgroups ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.subgroup_name}</option>)}</select> : null}</td>
                <td className="px-2 py-2 align-top"><input value={row.variant_name ?? ""} onChange={(e) => update(group.id, index, { variant_name: e.target.value })} className="h-10 min-w-[160px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2 align-top"><AutoGrowTextarea value={row.display_name ?? ""} onChange={(value) => update(group.id, index, { display_name: value })} minHeightClass="min-h-[44px]" rows={2} widthClass="min-w-[300px]" /></td>
                <td className="px-2 py-2 align-top"><input value={row.supplier_price_list_code ?? ""} onChange={(e) => update(group.id, index, { supplier_price_list_code: e.target.value })} className="h-10 min-w-[190px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2 align-top"><input value={row.dimension ?? ""} onChange={(e) => update(group.id, index, { dimension: e.target.value })} className="h-10 min-w-[140px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2 align-top"><input type="number" value={row.price ?? ""} onChange={(e) => update(group.id, index, { price: parseNullablePricingNumber(e.target.value) })} className="h-10 min-w-[120px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                <td className="px-2 py-2 align-top"><div className="min-w-[110px]"><CurrencySelect value={row.currency} onChange={(currency) => update(group.id, index, { currency })} /></div></td>
                <td className="px-2 py-2 align-top"><button type="button" aria-expanded={expanded} onClick={() => setExpandedRowByGroup((current) => ({ ...current, [group.id]: expanded ? null : rowId }))} className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold text-emerald-900">{expanded ? "Hide details" : "Edit / Details"}</button></td>
                <td className="px-2 py-2 align-top"><input type="checkbox" checked={row.is_active !== false} onChange={(e) => update(group.id, index, { is_active: e.target.checked })} /></td>
                <td className="px-2 py-2 align-top"><div className="min-w-[100px]"><button type="button" onClick={() => setGroups((current) => removeBaseModelPricingRow(current, group.id, index))} className="text-xs font-semibold text-red-700">Remove</button></div></td>
              </tr>
              {expanded ? <tr key={`${rowId}-details`} className="border-t border-zinc-200 bg-zinc-50"><td colSpan={11} className="p-3"><AutoGrowTextarea value={row.specification ?? ""} onChange={(value) => update(group.id, index, { specification: value })} minHeightClass="min-h-[64px]" rows={3} widthClass="min-w-0 w-full" /><ImportantRequirementsTextarea value={row.importantRequirements} onChange={(importantRequirements) => update(group.id, index, { importantRequirements })} /></td></tr> : null}
              </>;
            })}
            {!group.items.length ? <tr><td colSpan={11} className="px-3 py-5 text-center text-zinc-500">No size/model variants yet.</td></tr> : null}
          </tbody>
        </table>
        </SyncedHorizontalScrollContainer>
      </div>
      </section>
      ))}
      {!groups.length ? <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-500">No Base / Model groups yet.</div> : null}
      </div>
      <button type="button" onClick={() => setGroups((current) => {
        const nextSortOrder = Math.max(-1, ...current.map((group) => Number(group.sort_order) || 0)) + 1;
        return [...current, createBaseModelPricingGroup<VariantPricingRow>(idFor("base-model-group", nextSortOrder), nextSortOrder, current.length ? "New Base / Model Group" : "Base / Model Pricing")];
      })} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add Base / Model Group</button>
      {referenceTargetGroup && referenceTargetGroupId ? <PricingGroupReferenceImages templateId={templateId} pricingType="base_model" groupId={referenceTargetGroupId} groupLabel={referenceTargetGroup.group_name} onClose={() => setReferenceTargetGroupId(null)} /> : null}
    </div>
  );
}

export function CategoryPricingTable({
  brandDefaultCurrency,
  onGroupsChange,
  onHasDataChange,
  replacementGroups,
  replacementVersion,
  rows,
  templateIsPersisted,
  templateId,
  templateCurrency,
}: {
  brandDefaultCurrency?: string | null;
  onGroupsChange?: (groups: CategoryPricingRow[]) => void;
  onHasDataChange?: (hasCategoryPricingData: boolean) => void;
  replacementGroups?: CategoryPricingRow[] | null;
  replacementVersion?: number;
  rows?: CategoryPricingRow[] | null;
  templateIsPersisted: boolean;
  templateId: string;
  templateCurrency?: string | null;
}) {
  const initialGroups = useMemo(
    () => groupedStandardCategoryPricingRows(rows).map((group, index) => normalizeCategoryGroup(group, index, false)),
    [rows],
  );
  const importedIdsRef = useRef<Set<string>>(new Set());
  const [groups, setGroups] = useState<CategoryPricingRow[]>(() => initialGroups);
  const appliedReplacementVersion = useRef<number | undefined>(undefined);
  const [newCategoryNames, setNewCategoryNames] = useState<Record<string, string>>({});
  const [showCategoryCreators, setShowCategoryCreators] = useState<Record<string, boolean>>({});
  const [groupActionNotices, setGroupActionNotices] = useState<Record<string, string>>({});
  const [expandedCategoryRowByGroup, setExpandedCategoryRowByGroup] = useState<Record<string, string | null>>({});
  const [importTargetGroupId, setImportTargetGroupId] = useState<string | null>(null);
  const [referenceTargetGroupId, setReferenceTargetGroupId] = useState<string | null>(null);
  const persistedGroupIds = useMemo(() => persistedFinishCategoryGroupIds(rows), [rows]);
  const userEditedCurrencyRowIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: initialGroups.flatMap((group) => group.items ?? []),
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const serialized = useMemo(
    () =>
      JSON.stringify(
        groups.map((group, groupIndex) => {
          const normalizedGroup = normalizeCategoryGroup(group, groupIndex, false);
          return {
            ...normalizedGroup,
            items: (normalizedGroup.items ?? []).map((item, itemIndex) =>
              normalizeCategory(
                categoryPricingRowWithColumns(item, normalizedGroup.price_categories ?? []),
                itemIndex,
                normalizedGroup.price_categories ?? [],
              ),
            ),
          };
        }),
      ),
    [groups],
  );

  useEffect(() => {
    if (replacementVersion === undefined || replacementVersion === appliedReplacementVersion.current) return;
    appliedReplacementVersion.current = replacementVersion;
    setGroups((replacementGroups ?? []).map((group, index) => normalizeCategoryGroup(group, index, false)));
    setNewCategoryNames({});
    setShowCategoryCreators({});
    setGroupActionNotices({});
    setReferenceTargetGroupId(null);
  }, [replacementGroups, replacementVersion]);

  useEffect(() => {
    onHasDataChange?.(hasMeaningfulCategoryPricing(groups));
    onGroupsChange?.(groups);
  }, [groups, onGroupsChange, onHasDataChange]);

  useEffect(() => {
    const handleApply = (event: Event) => {
      const detail = (event as CustomEvent<{
        action: string;
        draft: QuotationRowImportDraft;
        templateId: string;
      }>).detail;

      if (!detail || detail.templateId !== templateId || detail.action !== "finish") {
        return;
      }

      const price = Number(detail.draft.unit_price) || 0;
      const row = normalizeCategory({
        id: idFor("category", groups.length),
        variant_name: detail.draft.model_snapshot || detail.draft.item_name_snapshot || "Imported finish row",
        display_name: detail.draft.item_name_snapshot || detail.draft.model_snapshot || "Imported finish row",
        dimension: detail.draft.size_snapshot || "",
        currency: normalizeCurrency(detail.draft.currency ?? templateCurrency ?? brandDefaultCurrency ?? defaultCurrency),
        prices: {
          "Cat A": price,
          "Cat B": price,
          "Cat C": price,
          "Cat D": price,
        },
        specification: detail.draft.specification_snapshot || "",
        is_active: true,
        sort_order: 0,
      }, 0);

      importedIdsRef.current.add(row.id ?? "");
      setGroups((current) => {
        if (!current.length) {
          return [normalizeCategoryGroup({
            id: "finish-category-pricing",
            group_name: "Finish Category Pricing",
            is_active: true,
            sort_order: 0,
            price_categories: [],
            items: [row],
          }, 0)];
        }

        return current.map((group, index) => index === 0
          ? {
              ...group,
              items: [...(group.items ?? []), { ...row, sort_order: group.items?.length ?? 0 }],
            }
          : group);
      });
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "finish",
          status: "Finish pricing row added.",
          templateId,
        },
      }));
    };

    const handleReset = (event: Event) => {
      const detail = (event as CustomEvent<{ templateId: string }>).detail;
      if (!detail || detail.templateId !== templateId) {
        return;
      }

      if (importedIdsRef.current.size) {
        setGroups((current) =>
          current.map((group) => ({
            ...group,
            items: (group.items ?? []).filter((row) => !importedIdsRef.current.has(row.id ?? "")),
          })).filter((group) => (group.items ?? []).length > 0 || group.group_name),
        );
      }
      importedIdsRef.current = new Set();
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "finish",
          status: "",
          templateId,
        },
      }));
    };

    window.addEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
    window.addEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    return () => {
      window.removeEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
      window.removeEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    };
  }, [brandDefaultCurrency, groups.length, templateCurrency, templateId]);

  function updateGroup(index: number, patch: Partial<CategoryPricingRow>) {
    setGroups((current) => current.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group));
  }

  function updateItem(groupIndex: number, itemIndex: number, patch: Partial<CategoryPricingRow>) {
    if (typeof patch.currency === "string") {
      userEditedCurrencyRowIds.current.add(groups[groupIndex]?.items?.[itemIndex]?.id ?? `category-${groupIndex}-${itemIndex}`);
    }

    setGroups((current) =>
      current.map((group, currentGroupIndex) => {
        if (currentGroupIndex !== groupIndex) return group;

        return {
          ...group,
          items: (group.items ?? []).map((row, rowIndex) => rowIndex === itemIndex ? { ...row, ...patch } : row),
        };
      }),
    );
  }

  useEffect(() => {
    const allRows = groups.flatMap((group) => group.items ?? []);
    const nextDefaultCurrency = resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: allRows,
      savedTemplateCurrency: templateCurrency,
    });

    setGroups((current) => {
      let didChange = false;
      const nextGroups = current.map((group, groupIndex) => {
        const nextItems = (group.items ?? []).map((row, index) => {
          const key = row.id ?? `category-${groupIndex}-${index}`;
          if (userEditedCurrencyRowIds.current.has(key) || rowHasMeaningfulValues(row)) {
            return row;
          }

          const currentCurrency = row.currency?.trim() ? normalizeCurrency(row.currency) : null;
          const previousDefaultCurrency = previousDefaultCurrencyRef.current;
          if (
            currentCurrency &&
            currentCurrency !== previousDefaultCurrency &&
            currentCurrency !== defaultCurrency
          ) {
            return row;
          }

          if (currentCurrency === nextDefaultCurrency) {
            return row;
          }

          didChange = true;
          return {
            ...row,
            currency: nextDefaultCurrency,
          };
        });

        return nextItems.some((item, index) => item !== (group.items ?? [])[index])
          ? { ...group, items: nextItems }
          : group;
      });

      return didChange ? nextGroups : current;
    });

    previousDefaultCurrencyRef.current = nextDefaultCurrency;
  }, [brandDefaultCurrency, groups, templateCurrency]);

  function addPriceCategoryColumn(groupIndex: number) {
    const group = groups[groupIndex];
    const groupId = group?.id ?? `category-group-${groupIndex}`;
    const trimmedName = (newCategoryNames[groupId] ?? "").trim();
    if (!trimmedName) {
      return;
    }
    const normalizedCategory = normalizeCategoryPriceLabel(trimmedName);
    const groupPriceCategories = group?.price_categories ?? [];
    if (!normalizedCategory || groupPriceCategories.includes(normalizedCategory)) {
      setNewCategoryNames((current) => ({ ...current, [groupId]: "" }));
      setShowCategoryCreators((current) => ({ ...current, [groupId]: false }));
      return;
    }

    updateGroup(groupIndex, {
      price_categories: [...groupPriceCategories, normalizedCategory],
      items: (group.items ?? []).map((row) => ({
        ...row,
        prices: {
          ...normalizedPriceMap(row.prices, false),
          [normalizedCategory]: parseNullablePricingNumber(row.prices?.[normalizedCategory]),
        },
      })),
    });
    setNewCategoryNames((current) => ({ ...current, [groupId]: "" }));
    setShowCategoryCreators((current) => ({ ...current, [groupId]: false }));
  }

  function addRow(groupIndex: number, event: MouseEvent<HTMLButtonElement>) {
    const currency = resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: groups[groupIndex]?.items ?? groups.flatMap((group) => group.items ?? []),
      savedTemplateCurrency: templateCurrency,
      trigger: event.currentTarget,
    });
    updateGroup(groupIndex, {
      items: [
        ...(groups[groupIndex]?.items ?? []),
        newCategoryPricingRow(
          groups[groupIndex]?.items?.length ?? 0,
          groups[groupIndex]?.price_categories ?? [],
          currency,
        ),
      ],
    });
  }

  const importTargetGroup = groups.find((group) => group.id === importTargetGroupId) ?? null;
  const referenceTargetGroup = groups.find((group) => group.id === referenceTargetGroupId) ?? null;

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="category_pricing" value={serialized} />
      <div className="space-y-4">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm font-semibold text-zinc-950">Finish category pricing</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Create separate finish pricing groups such as melamine, fabric, leather, glass, or acoustic panel pricing.
          </p>
          <button
            type="button"
            onClick={() => setGroups((current) => [...current, normalizeCategoryGroup({
              id: idFor("category-group", current.length),
              group_name: "Finish Category Pricing",
              is_active: true,
              sort_order: current.length,
              price_categories: [],
              items: [],
            }, current.length)])}
            className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
          >
            + Add finish pricing group
          </button>
        </div>

        {groups.length ? groups.map((group, groupIndex) => {
          const groupId = group.id ?? `category-group-${groupIndex}`;
          const groupPriceCategories = group.price_categories ?? standardCategoryPriceColumns(group.items);

          return (
            <PricingGroupShell
              key={groupId}
              active={group.is_active !== false}
              title={<input value={group.group_name ?? ""} onChange={(event) => updateGroup(groupIndex, { group_name: event.target.value })} placeholder="Finish pricing group" className="h-8 w-full max-w-xl border border-zinc-200 bg-white px-2 text-sm font-semibold outline-none focus:border-emerald-800" />}
              notice={groupActionNotices[groupId]}
              onActiveChange={(active) => updateGroup(groupIndex, { is_active: active })}
              onAddRow={(event) => addRow(groupIndex, event)}
              onImportJson={() => setImportTargetGroupId(groupId)}
              onAddReferenceImage={() => {
                const availability = finishCategoryReferenceAvailability({
                  templateIsPersisted,
                  persistedGroupIds,
                  groupId,
                });
                if (!availability.available) {
                  setGroupActionNotices((current) => ({ ...current, [groupId]: availability.message ?? "Reference images are unavailable." }));
                  return;
                }
                setGroupActionNotices((current) => ({ ...current, [groupId]: "" }));
                setReferenceTargetGroupId(groupId);
              }}
              referenceActionLabel="Reference images"
              onRemove={() => setGroups((current) => current.filter((_, index) => index !== groupIndex))}
              secondaryActions={<button type="button" onClick={() => setShowCategoryCreators((current) => ({ ...current, [groupId]: true }))} className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-600 hover:text-emerald-900">+ Add price category</button>}
            >

              {showCategoryCreators[groupId] ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={newCategoryNames[groupId] ?? ""}
                    onChange={(event) => setNewCategoryNames((current) => ({ ...current, [groupId]: event.target.value }))}
                    placeholder="Cat E"
                    className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800"
                  />
                  <button type="button" onClick={() => addPriceCategoryColumn(groupIndex)} className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
                    Add column
                  </button>
                  <button type="button" onClick={() => { setNewCategoryNames((current) => ({ ...current, [groupId]: "" })); setShowCategoryCreators((current) => ({ ...current, [groupId]: false })); }} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300">
                    Cancel
                  </button>
                </div>
              ) : null}

              {!groupPriceCategories.length ? <p className="mt-3 text-sm text-zinc-500">No price categories yet. Add a category before entering category prices.</p> : null}

              <div className="mt-3">
                <SyncedHorizontalScrollContainer>
                <table className="min-w-[1960px] w-full text-left text-xs">
                  <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
                    <tr>
                      <th className="w-20 px-2 py-2">Image</th>
                      <th className="px-2 py-2">Variant Code / Short Name</th>
                      <th className="px-2 py-2">Display Name</th>
                      <th className="px-2 py-2">Supplier / Price List Code</th>
                      <th className="px-2 py-2">Dimension</th>
                      {groupPriceCategories.map((category) => <th key={category} className="px-2 py-2">{category}</th>)}
                      <th className="px-2 py-2">Currency</th>
                      <th className="px-2 py-2">Details</th>
                      <th className="px-2 py-2">Active</th>
                      <th className="px-2 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(group.items ?? []).map((row, itemIndex) => {
                      const normalizedRow = categoryPricingRowWithColumns(row, groupPriceCategories);
                      const rowId = row.id ?? `category-${itemIndex}`;
                      const expanded = expandedCategoryRowByGroup[groupId] === rowId;
                      return <>
                        <tr key={rowId} className="border-t border-zinc-100 align-top">
                          <td className="px-2 py-2 align-top">{group.id && row.id ? <PricingRowReferenceImage templateId={templateId} templateIsPersisted={templateIsPersisted} pricingType="finish_category" groupId={group.id} rowId={row.id} /> : <span className="text-[10px] text-zinc-400">Save row first</span>}</td>
                          <td className="px-2 py-2 align-top"><input value={normalizedRow.variant_name ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { variant_name: e.target.value })} className="h-10 min-w-[160px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                          <td className="px-2 py-2 align-top"><AutoGrowTextarea value={normalizedRow.display_name ?? ""} onChange={(value) => updateItem(groupIndex, itemIndex, { display_name: value })} minHeightClass="min-h-[44px]" rows={2} widthClass="min-w-[300px]" /></td>
                          <td className="px-2 py-2 align-top"><input value={normalizedRow.supplier_price_list_code ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { supplier_price_list_code: e.target.value })} className="h-10 min-w-[190px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                          <td className="px-2 py-2 align-top"><input value={normalizedRow.dimension ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { dimension: e.target.value })} className="h-10 min-w-[140px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                              {groupPriceCategories.map((category) => { const unavailable = normalizedRow.unavailable_categories?.includes(category); return <td key={category} className="px-2 py-2 align-top"><div className="flex gap-1"><input disabled={unavailable} type="number" value={normalizedRow.prices?.[category] ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { prices: { ...normalizedRow.prices, [category]: parseNullablePricingNumber(e.target.value) } })} className="h-10 min-w-[88px] border border-zinc-200 px-3 outline-none focus:border-emerald-800 disabled:bg-zinc-100" /><button type="button" onClick={() => updateItem(groupIndex, itemIndex, { prices: { ...normalizedRow.prices, [category]: unavailable ? normalizedRow.prices?.[category] ?? null : null }, unavailable_categories: unavailable ? (normalizedRow.unavailable_categories ?? []).filter((item) => item !== category) : [...(normalizedRow.unavailable_categories ?? []), category] })} className="border border-zinc-300 px-1 text-[10px] font-semibold">{unavailable ? "N/A" : "N/A?"}</button></div></td>; })}
                          <td className="px-2 py-2 align-top"><div className="min-w-[110px]"><CurrencySelect value={normalizedRow.currency} onChange={(currency) => updateItem(groupIndex, itemIndex, { currency })} /></div></td>
                          <td className="px-2 py-2 align-top"><button type="button" aria-expanded={expanded} onClick={() => setExpandedCategoryRowByGroup((current) => ({ ...current, [groupId]: expanded ? null : rowId }))} className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold text-emerald-900">{expanded ? "Hide details" : "Edit / Details"}</button></td>
                          <td className="px-2 py-2 align-top"><input type="checkbox" checked={normalizedRow.is_active !== false} onChange={(e) => updateItem(groupIndex, itemIndex, { is_active: e.target.checked })} /></td>
                          <td className="px-2 py-2 align-top"><div className="min-w-[100px]"><button type="button" onClick={() => updateGroup(groupIndex, { items: (group.items ?? []).filter((_, index) => index !== itemIndex) })} className="text-xs font-semibold text-red-700">Remove row</button></div></td>
                        </tr>
                        {expanded ? <tr key={`${rowId}-details`} className="border-t border-zinc-200 bg-zinc-50"><td colSpan={groupPriceCategories.length + 10} className="p-3"><AutoGrowTextarea value={normalizedRow.specification ?? ""} onChange={(value) => updateItem(groupIndex, itemIndex, { specification: value })} minHeightClass="min-h-[64px]" rows={3} widthClass="min-w-0 w-full" /><ImportantRequirementsTextarea value={normalizedRow.importantRequirements} onChange={(importantRequirements) => updateItem(groupIndex, itemIndex, { importantRequirements })} /></td></tr> : null}
                      </>;
                    })}
                    {!(group.items ?? []).length ? <tr><td colSpan={groupPriceCategories.length + 10} className="px-3 py-5 text-center text-zinc-500">No finish pricing rows in this group yet.</td></tr> : null}
                  </tbody>
                </table>
                </SyncedHorizontalScrollContainer>
              </div>

            </PricingGroupShell>
          );
        }) : (
          <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
            <p>No finish pricing groups yet.</p>
          </div>
        )}
      </div>
      {importTargetGroup && importTargetGroupId ? <FinishCategoryGroupJsonImport groupName={importTargetGroup.group_name ?? "Finish Category Pricing"} onClose={() => setImportTargetGroupId(null)} onReplace={(candidate) => { setGroups((current) => replaceFinishCategoryGroup(current, importTargetGroupId, candidate.group)); setImportTargetGroupId(null); }} /> : null}
      {referenceTargetGroup && referenceTargetGroupId ? <FinishCategoryGroupReferenceImages templateId={templateId} groupId={referenceTargetGroupId} groupName={referenceTargetGroup.group_name ?? "Finish Category Pricing"} onClose={() => setReferenceTargetGroupId(null)} /> : null}
    </div>
  );
}

export function ModularItemPricingTable({
  brandDefaultCurrency,
  onGroupsChange,
  onHasDataChange,
  replacementGroups,
  replacementVersion,
  rows,
  templateId,
  templateIsPersisted,
  templateCurrency,
}: {
  brandDefaultCurrency?: string | null;
  onGroupsChange?: (groups: CategoryPricingRow[]) => void;
  onHasDataChange?: (hasModularPricingData: boolean) => void;
  replacementGroups?: CategoryPricingRow[] | null;
  replacementVersion?: number;
  rows?: CategoryPricingRow[] | null;
  templateId: string;
  templateIsPersisted: boolean;
  templateCurrency?: string | null;
}) {
  // Incoming/saved category columns are authoritative: never auto-create generic Cat A-D defaults
  // when initializing the review/editor state, only when a user explicitly adds a new column.
  const initialGroups = useMemo(() => normalizeModularGroups(rows, false), [rows]);
  const modularDefaults = useMemo(() => modularPricingDefaultsFromRows(rows), [rows]);
  const [groups, setGroups] = useState<CategoryPricingRow[]>(() => initialGroups);
  const [priceCategories, setPriceCategories] = useState<string[]>(() => modularPriceCategories(initialGroups, false));
  const appliedReplacementVersion = useRef<number | undefined>(undefined);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showCategoryCreator, setShowCategoryCreator] = useState(false);
  const [defaultSpecification, setDefaultSpecification] = useState(modularDefaults.defaultSpecification ?? "");
  const [defaultDimension, setDefaultDimension] = useState(modularDefaults.defaultDimension ?? "");
  const [groupActionNotices, setGroupActionNotices] = useState<Record<string, string>>({});
  const [expandedRowByGroup, setExpandedRowByGroup] = useState<Record<string, string | null>>({});
  const [referenceTargetGroupId, setReferenceTargetGroupId] = useState<string | null>(null);
  const persistedGroupIds = useMemo(() => persistedPricingGroupIds(rows, "modular"), [rows]);
  const userEditedCurrencyRowIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultModularPricingCurrency({
      brandDefaultCurrency,
      existingRows: initialGroups.flatMap((group) => group.items ?? []),
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const serialized = useMemo(
    () =>
      JSON.stringify(
        groups.map((group, groupIndex) => ({
          id: (group as CategoryPricingRow).id || `modular-group-${groupIndex}`,
          group_name: (group as CategoryPricingRow).group_name?.trim() || "Modular Items",
          is_active: (group as CategoryPricingRow).is_active !== false,
          pricing_type: MODULAR_GROUP_PRICING_TYPE,
          // Matrix Modular groups must submit their authoritative column set explicitly. Omitting
          // price_categories here made the server fall back to the generic Cat A-D defaults and merge
          // them into every row's saved prices (lib/products/category-pricing-value.ts), which is how
          // stale/default columns survived a Smart Setup replace/import.
          ...(isDirectModularPricingGroup(group) ? { modular_pricing_mode: "direct", price_categories: [] } : { price_categories: priceCategories }),
          // Composition (starter/intermediate cardinality) applies to both Direct and Matrix Modular groups.
          ...(group.modular_composition ? { modular_composition: group.modular_composition } : {}),
          ...(group.modular_selection_family?.trim() ? { modular_selection_family: group.modular_selection_family.trim() } : {}),
          sort_order: Number.isFinite(Number((group as CategoryPricingRow).sort_order))
            ? Number((group as CategoryPricingRow).sort_order)
            : groupIndex,
          ...(group.subgroups ? { subgroups: group.subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] })) } : {}),
          items: (group.items ?? []).map((row, index) =>
            isDirectModularPricingGroup(group) ? normalizeDirectModularRow(row, index) : normalizeCategory({
              ...categoryPricingRowWithColumns(row, priceCategories),
              pricing_type: MODULAR_ITEM_PRICING_TYPE,
            }, index, priceCategories)),
        })),
      ),
    [groups, priceCategories],
  );
  const serializedDefaults = useMemo(
    () =>
      JSON.stringify({
        modular_default_dimension: defaultDimension.trim() || null,
        modular_default_specification: defaultSpecification.trim() || null,
    }),
    [defaultDimension, defaultSpecification],
  );

  useEffect(() => {
    if (replacementVersion === undefined || replacementVersion === appliedReplacementVersion.current) return;
    appliedReplacementVersion.current = replacementVersion;
    const nextGroups = normalizeModularGroups(replacementGroups, false);
    setGroups(nextGroups);
    setPriceCategories(modularPriceCategories(nextGroups, false));
    setNewCategoryName("");
    setShowCategoryCreator(false);
    setGroupActionNotices({});
    setReferenceTargetGroupId(null);
  }, [replacementGroups, replacementVersion]);

  useEffect(() => {
    onHasDataChange?.(hasMeaningfulModularPricing(groups, priceCategories));
  }, [groups, onHasDataChange, priceCategories]);

  useEffect(() => {
    onGroupsChange?.(groups);
  }, [groups, onGroupsChange]);

  function updateGroup(groupIndex: number, patch: Partial<CategoryPricingRow>) {
    setGroups((current) => current.map((group, index) => index === groupIndex ? { ...group, ...patch } : group));
  }

  function updateRow(groupIndex: number, rowIndex: number, patch: Partial<CategoryPricingRow>) {
    setGroups((current) => current.map((group, currentGroupIndex) =>
      currentGroupIndex === groupIndex
        ? {
            ...group,
            items: (group.items ?? []).map((row, currentRowIndex) =>
              currentRowIndex === rowIndex ? { ...row, ...patch } : row,
            ),
          }
        : group,
    ));
  }

  useEffect(() => {
    const nextDefaultCurrency = resolveDefaultModularPricingCurrency({
      brandDefaultCurrency,
      existingRows: groups.flatMap((group) => group.items ?? []),
      savedTemplateCurrency: templateCurrency,
    });

    setGroups((current) => {
      let didChange = false;
      const nextGroups = current.map((group) => ({
        ...group,
        items: (group.items ?? []).map((row) => {
          if (userEditedCurrencyRowIds.current.has(row.id ?? "")) {
            return row;
          }

          if (rowHasMeaningfulValues(row)) {
            return row;
          }

          const currentCurrency = row.currency?.trim() ? normalizeCurrency(row.currency) : null;
          const previousDefaultCurrency = previousDefaultCurrencyRef.current;
          if (
            currentCurrency &&
            currentCurrency !== previousDefaultCurrency &&
            currentCurrency !== defaultCurrency
          ) {
            return row;
          }

          if (currentCurrency === nextDefaultCurrency) {
            return row;
          }

          didChange = true;
          return {
            ...row,
            currency: nextDefaultCurrency,
          };
        }),
      }));

      return didChange ? nextGroups : current;
    });

    previousDefaultCurrencyRef.current = nextDefaultCurrency;
  }, [brandDefaultCurrency, groups, templateCurrency]);

  function addPriceCategoryColumn() {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) return;

    const normalizedCategory = normalizeCategoryPriceLabel(trimmedName);
    if (!normalizedCategory || priceCategories.includes(normalizedCategory)) {
      setNewCategoryName("");
      setShowCategoryCreator(false);
      return;
    }

    setPriceCategories((current) => [...current, normalizedCategory]);
    setGroups((current) =>
      current.map((group) => ({
        ...group,
        items: (group.items ?? []).map((row) => ({
          ...row,
          prices: {
            ...normalizedPriceMap(row.prices, false),
            [normalizedCategory]: parseNullablePricingNumber(row.prices?.[normalizedCategory]),
          },
        })),
      })),
    );
    setNewCategoryName("");
    setShowCategoryCreator(false);
  }

  function addGroup() {
    setGroups((current) => [
      ...current,
      {
        id: idFor("modular-group", current.length),
        group_name: "Modular Items",
        is_active: true,
        pricing_type: MODULAR_GROUP_PRICING_TYPE,
        sort_order: current.length,
        items: [],
      },
    ]);
  }

  function addRow(groupIndex: number, event: MouseEvent<HTMLButtonElement>) {
    const currency = resolveDefaultModularPricingCurrency({
      brandDefaultCurrency,
      existingRows: groups.flatMap((group) => group.items ?? []),
      savedTemplateCurrency: templateCurrency,
      trigger: event.currentTarget,
    });
    setGroups((current) => current.map((group, index) =>
      index === groupIndex
        ? {
            ...group,
            items: [
              ...(group.items ?? []),
              {
                ...newCategoryPricingRow((group.items ?? []).length, priceCategories, currency),
                pricing_type: MODULAR_ITEM_PRICING_TYPE,
              },
            ],
          }
        : group,
    ));
  }

  function openReferenceImages(groupId: string) {
    const availability = pricingGroupReferenceAvailability({
      templateIsPersisted,
      persistedGroupIds,
      groupId,
    });
    if (!availability.available) {
      setGroupActionNotices((current) => ({ ...current, [groupId]: availability.message ?? "Reference images are unavailable." }));
      return;
    }
    setGroupActionNotices((current) => ({ ...current, [groupId]: "" }));
    setReferenceTargetGroupId(groupId);
  }

  const referenceTargetGroup = groups.find((group) => group.id === referenceTargetGroupId) ?? null;

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="modular_item_pricing" value={serialized} />
      <input type="hidden" name="modular_item_pricing_defaults" value={serializedDefaults} />
      <div className="space-y-4">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm font-semibold text-zinc-950">Modular item defaults</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Set the default modular specification and dimension used when this template opens in the quotation popup.
          </p>
          <div className="mt-3 grid gap-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase text-zinc-500">Default modular specification</span>
              <AutoGrowTextarea
                value={defaultSpecification}
                onChange={setDefaultSpecification}
                minHeightClass="min-h-[72px]"
                rows={3}
                widthClass="min-w-0 w-full"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase text-zinc-500">Default dimension</span>
              <input
                value={defaultDimension}
                onChange={(event) => setDefaultDimension(event.target.value)}
                placeholder="540x70x78 cmH"
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800"
              />
            </label>
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm font-semibold text-zinc-950">Modular item pricing</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Add configurable modular units and their fabric/category prices for sofas, lounges, and sectional compositions.
          </p>
          {showCategoryCreator ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="Cat E"
                className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800"
              />
              <button type="button" onClick={addPriceCategoryColumn} className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
                Add column
              </button>
              <button type="button" onClick={() => { setNewCategoryName(""); setShowCategoryCreator(false); }} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowCategoryCreator(true)} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
              + Add price category column
            </button>
          )}
        </div>

        {groups.length ? (
          <div className="space-y-4">
            {groups.map((group, groupIndex) => {
              const groupId = group.id ?? `modular-group-${groupIndex}`;
              const directGroup = isDirectModularPricingGroup(group);
              return (
              <div key={group.id ?? groupIndex} className="rounded-md border border-zinc-200 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="grid flex-1 gap-3 md:grid-cols-[minmax(220px,1fr)_auto] md:items-end">
                    <label className="block">
                      <span className="text-xs font-semibold uppercase text-zinc-500">Modular item group</span>
                      <input
                        value={group.group_name ?? ""}
                        onChange={(event) => updateGroup(groupIndex, { group_name: event.target.value })}
                        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-zinc-500">
                      <input
                        type="checkbox"
                        checked={group.is_active !== false}
                        onChange={(event) => updateGroup(groupIndex, { is_active: event.target.checked })}
                      />
                      Active
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => openReferenceImages(groupId)} className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-600 hover:text-emerald-900">Reference images</button>
                    <button
                      type="button"
                      onClick={() => setGroups((current) => current.filter((_, index) => index !== groupIndex))}
                      className="text-xs font-semibold text-red-700"
                    >
                      Remove group
                    </button>
                  </div>
                </div>
                {groupActionNotices[groupId] ? <p role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{groupActionNotices[groupId]}</p> : null}
                {(group.items ?? []).length ? (
                  <div className="mt-4 rounded-md border border-zinc-200 bg-white"><SyncedHorizontalScrollContainer>
                    <table className="min-w-[1960px] w-full text-left text-xs">
                      <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
                        <tr>
                          <th className="w-20 px-2 py-2">Image</th>
                          <th className="px-2 py-2">Module name</th>
                          <th className="px-2 py-2">Display name</th>
                          <th className="px-2 py-2">Supplier / Price List Code</th>
                          <th className="px-2 py-2">Dimension</th>
                          {directGroup ? <th className="px-2 py-2">Direct Price</th> : priceCategories.map((category) => <th key={category} className="px-2 py-2">{category}</th>)}
                          <th className="px-2 py-2">Role</th>
                          <th className="px-2 py-2">Currency</th>
                          <th className="px-2 py-2">Details</th>
                          <th className="px-2 py-2">Active</th>
                          <th className="px-2 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(group.items ?? []).map((row, rowIndex) => {
                          const normalizedRow = directGroup ? normalizeDirectModularRow(row, rowIndex) : categoryPricingRowWithColumns(row, priceCategories);
                          const expanded = expandedRowByGroup[groupId] === normalizedRow.id;
                          return (<>
                            <tr key={row.id ?? rowIndex} className="border-t border-zinc-100 align-top">
                              <td className="px-2 py-2 align-top">{group.id && row.id ? <PricingRowReferenceImage templateId={templateId} templateIsPersisted={templateIsPersisted} pricingType="modular" groupId={group.id} rowId={row.id} /> : <span className="text-[10px] text-zinc-400">Save row first</span>}</td>
                              <td className="px-2 py-2 align-top"><input value={normalizedRow.variant_name ?? ""} onChange={(e) => updateRow(groupIndex, rowIndex, { variant_name: e.target.value })} className="h-10 min-w-[160px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                              <td className="px-2 py-2 align-top"><AutoGrowTextarea value={normalizedRow.display_name ?? ""} onChange={(value) => updateRow(groupIndex, rowIndex, { display_name: value })} minHeightClass="min-h-[44px]" rows={2} widthClass="min-w-[300px]" /></td>
                              <td className="px-2 py-2 align-top"><input value={normalizedRow.supplier_price_list_code ?? ""} onChange={(e) => updateRow(groupIndex, rowIndex, { supplier_price_list_code: e.target.value })} className="h-10 min-w-[190px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                              <td className="px-2 py-2 align-top"><input value={normalizedRow.dimension ?? ""} onChange={(e) => updateRow(groupIndex, rowIndex, { dimension: e.target.value })} className="h-10 min-w-[140px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                              {directGroup ? <td className="px-2 py-2 align-top"><input aria-label="Direct Price" type="number" value={normalizedRow.price ?? ""} onChange={(e) => updateRow(groupIndex, rowIndex, { price: parseNullablePricingNumber(e.target.value) })} className="h-10 min-w-[116px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td> : priceCategories.map((category) => <td key={category} className="px-2 py-2 align-top"><input type="number" value={normalizedRow.prices?.[category] ?? ""} onChange={(e) => updateRow(groupIndex, rowIndex, { prices: { ...normalizedRow.prices, [category]: parseNullablePricingNumber(e.target.value) } })} className="h-10 min-w-[116px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>)}
                              <td className="px-2 py-2 align-top"><select aria-label="Modular Role" value={normalizedRow.modular_role ?? ""} onChange={(e) => updateRow(groupIndex, rowIndex, { modular_role: e.target.value || undefined })} className="h-10 min-w-[130px] border border-zinc-200 px-2 outline-none focus:border-emerald-800"><option value="">None</option><option value="starter">Starter</option><option value="intermediate">Intermediate</option><option value="terminal">Terminal</option></select></td>
                              <td className="px-2 py-2 align-top"><div className="min-w-[110px]"><CurrencySelect value={normalizedRow.currency} onChange={(currency) => {
                                userEditedCurrencyRowIds.current.add(normalizedRow.id ?? `${groupIndex}-${rowIndex}`);
                                updateRow(groupIndex, rowIndex, { currency });
                              }} /></div></td>
                              <td className="px-2 py-2 align-top"><button type="button" aria-expanded={expanded} onClick={() => setExpandedRowByGroup((current) => ({ ...current, [groupId]: expanded ? null : normalizedRow.id ?? null }))} className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold text-emerald-900">{expanded ? "Hide details" : "Edit / Details"}</button></td>
                              <td className="px-2 py-2 align-top"><input type="checkbox" checked={normalizedRow.is_active !== false} onChange={(e) => updateRow(groupIndex, rowIndex, { is_active: e.target.checked })} /></td>
                              <td className="px-2 py-2 align-top"><div className="min-w-[100px]"><button type="button" onClick={() => setGroups((current) => current.map((currentGroup, currentGroupIndex) => currentGroupIndex === groupIndex ? { ...currentGroup, items: (currentGroup.items ?? []).filter((_, index) => index !== rowIndex) } : currentGroup))} className="text-xs font-semibold text-red-700">Remove</button></div></td>
                            </tr>
                            {expanded ? <tr key={`${normalizedRow.id}-details`} className="border-t border-zinc-200 bg-zinc-50"><td colSpan={directGroup ? 12 : priceCategories.length + 10} className="p-3"><div className="grid gap-3 md:grid-cols-2"><div className="md:col-span-2"><AutoGrowTextarea value={normalizedRow.specification ?? ""} onChange={(value) => updateRow(groupIndex, rowIndex, { specification: value })} minHeightClass="min-h-[64px]" rows={3} widthClass="min-w-0 w-full" /></div><ImportantRequirementsTextarea value={normalizedRow.importantRequirements} onChange={(importantRequirements) => updateRow(groupIndex, rowIndex, { importantRequirements })} /></div></td></tr> : null}
                          </>);
                        })}
                      </tbody>
                    </table>
                  </SyncedHorizontalScrollContainer></div>
                ) : (
                  <div className="mt-4 rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                    <p>No modular item rows in this group yet.</p>
                  </div>
                )}
                <button type="button" onClick={(event) => addRow(groupIndex, event)} className="mt-4 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
                  + Add modular item
                </button>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
            <p>No modular item groups yet.</p>
          </div>
        )}
        <button type="button" onClick={addGroup} className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
          + Add modular item group
        </button>
      </div>
      {referenceTargetGroup && referenceTargetGroupId ? <PricingGroupReferenceImages templateId={templateId} pricingType="modular" groupId={referenceTargetGroupId} groupLabel={referenceTargetGroup.group_name ?? "Modular Items"} onClose={() => setReferenceTargetGroupId(null)} /> : null}
    </div>
  );
}

function AccessoryConditionalRuleEditor({
  baseModelGroups,
  categoryPricingGroups,
  modularPricingGroups,
  workstationPricingGroups,
  group,
  onChange,
}: {
  baseModelGroups: BaseModelPricingGroup<VariantPricingRow>[];
  categoryPricingGroups: CategoryPricingRow[];
  modularPricingGroups: CategoryPricingRow[];
  workstationPricingGroups: WorkstationPricingGroup<WorkstationPricingRow>[];
  group: AccessoryPricingRow;
  onChange: (group: AccessoryPricingRow) => void;
}) {
  const [modelsOpen, setModelsOpen] = useState(false);
  const [pendingModelKeys, setPendingModelKeys] = useState<Set<string>>(new Set());
  const configuration = group.conditional_configuration;
  const [rulesCollapsed, setRulesCollapsed] = useState(() => Boolean(configuration?.applicability.length));
  /* Legacy single-select formatter retired in favor of shared target choices.
    if (row.is_active === false || !baseGroup.id || !row.id) return [];
    const details = [row.display_name || row.variant_name || "Unnamed model", row.supplier_price_list_code, row.dimension].filter(Boolean);
    return [{
      baseModelGroupId: baseGroup.id,
      baseModelRowId: row.id,
      key: `${baseGroup.id}\u0000${row.id}`,
      label: `${baseGroup.group_name} / ${details.join(" — ")}`,
    }];
  })); */
  const modelChoices = applicabilityTargetChoices(baseModelGroups, categoryPricingGroups, modularPricingGroups, workstationPricingGroups);
  const choiceByKey = new Map(modelChoices.map((choice) => [choice.key, choice]));
  const ruleKey = (rule: NonNullable<typeof configuration>["applicability"][number]) => {
    const target = resolveAccessoryApplicabilityTarget(rule);
    return target ? accessoryApplicabilityTargetKey(target) : "";
  };
  const selectedKeys = new Set((configuration?.applicability ?? []).map(ruleKey).filter(Boolean));
  const requiredRuleCount = (configuration?.applicability ?? []).filter((rule) => rule.required).length;
  const unavailableRuleCount = (configuration?.applicability ?? []).filter((rule) => !choiceByKey.has(ruleKey(rule))).length;
  const summaryCodes = (configuration?.applicability ?? []).flatMap((rule) => choiceByKey.get(ruleKey(rule))?.code ?? []).slice(0, 3);
  const staleItemIds = staleAccessoryRuleItemIds(group as AccessoryConfigurationGroup);

  function update(transform: (current: AccessoryConfigurationGroup) => AccessoryConfigurationGroup) {
    onChange(transform(group as AccessoryConfigurationGroup) as AccessoryPricingRow);
  }

  useEffect(() => {
    if (!modelsOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setModelsOpen(false); };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [modelsOpen]);

  return (
    <>
    <details className="mt-3 border-t border-zinc-100 pt-3">
      <summary className="cursor-pointer text-xs font-semibold text-emerald-900">Advanced Configuration / Conditional Rules</summary>
      <div className="mt-3 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
        {!modelChoices.length ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Conditional configuration rules require Base / Model, Category / Matrix, Modular, or Workstation pricing.
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
          <input
            type="checkbox"
            checked={Boolean(configuration)}
            disabled={!modelChoices.length && !configuration}
            onChange={(event) => update((current) => setAccessoryConditionalEnabled(current, event.target.checked))}
          />
          Use pricing-row configuration rules
        </label>
        {configuration ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-zinc-600">
                <span className="font-semibold text-zinc-700">Configuration Type</span>
                <select
                  value={configuration.role}
                  onChange={(event) => update((current) => setAccessoryConfigurationRole(current, event.target.value as AccessoryConfigurationRole))}
                  className="mt-1 h-9 w-full border border-zinc-300 bg-white px-2 outline-none focus:border-emerald-800"
                >
                  <option value="accessory">Normal Accessory</option>
                  <option value="conditional_option">Conditional Option</option>
                  <option value="companion">Required Companion</option>
                </select>
              </label>
              <label className="block text-xs text-zinc-600">
                <span className="font-semibold text-zinc-700">Selection Rule</span>
                <select
                  value={configuration.selection}
                  onChange={(event) => update((current) => setAccessorySelectionMode(current, event.target.value as AccessorySelectionMode))}
                  className="mt-1 h-9 w-full border border-zinc-300 bg-white px-2 outline-none focus:border-emerald-800"
                >
                  <option value="unrestricted">Unrestricted</option>
                  <option value="exactly_one">Exactly One</option>
                  <option value="at_least_one">At Least One</option>
                  <option value="choose_multiple">Multiple</option>
                </select>
              </label>
            </div>
            <div className="rounded-md border border-emerald-100 bg-emerald-50/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0"><p className="text-xs font-semibold text-emerald-950">Applicable Models</p>{configuration.applicability.length ? <><p className="mt-1 text-[11px] text-emerald-800">{configuration.applicability.length} selected · {requiredRuleCount} required{unavailableRuleCount ? ` · ⚠ ${unavailableRuleCount} unavailable` : ""}</p>{summaryCodes.length ? <p className="mt-0.5 truncate text-[11px] text-emerald-800">{summaryCodes.join(", ")}{configuration.applicability.length > summaryCodes.length ? ` +${configuration.applicability.length - summaryCodes.length} more` : ""}</p> : null}</> : <p className="mt-1 text-[11px] text-emerald-800">Choose a pricing row.</p>}</div>
                <div className="flex gap-2"><button type="button" onClick={() => { setPendingModelKeys(new Set(selectedKeys)); setModelsOpen(true); }} className="h-8 rounded border border-emerald-200 bg-white px-2 text-xs font-semibold text-emerald-900">Edit</button>{configuration.applicability.length ? <button type="button" aria-expanded={!rulesCollapsed} onClick={() => setRulesCollapsed((current) => !current)} className="h-8 rounded border border-emerald-200 bg-white px-2 text-xs font-semibold text-emerald-900">{rulesCollapsed ? "Show" : "Hide"}</button> : null}</div>
              </div>
              {!rulesCollapsed ? <div className="mt-3 space-y-1 border-t border-emerald-100 pt-3">
              {configuration.applicability.map((rule, ruleIndex) => {
                const model = choiceByKey.get(ruleKey(rule));
                const usesSpecificItems = rule.allowed_item_ids !== undefined;
                return (
                  <div key={ruleKey(rule) || `unavailable:${ruleIndex}`} className="rounded border border-zinc-200 bg-white p-2">
                    <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto_minmax(8rem,auto)_minmax(6rem,auto)_auto] sm:items-end">
                      <div><p className={`text-xs font-semibold ${model ? "text-zinc-900" : "text-amber-800"}`}>{model ? applicabilityTargetChoiceLabel(model) : "Unavailable model target · ⚠"}</p>{model ? <p className="mt-0.5 text-[10px] text-zinc-500">{model.groupLabel}</p> : <p className="mt-0.5 text-[10px] text-amber-700">Preserved until corrected.</p>}</div>
                      <label className="flex items-center gap-1 text-xs text-zinc-700">
                        <input type="checkbox" checked={configuration.role === "companion" || rule.required} disabled={configuration.role === "companion"} onChange={(event) => update((current) => updateAccessoryApplicabilityRule(current, ruleIndex, { required: event.target.checked }))} />
                        Required
                      </label>
                      <label className="block text-xs text-zinc-600">
                        <span className="font-semibold text-zinc-700">Allowed Items</span>
                        <select
                          value={usesSpecificItems ? "specific" : "all"}
                          onChange={(event) => update((current) => setAccessoryRuleAllowedItems(current, ruleIndex, event.target.value === "all" ? null : []))}
                          className="mt-1 h-8 w-full border border-zinc-300 bg-white px-2 outline-none focus:border-emerald-800"
                        >
                          <option value="all">All Items</option>
                          <option value="specific">Specific Items</option>
                        </select>
                      </label>
                      <label className="block text-xs text-zinc-600">
                        <span className="font-semibold text-zinc-700">Fixed Qty</span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={rule.fixed_quantity ?? ""}
                          onChange={(event) => update((current) => updateAccessoryApplicabilityRule(current, ruleIndex, { fixed_quantity: event.target.value ? Math.max(1, Math.trunc(Number(event.target.value) || 1)) : undefined }))}
                          className="mt-1 h-8 w-20 border border-zinc-300 bg-white px-2 outline-none focus:border-emerald-800"
                        />
                      </label>
                      <button type="button" onClick={() => update((current) => removeAccessoryApplicabilityRule(current, ruleIndex))} className="text-xs font-semibold text-red-700">Remove</button></div>
                    {configuration.selection === "exactly_one" && rule.fixed_quantity !== undefined && rule.fixed_quantity !== 1 ? <p className="mt-2 text-[11px] text-red-700">Exactly One requires a fixed quantity of 1.</p> : null}
                    {usesSpecificItems ? (
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                        {(group.items ?? []).map((item) => {
                          const itemId = item.id ?? "";
                          const checked = rule.allowed_item_ids?.includes(itemId) ?? false;
                          return (
                            <label key={itemId} className="flex items-center gap-2 text-xs text-zinc-700">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => update((current) => setAccessoryRuleAllowedItems(current, ruleIndex, event.target.checked ? [...(rule.allowed_item_ids ?? []), itemId] : (rule.allowed_item_ids ?? []).filter((id) => id !== itemId)))}
                              />
                              {item.item_name || "Unnamed accessory"}
                            </label>
                          );
                        })}
                        {!(group.items ?? []).length ? <p className="text-[11px] text-amber-700">Add accessory items before restricting this rule.</p> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!configuration.applicability.length ? <p className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-500">No applicable models configured.</p> : null}
              </div> : null}
            </div>
            {staleItemIds.length ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">One or more allowed items were removed. Update the affected rule before saving.</p> : null}
          </>
        ) : null}
      </div>
    </details>
    {modelsOpen ? <div role="dialog" aria-modal="true" aria-label="Choose applicable models" className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setModelsOpen(false); }}><div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white p-4 shadow-xl"><div><h3 className="font-semibold">Applicable Models</h3><p className="mt-1 text-xs text-zinc-500">Choose a pricing row for this configuration.</p></div><div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto border-y border-zinc-100 py-2">{[...new Map(modelChoices.map((choice) => [`${choice.kind}\u0000${choice.groupId}`, choice])).values()].map((groupChoice) => <div key={`${groupChoice.kind}:${groupChoice.groupId}`}><p className="px-2 text-[10px] font-bold uppercase text-zinc-500">{groupChoice.kind === "base_model" ? "Base / Model" : groupChoice.kind === "price_matrix" ? "Category / Matrix" : groupChoice.kind === "modular" ? "Modular" : "Workstation"} — {groupChoice.groupLabel}</p>{modelChoices.filter((choice) => choice.kind === groupChoice.kind && choice.groupId === groupChoice.groupId).map((choice) => <label key={choice.key} className="flex cursor-pointer items-start gap-2 rounded p-2 text-sm hover:bg-zinc-50"><input type="checkbox" checked={pendingModelKeys.has(choice.key)} onChange={(event) => setPendingModelKeys((current) => { const next = new Set(current); if (event.target.checked) next.add(choice.key); else next.delete(choice.key); return next; })} /><span>{choice.code ? <><strong>{choice.code}</strong>{choice.displayName !== choice.code ? ` — ${choice.displayName}` : ""}</> : choice.displayName}</span></label>)}</div>)}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setModelsOpen(false)} className="rounded border border-zinc-300 px-3 py-2 text-sm font-semibold">Cancel</button><button type="button" onClick={() => { update((current) => setAccessoryApplicabilityTargets(current, modelChoices, pendingModelKeys)); setModelsOpen(false); }} className="rounded bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Done</button></div></div></div> : null}
    </>
  );
}

function accessoryGroupSummary(group: AccessoryPricingRow) {
  const itemCount = group.items?.length ?? 0;
  const configuration = group.conditional_configuration;
  if (!configuration) return `Normal Accessory · ${group.group_is_required ? "Required" : "Optional"} · ${itemCount} items`;
  const role = configuration.role === "conditional_option" ? "Conditional Option" : configuration.role === "companion" ? "Required Companion" : "Normal Accessory";
  const selection = configuration.selection === "exactly_one" ? "Exactly One" : configuration.selection === "at_least_one" ? "At Least One" : configuration.selection === "choose_multiple" ? "Multiple" : "Optional";
  return `${role} · ${selection} · ${itemCount} items`;
}

export function AccessoryPricingTable({
  baseModelGroups = [],
  categoryPricingGroups = [],
  modularPricingGroups = [],
  workstationPricingGroups = [],
  brandDefaultCurrency,
  onHasDataChange,
  replacementGroups,
  replacementVersion,
  rows,
  templateId,
  templateIsPersisted,
  templateCurrency,
}: {
  baseModelGroups?: BaseModelPricingGroup<VariantPricingRow>[];
  categoryPricingGroups?: CategoryPricingRow[];
  modularPricingGroups?: CategoryPricingRow[];
  workstationPricingGroups?: WorkstationPricingGroup<WorkstationPricingRow>[];
  brandDefaultCurrency?: string | null;
  onHasDataChange?: (hasAccessoryPricingData: boolean) => void;
  replacementGroups?: AccessoryPricingRow[] | null;
  replacementVersion?: number;
  rows?: AccessoryPricingRow[] | null;
  templateId: string;
  templateIsPersisted: boolean;
  templateCurrency?: string | null;
}) {
  const initialGroups = useMemo(() => normalizeAccessoryGroups(rows), [rows]);
  const importedIdsRef = useRef<Set<string>>(new Set());
  const [groups, setGroups] = useState<AccessoryPricingRow[]>(() => initialGroups);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(initialGroups.map((group, index) => [group.id ?? `add-on-group-${index}`, true])));
  const [collapsedAccessorySubgroups, setCollapsedAccessorySubgroups] = useState<Record<string, boolean>>(() => Object.fromEntries(initialGroups.flatMap((group) => (group.subgroups ?? []).map((subgroup) => [subgroup.id, true]))));
  const [groupActionNotices, setGroupActionNotices] = useState<Record<string, string>>({});
  const [referenceTargetGroupId, setReferenceTargetGroupId] = useState<string | null>(null);
  const persistedGroupIds = useMemo(() => persistedPricingGroupIds(rows, "accessory"), [rows]);
  const appliedReplacementVersion = useRef<number | undefined>(undefined);
  const userEditedCurrencyItemIds = useRef<Set<string>>(new Set());
  const previousDefaultCurrencyRef = useRef(
    resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: initialGroups.flatMap((group) => group.items ?? []),
      savedTemplateCurrency: templateCurrency,
    }),
  );
  const serialized = useMemo(() => {
    const normalized = groups.map(normalizeAccessoryGroup);
    const parsed = parseAccessoryConfigurationGroups(normalized);
    return JSON.stringify(parsed.valid ? serializeAccessoryConfigurationGroups(parsed.groups) : normalized);
  }, [groups]);

  useEffect(() => {
    if (replacementVersion === undefined || replacementVersion === appliedReplacementVersion.current) return;
    appliedReplacementVersion.current = replacementVersion;
    setGroups(normalizeAccessoryGroups(replacementGroups));
    setCollapsedGroups(Object.fromEntries(normalizeAccessoryGroups(replacementGroups).map((group, index) => [group.id ?? `add-on-group-${index}`, true])));
    setCollapsedAccessorySubgroups(Object.fromEntries(normalizeAccessoryGroups(replacementGroups).flatMap((group) => (group.subgroups ?? []).map((subgroup) => [subgroup.id, true]))));
    setGroupActionNotices({});
    setReferenceTargetGroupId(null);
    importedIdsRef.current = new Set();
    userEditedCurrencyItemIds.current = new Set();
  }, [replacementGroups, replacementVersion]);

  useEffect(() => {
    onHasDataChange?.(hasMeaningfulAccessoryPricing(groups));
  }, [groups, onHasDataChange]);

  useEffect(() => {
    const handleApply = (event: Event) => {
      const detail = (event as CustomEvent<{
        action: string;
        draft: QuotationRowImportDraft;
        templateId: string;
      }>).detail;

      if (!detail || detail.templateId !== templateId || detail.action !== "accessory") {
        return;
      }

      const group = normalizeAccessoryGroup({
        id: idFor("add-on-group", groups.length),
        group_name: "Imported accessories",
        is_active: true,
        sort_order: groups.length,
        items: [
          {
            id: idFor("add-on", 0),
            item_name: detail.draft.item_name_snapshot || detail.draft.model_snapshot || "Imported accessory",
            price: Number(detail.draft.unit_price) || 0,
            currency: normalizeCurrency(detail.draft.currency ?? templateCurrency ?? brandDefaultCurrency ?? defaultCurrency),
            specification: detail.draft.specification_snapshot || "",
            is_active: true,
            sort_order: 0,
          },
        ],
      }, groups.length);

      importedIdsRef.current.add(group.id ?? "");
      setGroups((current) => [...current, group]);
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "accessory",
          status: "Accessory row added.",
          templateId,
        },
      }));
    };

    const handleReset = (event: Event) => {
      const detail = (event as CustomEvent<{ templateId: string }>).detail;
      if (!detail || detail.templateId !== templateId) {
        return;
      }

      if (importedIdsRef.current.size) {
        setGroups((current) => current.filter((group) => !importedIdsRef.current.has(group.id ?? "")));
      }
      importedIdsRef.current = new Set();
      window.dispatchEvent(new CustomEvent(TEMPLATE_IMPORT_STATUS_EVENT, {
        detail: {
          action: "accessory",
          status: "",
          templateId,
        },
      }));
    };

    window.addEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
    window.addEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    return () => {
      window.removeEventListener(TEMPLATE_IMPORT_APPLY_EVENT, handleApply);
      window.removeEventListener(TEMPLATE_IMPORT_RESET_EVENT, handleReset);
    };
  }, [brandDefaultCurrency, groups.length, templateCurrency, templateId]);

  function updateGroup(index: number, patch: Partial<AccessoryPricingRow>) {
    setGroups((current) => current.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group));
  }

  function updateItem(groupIndex: number, itemIndex: number, patch: Partial<AccessoryPricingItem>) {
    if (typeof patch.currency === "string") {
      userEditedCurrencyItemIds.current.add(groups[groupIndex]?.items?.[itemIndex]?.id ?? `add-on-${groupIndex}-${itemIndex}`);
    }

    setGroups((current) =>
      current.map((group, currentGroupIndex) => {
        if (currentGroupIndex !== groupIndex) return group;

        return {
          ...group,
          items: (group.items ?? []).map((item, currentItemIndex) =>
            currentItemIndex === itemIndex ? { ...item, ...patch } : item,
          ),
        };
      }),
    );
  }

  function openReferenceImages(groupId: string) {
    const availability = pricingGroupReferenceAvailability({
      templateIsPersisted,
      persistedGroupIds,
      groupId,
    });
    if (!availability.available) {
      setGroupActionNotices((current) => ({ ...current, [groupId]: availability.message ?? "Reference images are unavailable." }));
      return;
    }
    setGroupActionNotices((current) => ({ ...current, [groupId]: "" }));
    setReferenceTargetGroupId(groupId);
  }

  const referenceTargetGroup = groups.find((group) => group.id === referenceTargetGroupId) ?? null;

  useEffect(() => {
    const allItems = groups.flatMap((group) => group.items ?? []);
    const nextDefaultCurrency = resolveDefaultPricingCurrency({
      brandDefaultCurrency,
      existingRows: allItems,
      savedTemplateCurrency: templateCurrency,
    });

    setGroups((current) => {
      let didChange = false;
      const nextGroups = current.map((group, groupIndex) => {
        const nextItems = (group.items ?? []).map((item, itemIndex) => {
          const key = item.id ?? `add-on-${groupIndex}-${itemIndex}`;
          if (userEditedCurrencyItemIds.current.has(key) || accessoryItemHasMeaningfulValues(item)) {
            return item;
          }

          const currentCurrency = item.currency?.trim() ? normalizeCurrency(item.currency) : null;
          const previousDefaultCurrency = previousDefaultCurrencyRef.current;
          if (
            currentCurrency &&
            currentCurrency !== previousDefaultCurrency &&
            currentCurrency !== defaultCurrency
          ) {
            return item;
          }

          if (currentCurrency === nextDefaultCurrency) {
            return item;
          }

          didChange = true;
          return {
            ...item,
            currency: nextDefaultCurrency,
          };
        });

        const groupChanged = nextItems.some((item, itemIndex) => item !== (group.items ?? [])[itemIndex]);
        if (!groupChanged) {
          return group;
        }

        return {
          ...group,
          items: nextItems,
        };
      });

      return didChange ? nextGroups : current;
    });

    previousDefaultCurrencyRef.current = nextDefaultCurrency;
  }, [brandDefaultCurrency, groups, templateCurrency]);

  return (
    <div className="md:col-span-2 xl:col-span-3">
      <input type="hidden" name="accessory_pricing" value={serialized} />
      <div className="space-y-4">
        {groups.map((group, groupIndex) => {
          const groupId = group.id ?? `add-on-group-${groupIndex}`;
          return (
          <div key={group.id ?? groupIndex} className="rounded-md border border-zinc-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-expanded={!collapsedGroups[groupId]} aria-label={collapsedGroups[groupId] ? "Expand accessory group" : "Collapse accessory group"} onClick={() => setCollapsedGroups((current) => ({ ...current, [groupId]: !current[groupId] }))} className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-700">{collapsedGroups[groupId] ? ">" : "v"}</button>
              <input value={group.group_name ?? ""} onChange={(e) => updateGroup(groupIndex, { group_name: e.target.value })} placeholder="Accessories / Optional Items" className="h-8 w-56 border border-zinc-200 px-2 text-sm font-semibold outline-none focus:border-emerald-800" />
              <label className="flex items-center gap-1 text-xs text-zinc-600">Categories <input value={(group.price_categories ?? []).map((category) => category.label).join(", ")} onChange={(event) => updateGroup(groupIndex, { price_categories: event.target.value.split(",").map((label) => label.trim()).filter(Boolean).map((label) => ({ id: label, label })) })} placeholder="B, C, Supreme" className="h-8 w-48 border border-zinc-200 px-2" /></label>
              <p className="text-xs text-zinc-500">{accessoryGroupSummary(group)}</p>
              <label className="flex items-center gap-2 text-xs text-zinc-600">
                <input type="checkbox" checked={group.is_active !== false} onChange={(e) => updateGroup(groupIndex, { is_active: e.target.checked })} />
                Active
              </label>
              {!group.conditional_configuration ? <label className="flex items-center gap-2 text-xs text-zinc-600" title="When on, user must select at least one item from this group before adding the product to a quotation">
                <input type="checkbox" checked={group.group_is_required === true} onChange={(e) => updateGroup(groupIndex, { group_is_required: e.target.checked })} />
                Required selection
              </label> : null}
              <button type="button" onClick={() => openReferenceImages(groupId)} className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-600 hover:text-emerald-900">Reference images</button>
              <button type="button" onClick={() => setGroups((current) => current.filter((_, index) => index !== groupIndex))} className="ml-auto text-xs font-semibold text-red-700">Remove group</button>
            </div>
            {!collapsedGroups[groupId] ? <>
            {groupActionNotices[groupId] ? <p role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{groupActionNotices[groupId]}</p> : null}
            <AccessoryConditionalRuleEditor baseModelGroups={baseModelGroups} categoryPricingGroups={categoryPricingGroups} modularPricingGroups={modularPricingGroups} workstationPricingGroups={workstationPricingGroups} group={group} onChange={(nextGroup) => setGroups((current) => current.map((entry, index) => index === groupIndex ? nextGroup : entry))} />
            <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50/40 p-3">
              <div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-emerald-950">Visual subgroups</p><p className="text-[10px] text-emerald-800">Organizational only; accessory rules and prices are unchanged.</p></div><button type="button" onClick={() => { const id = idFor("accessory-subgroup", group.subgroups?.length ?? 0); updateGroup(groupIndex, { subgroups: [...(group.subgroups ?? []), createBaseModelPricingSubgroup(id, "New Subgroup", group.subgroups?.length ?? 0)] }); setCollapsedAccessorySubgroups((current) => ({ ...current, [id]: false })); }} className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-900">+ Add Subgroup</button></div>
              {(group.subgroups ?? []).length ? <div className="mt-3 space-y-2">{[...(group.subgroups ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((subgroup) => <div key={subgroup.id} className="rounded-md border border-zinc-200 bg-white p-2"><div className="flex flex-wrap items-start gap-2"><button type="button" onClick={() => setCollapsedAccessorySubgroups((current) => ({ ...current, [subgroup.id]: !current[subgroup.id] }))} className="h-8 w-8 rounded border border-zinc-200 text-xs">{collapsedAccessorySubgroups[subgroup.id] ? ">" : "v"}</button><PricingSubgroupReferenceImage templateId={templateId} templateIsPersisted={templateIsPersisted} pricingType="accessory" groupId={groupId} subgroupId={subgroup.id} /><div className="min-w-52 flex-1"><input value={subgroup.subgroup_name} onChange={(event) => updateGroup(groupIndex, { subgroups: (group.subgroups ?? []).map((entry) => entry.id === subgroup.id ? { ...entry, subgroup_name: event.target.value } : entry) })} className="h-8 w-full border border-zinc-200 px-2 text-sm font-semibold outline-none focus:border-emerald-800" /><p className="mt-1 text-xs text-zinc-500">{subgroup.row_ids.length} items</p></div><label className="flex items-center gap-1 text-xs text-zinc-600"><input type="checkbox" checked={subgroup.is_active} onChange={(event) => updateGroup(groupIndex, { subgroups: (group.subgroups ?? []).map((entry) => entry.id === subgroup.id ? { ...entry, is_active: event.target.checked } : entry) })} />Active</label><button type="button" onClick={() => updateGroup(groupIndex, { subgroups: (group.subgroups ?? []).filter((entry) => entry.id !== subgroup.id) })} className="text-xs font-semibold text-red-700">Remove subgroup</button></div>{!collapsedAccessorySubgroups[subgroup.id] ? <div className="mt-2 space-y-1 border-t border-zinc-100 pt-2">{(group.items ?? []).filter((item) => item.id && subgroup.row_ids.includes(item.id)).map((item) => <p key={item.id} className="text-xs text-zinc-700">{item.supplier_price_list_code ? `${item.supplier_price_list_code} — ` : ""}{item.item_name}</p>)}</div> : null}</div>)}</div> : null}
            </div>
            <div className="mt-3">
              <SyncedHorizontalScrollContainer>
              <table className="min-w-[1600px] w-full text-left text-xs">
                <thead className="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
                  <tr>
                    <th className="w-20 px-2 py-2">Image</th>
                    <th className="px-2 py-2">Accessory name</th>
                    <th className="px-2 py-2">Supplier / Price List Code</th>
                    <th className="px-2 py-2">Dimension</th>
                    <th className="px-2 py-2">Price</th>
                    <th className="px-2 py-2">Currency</th>
                    <th className="px-2 py-2">Details</th>
                    <th className="px-2 py-2">Active</th>
                    <th className="px-2 py-2">Subgroup</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(group.items ?? []).map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => { const subgroup = (group.subgroups ?? []).find((entry) => item.id && entry.row_ids.includes(item.id)); return !subgroup || collapsedAccessorySubgroups[subgroup.id] === false; }).map(({ item, itemIndex }) => (
                    <tr key={item.id ?? itemIndex} className="border-t border-zinc-100 align-top">
                      <td className="px-2 py-2 align-top">{group.id && item.id ? <PricingRowReferenceImage templateId={templateId} templateIsPersisted={templateIsPersisted} pricingType="accessory" groupId={group.id} rowId={item.id} /> : <span className="text-[10px] text-zinc-400">Save row first</span>}</td>
                      <td className="px-2 py-2 align-top"><AutoGrowTextarea value={item.item_name ?? ""} onChange={(value) => updateItem(groupIndex, itemIndex, { item_name: value })} minHeightClass="min-h-[44px]" rows={2} widthClass="min-w-[260px]" /></td>
                      <td className="px-2 py-2 align-top"><input value={item.supplier_price_list_code ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { supplier_price_list_code: e.target.value })} className="h-10 min-w-[190px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                      <td className="px-2 py-2 align-top"><input value={item.dimension ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { dimension: e.target.value })} className="h-10 min-w-[180px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" /></td>
                      <td className="px-2 py-2 align-top">{(group.price_categories ?? []).length ? <div className="flex min-w-[220px] flex-wrap gap-1">{(group.price_categories ?? []).map((category) => <label key={category.id} className="text-[10px] text-zinc-600">{category.label}<input type="number" value={item.prices?.[category.id] ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { prices: { ...item.prices, [category.id]: parseNullablePricingNumber(e.target.value) } })} className="ml-1 h-8 w-16 border border-zinc-200 px-1" /></label>)}</div> : <input type="number" value={item.price ?? ""} onChange={(e) => updateItem(groupIndex, itemIndex, { price: parseNullablePricingNumber(e.target.value) })} className="h-10 min-w-[120px] border border-zinc-200 px-3 outline-none focus:border-emerald-800" />}</td>
                      <td className="px-2 py-2 align-top"><div className="min-w-[110px]"><CurrencySelect value={item.currency} onChange={(currency) => updateItem(groupIndex, itemIndex, { currency })} /></div></td>
                      <td className="px-2 py-2 align-top"><details><summary className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-xs font-semibold text-emerald-900">Edit / Details</summary><div className="mt-2 min-w-[360px]"><AutoGrowTextarea value={item.specification ?? ""} onChange={(value) => updateItem(groupIndex, itemIndex, { specification: value })} minHeightClass="min-h-[64px]" rows={3} widthClass="min-w-[360px]" /><ImportantRequirementsTextarea value={item.importantRequirements} onChange={(importantRequirements) => updateItem(groupIndex, itemIndex, { importantRequirements })} /></div></details></td>
                      <td className="px-2 py-2 align-top"><input type="checkbox" checked={item.is_active !== false} onChange={(e) => updateItem(groupIndex, itemIndex, { is_active: e.target.checked })} /></td>
                      <td className="px-2 py-2 align-top"><select value={(group.subgroups ?? []).find((subgroup) => item.id && subgroup.row_ids.includes(item.id))?.id ?? ""} onChange={(event) => { const subgroupId = event.target.value || null; if (!item.id) return; updateGroup(groupIndex, { subgroups: (group.subgroups ?? []).map((subgroup) => ({ ...subgroup, row_ids: subgroup.id === subgroupId ? [...subgroup.row_ids.filter((id) => id !== item.id), item.id!] : subgroup.row_ids.filter((id) => id !== item.id) })) }); }} className="h-10 min-w-[180px] border border-zinc-200 bg-white px-2"><option value="">Ungrouped</option>{(group.subgroups ?? []).map((subgroup) => <option key={subgroup.id} value={subgroup.id}>{subgroup.subgroup_name}</option>)}</select></td>
                      <td className="px-2 py-2 align-top"><div className="min-w-[100px]"><button type="button" onClick={() => updateGroup(groupIndex, { items: (group.items ?? []).filter((_, index) => index !== itemIndex), subgroups: (group.subgroups ?? []).map((subgroup) => ({ ...subgroup, row_ids: subgroup.row_ids.filter((id) => id !== item.id) })) })} className="text-xs font-semibold text-red-700">Remove item</button></div></td>
                    </tr>
                  ))}
                  {!(group.items ?? []).length ? <tr><td colSpan={10} className="px-3 py-5 text-center text-zinc-500">No items in this group yet.</td></tr> : null}
                </tbody>
              </table>
              </SyncedHorizontalScrollContainer>
            </div>
            <button type="button" onClick={(event) => updateGroup(groupIndex, { items: [...(group.items ?? []), { id: idFor("add-on", group.items?.length ?? 0), currency: resolveDefaultPricingCurrency({ brandDefaultCurrency, existingRows: group.items ?? groups.flatMap((entry) => entry.items ?? []), savedTemplateCurrency: templateCurrency, trigger: event.currentTarget }), is_active: true, sort_order: group.items?.length ?? 0 }] })} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add Accessory</button>
            </> : null}
          </div>
          );
        })}
        {!groups.length ? <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">No accessories / optional items yet.</p> : null}
      </div>
      <button type="button" onClick={() => setGroups((current) => [...current, { id: idFor("add-on-group", current.length), group_name: "Accessories", is_active: true, sort_order: current.length, items: [] }])} className="mt-3 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">+ Add Accessory Group</button>
      {referenceTargetGroup && referenceTargetGroupId ? <PricingGroupReferenceImages templateId={templateId} pricingType="accessory" groupId={referenceTargetGroupId} groupLabel={referenceTargetGroup.group_name ?? "Accessories"} onClose={() => setReferenceTargetGroupId(null)} /> : null}
    </div>
  );
}
