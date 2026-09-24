/**
 * GPC-1: a single pure function that composes the EXISTING Product Library configuration
 * helpers (Base/Model, Native System/Base, Workstation, Category/Matrix, Modular, Accessory,
 * Required Companion, Structural Support) into one deterministic configuration-state result.
 *
 * This module owns NO business rule of its own - every price, compatibility, and validation
 * decision is delegated to the helper that already enforces it elsewhere (ProductLibrarySelector,
 * addProductTemplateToQuotation). It only decides ORDERING (which unresolved required step comes
 * next) and SHAPE (a step/option/issue/price/specification result a caller - eventually NOA - can
 * use without re-deriving business logic itself).
 *
 * Pure, alias-free (relative imports only), no React, no "use client", no server-only, no
 * database access. Every selection id is treated as untrusted: if it no longer resolves against
 * the current template data, it is dropped and reported in `staleSelections`, never guessed.
 */
import {
  accessoryApplicabilityTargetKey,
  parseAccessoryConfigurationGroups,
  structuralSupportCompatibleTargetKey,
  type AccessoryApplicabilityTarget,
  type AccessoryConfigurationItem,
  type AccessoryGroupEvaluation,
  type StructuralSupportCompatibleTarget,
} from "./accessory-conditional-configuration";
import {
  activeBaseModelPricingGroups,
  composeSystemAndMainSpecification,
  nativeBaseModelTargets,
  nativeSystemState,
  normalizeSystemQuantity,
  systemPriceContribution,
} from "../quotations/native-system-base";
import { guidedBaseModelSelection } from "../quotations/guided-base-model-selection";
import { baseModelPricingSubgroupForRow } from "./base-model-pricing-subgroups";
import type { BaseModelPricingRow, NormalizedBaseModelPricingGroup } from "./base-model-pricing-groups";
import { evaluateProductAccessorySelection } from "../quotations/product-accessory-configuration";
import {
  effectiveRequiredQuantities,
  requiredCompanionItems,
  requiredComponentTriggerKey,
  type RequiredComponentOverrides,
} from "../quotations/required-component-overrides";
import { groupedStandardCategoryPricingRows } from "./category-pricing-groups";
import {
  isDirectModularPricingGroup,
  modularCompositionRule,
  modularItemPricingGroups,
  modularPricingDefaultsFromRows,
  type ModularCategoryPricingShape,
} from "./modular-pricing";
import { validateModularCompositionGroups, type ModularCompositionIssue } from "./modular-composition";
import {
  findWorkstationPricingRow,
  workstationPricingGroups,
  type WorkstationPricingRow,
} from "./workstation-pricing-groups";
import { baseModelPriceOrDefault, roundSourceAmount, sameCurrencyUnitSum } from "../quotations/source-price-components";
import {
  buildCompanyStyleProductSpecification,
  buildModularCompositionSpecification,
  resolveProductDimensionSnapshot,
  resolveProductSpecificationSnapshot,
  type ProductSpecificationAccessoryInput,
} from "../quotations/product-template-snapshot";
import { normalizeCurrency } from "../currencies";

// ── Input types (bounded to configuration-relevant fields only - never the full selector shape) ─

export type ProductConfigurationTemplateInput = {
  id: string;
  templateName: string;
  internalSelectionName?: string | null;
  itemCode?: string | null;
  templateCode?: string | null;
  supplierName?: string | null;
  brandName?: string | null;
  origin?: string | null;
  currency: string;
  defaultUnitPrice: number;
  defaultSpecification?: string | null;
  description?: string | null;
  /** `product_templates.variant_pricing` (Base/Model + Native System/Base + Workstation variant rows). */
  variantPricing?: unknown;
  /** `product_templates.category_pricing` (Category/Matrix rows AND Modular rows/groups share this column). */
  categoryPricing?: unknown;
  /** `product_templates.accessory_pricing` (accessories, required companions, structural support). */
  accessoryPricing?: unknown;
  /** `product_templates.desking_size_pricing` (Workstation/Desking size groups). */
  deskingSizePricing?: unknown;
};

// ── Selection state (client-round-trippable identifiers only - never prices/totals/specs) ───────

export type ProductConfigurationSelections = {
  variantGroupId?: string | null;
  subgroupId?: string | null;
  variantRowId?: string | null;
  systemRowId?: string | null;
  systemQuantity?: number | null;
  categoryGroupId?: string | null;
  categoryRowId?: string | null;
  fabricCategory?: string | null;
  workstationGroupId?: string | null;
  deskingSizeId?: string | null;
  workstationVariantRowId?: string | null;
  modularQuantities?: Record<string, number>;
  accessoryQuantities?: Record<string, number>;
  skippedAccessoryGroupIds?: string[];
  requiredOverrides?: RequiredComponentOverrides;
  quantity?: number | null;
};

// ── Step / option model ───────────────────────────────────────────────────────────────────────

export type ProductConfigurationStepKind =
  | "system_base"
  | "variant_group"
  | "variant_subgroup"
  | "variant_row"
  | "workstation_size"
  | "workstation_variant"
  | "category_group"
  | "category_row"
  | "fabric_category"
  | "modular"
  | "structural_support"
  | "accessory"
  | "quantity";

export type ProductConfigurationOption = {
  id: string;
  label: string;
  dimension?: string | null;
  priceContribution?: number | null;
  // GPC-3.2: the currency THIS option's own priceContribution is actually denominated in - always
  // read from the same source row that produced the number (row.currency), falling back to the
  // template's own currency only when that row has none. Never the aggregate/current
  // `state.price.currency` (which reflects whatever is CURRENTLY selected elsewhere, not this
  // option) - that mismatch was GPC-3.2's proven root cause.
  priceCurrency?: string | null;
};

export type ProductConfigurationStep = {
  key: string;
  kind: ProductConfigurationStepKind;
  label: string;
  required: boolean;
  resolved: boolean;
  autoResolved: boolean;
  multi: boolean;
  options: ProductConfigurationOption[];
  groupId?: string;
  minSelections?: number;
  maxSelections?: number | null;
  selectedOptionIds?: string[];
};

export type ProductConfigurationAutoApplied = { stepKey: string; optionId: string; reason: string };
export type ProductConfigurationIssue = { code: string; message: string; stepKey?: string };
export type ProductConfigurationStaleSelection = { key: string; id: string; reason: string };

export type ProductConfigurationPrice = {
  base: number;
  system: number;
  workstationVariant: number;
  accessories: number;
  linked: number;
  unit: number;
  currency: string;
  /** Non-primary-currency amounts present but never converted (GPC-1 never guesses a rate). */
  missingExchangeRateCurrencies: string[];
};

export type ProductConfigurationState = {
  steps: ProductConfigurationStep[];
  nextRequiredStep: ProductConfigurationStep | null;
  optionalSteps: ProductConfigurationStep[];
  autoApplied: ProductConfigurationAutoApplied[];
  issues: ProductConfigurationIssue[];
  staleSelections: ProductConfigurationStaleSelection[];
  price: ProductConfigurationPrice;
  specification: string | null;
  dimension: string | null;
};

// Bounded shape for one category/matrix row - only the fields groupedStandardCategoryPricingRows
// and this engine actually read (never the full selector CategoryPricingRow type).
type CategoryPricingRowInput = {
  id?: string;
  group_id?: string;
  group_name?: string;
  variant_name?: string;
  display_name?: string;
  dimension?: string;
  currency?: string;
  prices?: Record<string, number | null>;
  unavailable_categories?: string[];
  specification?: string;
  is_active?: boolean;
  sort_order?: number;
  pricing_type?: string | null;
};

// Bounded shape for one modular row - the fields modular-pricing.ts's ModularCategoryPricingShape
// doesn't itself carry but this engine (and the existing selector) reads for label/price/spec.
type ModularRowInput = ModularCategoryPricingShape & {
  id?: string;
  variant_name?: string;
  display_name?: string;
  dimension?: string;
  currency?: string;
  prices?: Record<string, number | null>;
  specification?: string;
  importantRequirements?: string[];
};

// ── Small local helpers (arithmetic/labels only - never a business rule) ────────────────────────

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rowLabel(row: Record<string, unknown> | null | undefined, fallback: string): string {
  if (!row) return fallback;
  const candidates = [row.display_name, row.variant_name, row.label, row.group_name, row.dimension];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

function rowDimension(row: Record<string, unknown> | null | undefined): string | null {
  const dimension = row?.dimension;
  return typeof dimension === "string" && dimension.trim() ? dimension.trim() : null;
}

// GPC-3.2: the SAME source row that produced a priceContribution number is the only place its
// currency may come from - falls back to the template's own currency only when the row itself has
// none (PART 2's own precedence, not a new one). Reused everywhere a row without a typed
// `currency?: string` field (a generic Record) needs its price labelled correctly.
function rowCurrency(row: Record<string, unknown> | null | undefined, template: ProductConfigurationTemplateInput): string {
  const currency = row?.currency;
  return typeof currency === "string" && currency.trim() ? currency.trim() : template.currency;
}

// ── Main entry point ──────────────────────────────────────────────────────────────────────────

export function resolveProductConfigurationState(
  template: ProductConfigurationTemplateInput,
  selections: ProductConfigurationSelections = {},
): ProductConfigurationState {
  const currency = normalizeCurrency(template.currency);
  const steps: ProductConfigurationStep[] = [];
  const autoApplied: ProductConfigurationAutoApplied[] = [];
  const issues: ProductConfigurationIssue[] = [];
  const staleSelections: ProductConfigurationStaleSelection[] = [];

  // ── 1. Native System / Base ─────────────────────────────────────────────────────────────────
  const variantGroups = activeBaseModelPricingGroups(template.variantPricing ?? []) as NormalizedBaseModelPricingGroup<
    Record<string, unknown> & BaseModelPricingRow
  >[];
  const requestedSystemRowId = selections.systemRowId?.trim() || null;
  const nativeSystem = nativeSystemState(variantGroups, requestedSystemRowId);

  if (nativeSystem.active) {
    const systemRowExists = requestedSystemRowId
      ? nativeSystem.options.some((option) => option.row.id === requestedSystemRowId)
      : true;
    if (requestedSystemRowId && !systemRowExists) {
      staleSelections.push({ key: "systemRowId", id: requestedSystemRowId, reason: "System / Base row no longer exists on this template." });
    }
    const autoResolvedSystem = Boolean(nativeSystem.selected) && nativeSystem.options.length === 1 && (!requestedSystemRowId || !systemRowExists);
    if (autoResolvedSystem && nativeSystem.selected) {
      autoApplied.push({ stepKey: "system_base", optionId: nativeSystem.selected.row.id ?? "", reason: "Only one System / Base option is available." });
    }
    steps.push({
      key: "system_base",
      kind: "system_base",
      label: "System / Base",
      required: nativeSystem.requiresSystem,
      resolved: Boolean(nativeSystem.selected),
      autoResolved: autoResolvedSystem,
      multi: false,
      options: nativeSystem.options.map((option) => {
        const contribution = systemPriceContribution(option.row, currency, 1);
        return {
          id: option.row.id ?? "",
          label: rowLabel(option.row, option.row.id ?? "System / Base option"),
          dimension: rowDimension(option.row),
          priceContribution: roundSourceAmount(contribution.amount),
          // systemPriceContribution() already resolves row.currency ?? rowCurrency internally -
          // reused here rather than re-deriving it a second way.
          priceCurrency: contribution.currency,
        };
      }),
    });
  }

  // ── 2/3/4. Base / Model group / subgroup / row (via the eligible groups System/Base leaves) ──
  const eligibleVariantGroups = nativeSystem.eligibleGroups as NormalizedBaseModelPricingGroup<
    Record<string, unknown> & BaseModelPricingRow
  >[];
  const requestedVariantGroupId = selections.variantGroupId?.trim() || "";
  const requestedSubgroupId = selections.subgroupId?.trim() || "";
  const requestedVariantRowId = selections.variantRowId?.trim() || null;

  const guided = guidedBaseModelSelection(eligibleVariantGroups, requestedVariantGroupId, requestedSubgroupId);
  const resolvedVariantGroup = guided.group;

  if (eligibleVariantGroups.length > 0) {
    // guidedBaseModelSelection() always falls back to groups[0] internally (so downstream row/
    // subgroup derivation always has SOMETHING to work from) - that fallback is a display
    // convenience, never a real user choice, so "resolved" here is tracked independently: only
    // true when exactly one valid group exists (auto) or a real, non-stale id was supplied.
    const variantGroupStale = Boolean(requestedVariantGroupId) && !eligibleVariantGroups.some((group) => group.id === requestedVariantGroupId);
    const variantGroupExplicitlyResolved = eligibleVariantGroups.length === 1 || (Boolean(requestedVariantGroupId) && !variantGroupStale);
    const autoResolvedGroup = variantGroupExplicitlyResolved && eligibleVariantGroups.length === 1 && (!requestedVariantGroupId || variantGroupStale);
    if (autoResolvedGroup && resolvedVariantGroup) {
      autoApplied.push({ stepKey: "variant_group", optionId: resolvedVariantGroup.id, reason: "Only one Base / Model group is available." });
    }
    if (variantGroupStale) {
      staleSelections.push({ key: "variantGroupId", id: requestedVariantGroupId, reason: "Base / Model group no longer exists or is not eligible for the current selection." });
    }
    steps.push({
      key: "variant_group",
      kind: "variant_group",
      label: "Base / Model group",
      required: true,
      resolved: variantGroupExplicitlyResolved,
      autoResolved: autoResolvedGroup,
      multi: false,
      options: eligibleVariantGroups.map((group) => ({ id: group.id, label: group.group_name })),
    });
  }

  const hasUngroupedAlternative = guided.ungrouped.length > 0;
  if (resolvedVariantGroup && guided.subgroups.length > 0) {
    const subgroupStale = Boolean(requestedSubgroupId) && requestedSubgroupId !== "__ungrouped__" && !guided.subgroups.some((subgroup) => subgroup.id === requestedSubgroupId);
    const autoResolvedSubgroup = guided.subgroups.length === 1 && !hasUngroupedAlternative && (!requestedSubgroupId || subgroupStale);
    if (autoResolvedSubgroup) {
      autoApplied.push({ stepKey: "variant_subgroup", optionId: guided.subgroups[0].id, reason: "Only one subgroup is available." });
    }
    if (subgroupStale) {
      staleSelections.push({ key: "subgroupId", id: requestedSubgroupId, reason: "Subgroup no longer exists on this Base / Model group." });
    }
    const subgroupOptions: ProductConfigurationOption[] = guided.subgroups.map((subgroup) => ({ id: subgroup.id, label: subgroup.subgroup_name }));
    if (hasUngroupedAlternative) subgroupOptions.push({ id: "__ungrouped__", label: "Other" });
    steps.push({
      key: "variant_subgroup",
      kind: "variant_subgroup",
      label: "Base / Model subgroup",
      required: true,
      resolved: Boolean(guided.resolvedSubgroupId) && !subgroupStale,
      autoResolved: autoResolvedSubgroup,
      multi: false,
      options: subgroupOptions,
    });
  }

  let resolvedVariantRow: (Record<string, unknown> & BaseModelPricingRow) | null = null;
  if (resolvedVariantGroup) {
    const candidateRows = guided.rows.length ? guided.rows : resolvedVariantGroup.items;
    if (requestedVariantRowId) {
      const found = candidateRows.find((row) => row.id === requestedVariantRowId) ?? null;
      if (found) resolvedVariantRow = found;
      else staleSelections.push({ key: "variantRowId", id: requestedVariantRowId, reason: "Base / Model row no longer exists or is not valid for the current selection." });
    }
    const autoResolvedRow = !resolvedVariantRow && candidateRows.length === 1;
    if (autoResolvedRow) {
      resolvedVariantRow = candidateRows[0];
      autoApplied.push({ stepKey: "variant_row", optionId: resolvedVariantRow.id ?? "", reason: "Only one Base / Model row is available." });
    }
    steps.push({
      key: "variant_row",
      kind: "variant_row",
      label: "Base / Model",
      required: true,
      resolved: Boolean(resolvedVariantRow),
      autoResolved: autoResolvedRow,
      multi: false,
      options: candidateRows.map((row) => ({
        id: row.id ?? "",
        label: rowLabel(row, row.id ?? "Model option"),
        dimension: rowDimension(row),
        priceContribution: roundSourceAmount(baseModelPriceOrDefault(numberValue(row.price, NaN) || null, template.defaultUnitPrice)),
        priceCurrency: rowCurrency(row, template),
      })),
    });
  }
  const resolvedVariantGroupId = resolvedVariantGroup?.id ?? null;
  const resolvedSubgroupIdForRow = resolvedVariantRow?.id ? baseModelPricingSubgroupForRow(resolvedVariantGroup ?? { subgroups: [] }, resolvedVariantRow.id)?.id ?? null : null;

  // ── 5. Workstation / Desking size ───────────────────────────────────────────────────────────
  const workstationGroups = workstationPricingGroups<WorkstationPricingRow>(template.deskingSizePricing ?? []).filter((group) => group.is_active);
  let resolvedWorkstationRow: WorkstationPricingRow | null = null;
  if (workstationGroups.length > 0) {
    const requestedDeskingSizeId = selections.deskingSizeId?.trim() || null;
    const allWorkstationOptions = workstationGroups.flatMap((group) => group.items);
    if (requestedDeskingSizeId) {
      const found = findWorkstationPricingRow(template.deskingSizePricing ?? [], { groupId: selections.workstationGroupId ?? null, rowId: requestedDeskingSizeId });
      if (found) resolvedWorkstationRow = found.row;
      else staleSelections.push({ key: "deskingSizeId", id: requestedDeskingSizeId, reason: "Workstation size no longer exists on this template." });
    }
    const autoResolvedWorkstation = !resolvedWorkstationRow && allWorkstationOptions.length === 1;
    if (autoResolvedWorkstation) {
      resolvedWorkstationRow = allWorkstationOptions[0];
      autoApplied.push({ stepKey: "workstation_size", optionId: resolvedWorkstationRow.id ?? "", reason: "Only one Workstation size is available." });
    }
    steps.push({
      key: "workstation_size",
      kind: "workstation_size",
      label: "Workstation size",
      required: true,
      resolved: Boolean(resolvedWorkstationRow),
      autoResolved: autoResolvedWorkstation,
      multi: false,
      options: allWorkstationOptions.map((row, index) => ({
        id: row.id ?? `size-${index}`,
        label: rowLabel(row, row.id ?? "Workstation size"),
        dimension: rowDimension(row),
        priceContribution: roundSourceAmount(numberValue(row.default_price)),
        priceCurrency: rowCurrency(row, template),
      })),
    });
  }

  // Workstation variant: an additive row picked from the SAME variant_pricing groups (optional,
  // never gates other steps - matches the existing selector's separate, non-blocking usage).
  const allActiveVariantRows = variantGroups.flatMap((group) => group.items);
  let resolvedWorkstationVariantRow: (Record<string, unknown> & BaseModelPricingRow) | null = null;
  const requestedWorkstationVariantRowId = selections.workstationVariantRowId?.trim() || null;
  if (requestedWorkstationVariantRowId) {
    const found = allActiveVariantRows.find((row) => row.id === requestedWorkstationVariantRowId) ?? null;
    if (found) resolvedWorkstationVariantRow = found;
    else staleSelections.push({ key: "workstationVariantRowId", id: requestedWorkstationVariantRowId, reason: "Workstation variant row no longer exists on this template." });
  }

  // ── 6/7/8. Category / Matrix group, row, finish column ──────────────────────────────────────
  // Modular groups share the same category_pricing column; groupedStandardCategoryPricingRows
  // strips their modular-typed items but (since group_name is still set) can still return an
  // empty-items group entry for a purely-modular group. Excluded here - PART 4 explicitly forbids
  // fabricating an empty step, and an item-less "category" question is never a real question.
  const categoryGroups = groupedStandardCategoryPricingRows<CategoryPricingRowInput>(
    (template.categoryPricing as Array<CategoryPricingRowInput> | null) ?? [],
  ).filter((group) => group.is_active && group.items.length > 0);
  let resolvedCategoryRow: CategoryPricingRowInput | null = null;
  let resolvedCategoryGroup: (typeof categoryGroups)[number] | null = null;
  let resolvedFabricCategory: string | null = null;

  if (categoryGroups.length > 0) {
    const requestedCategoryGroupId = selections.categoryGroupId?.trim() || "";
    const categoryGroupStale = Boolean(requestedCategoryGroupId) && !categoryGroups.some((group) => group.id === requestedCategoryGroupId);
    resolvedCategoryGroup = (requestedCategoryGroupId ? categoryGroups.find((group) => group.id === requestedCategoryGroupId) : null)
      ?? (categoryGroups.length === 1 ? categoryGroups[0] : null);
    const autoResolvedCategoryGroup = Boolean(resolvedCategoryGroup) && categoryGroups.length === 1 && (!requestedCategoryGroupId || categoryGroupStale);
    if (autoResolvedCategoryGroup && resolvedCategoryGroup) {
      autoApplied.push({ stepKey: "category_group", optionId: resolvedCategoryGroup.id, reason: "Only one Category group is available." });
    }
    if (categoryGroupStale) {
      staleSelections.push({ key: "categoryGroupId", id: requestedCategoryGroupId, reason: "Category group no longer exists on this template." });
    }
    steps.push({
      key: "category_group",
      kind: "category_group",
      label: "Category",
      required: true,
      resolved: Boolean(resolvedCategoryGroup),
      autoResolved: autoResolvedCategoryGroup,
      multi: false,
      options: categoryGroups.map((group) => ({ id: group.id, label: group.group_name })),
    });

    if (resolvedCategoryGroup) {
      const requestedCategoryRowId = selections.categoryRowId?.trim() || null;
      const categoryRows = resolvedCategoryGroup.items;
      if (requestedCategoryRowId) {
        const found = categoryRows.find((row) => row.id === requestedCategoryRowId) ?? null;
        if (found) resolvedCategoryRow = found;
        else staleSelections.push({ key: "categoryRowId", id: requestedCategoryRowId, reason: "Category row no longer exists in this group." });
      }
      const autoResolvedCategoryRow = !resolvedCategoryRow && categoryRows.length === 1;
      if (autoResolvedCategoryRow) {
        resolvedCategoryRow = categoryRows[0];
        autoApplied.push({ stepKey: "category_row", optionId: resolvedCategoryRow.id ?? "", reason: "Only one Category row is available." });
      }
      steps.push({
        key: "category_row",
        kind: "category_row",
        label: "Category item",
        required: true,
        resolved: Boolean(resolvedCategoryRow),
        autoResolved: autoResolvedCategoryRow,
        multi: false,
        options: categoryRows.map((row) => ({ id: row.id ?? "", label: rowLabel(row, row.id ?? "Category item"), dimension: rowDimension(row) })),
      });

      if (resolvedCategoryRow) {
        const columns = (resolvedCategoryGroup.price_categories ?? []).filter(
          (category) => !resolvedCategoryRow!.unavailable_categories?.includes(category)
            && resolvedCategoryRow!.prices?.[category] !== null && resolvedCategoryRow!.prices?.[category] !== undefined,
        );
        const requestedFabricCategory = selections.fabricCategory?.trim() || null;
        if (requestedFabricCategory && columns.includes(requestedFabricCategory)) {
          resolvedFabricCategory = requestedFabricCategory;
        } else if (requestedFabricCategory) {
          staleSelections.push({ key: "fabricCategory", id: requestedFabricCategory, reason: "Finish category is not available for the selected item." });
        }
        const autoResolvedFabric = !resolvedFabricCategory && columns.length === 1;
        if (autoResolvedFabric) {
          resolvedFabricCategory = columns[0];
          autoApplied.push({ stepKey: "fabric_category", optionId: columns[0], reason: "Only one finish category is available." });
        }
        if (columns.length > 0) {
          steps.push({
            key: "fabric_category",
            kind: "fabric_category",
            label: "Finish category",
            required: true,
            resolved: Boolean(resolvedFabricCategory),
            autoResolved: autoResolvedFabric,
            multi: false,
            options: columns.map((category) => ({
              id: category,
              label: category,
              priceContribution: roundSourceAmount(numberValue(resolvedCategoryRow!.prices?.[category])),
              priceCurrency: rowCurrency(resolvedCategoryRow as Record<string, unknown>, template),
            })),
          });
        }
      }
    }
  }

  // ── 9. Modular modules ───────────────────────────────────────────────────────────────────────
  const modularGroups = modularItemPricingGroups<ModularRowInput>(
    (template.categoryPricing as ModularRowInput[] | null) ?? [],
  ).filter((group) => group.is_active);
  const modularQuantities = selections.modularQuantities ?? {};
  const modularQuantityForRow = (rowId: string) => Math.max(0, Math.trunc(numberValue(modularQuantities[rowId])));

  type SelectedModularLine = { groupId: string; row: Record<string, unknown>; id: string; qty: number; total: number };
  const selectedModularItems: SelectedModularLine[] = [];
  const usesModularPricing = modularGroups.length > 0;

  if (usesModularPricing) {
    const knownModularRowIds = new Set(modularGroups.flatMap((group) => (group.items ?? []).flatMap((item) => (typeof item.id === "string" && item.id ? [item.id] : []))));
    for (const rowId of Object.keys(modularQuantities)) {
      if (numberValue(modularQuantities[rowId]) > 0 && !knownModularRowIds.has(rowId)) {
        staleSelections.push({ key: "modularQuantities", id: rowId, reason: "Modular row no longer exists on this template." });
      }
    }

    // Matrix-priced modular rows are category-priced too, but when a template has NO standalone
    // category/matrix dimension (only modular rows) the fabric_category step above is never
    // pushed, since it's derived from groupedStandardCategoryPricingRows only. Fall back to
    // deriving the same column set directly from the modular rows' own `prices` keys - the exact
    // set the existing selector's own categoryPriceColumns() merges in for this same reason.
    const hasMatrixModularGroup = modularGroups.some((group) => !isDirectModularPricingGroup(group));
    if (!resolvedFabricCategory && hasMatrixModularGroup) {
      const modularColumns = Array.from(new Set(
        modularGroups.filter((group) => !isDirectModularPricingGroup(group))
          .flatMap((group) => group.items ?? [])
          .flatMap((row) => Object.keys(row.prices ?? {})),
      ));
      const requestedFabricCategory = selections.fabricCategory?.trim() || null;
      if (requestedFabricCategory && modularColumns.includes(requestedFabricCategory)) {
        resolvedFabricCategory = requestedFabricCategory;
      } else if (requestedFabricCategory) {
        staleSelections.push({ key: "fabricCategory", id: requestedFabricCategory, reason: "Finish category is not available for this modular composition." });
      }
      const autoResolvedModularFabric = !resolvedFabricCategory && modularColumns.length === 1;
      if (autoResolvedModularFabric) {
        resolvedFabricCategory = modularColumns[0];
        autoApplied.push({ stepKey: "fabric_category", optionId: modularColumns[0], reason: "Only one finish category is available." });
      }
      if (modularColumns.length > 0) {
        steps.push({
          key: "fabric_category",
          kind: "fabric_category",
          label: "Finish category",
          required: true,
          resolved: Boolean(resolvedFabricCategory),
          autoResolved: autoResolvedModularFabric,
          multi: false,
          options: modularColumns.map((category) => ({ id: category, label: category })),
        });
      }
    }

    const compositionIssue: ModularCompositionIssue | null = validateModularCompositionGroups(
      modularGroups,
      (groupId, rowId) => (modularGroups.some((group) => group.id === groupId && (group.items ?? []).some((item) => item.id === rowId)) ? modularQuantityForRow(rowId) : 0),
    );
    if (compositionIssue) issues.push({ code: compositionIssue.code, message: compositionIssue.message, stepKey: "modular" });

    for (const group of modularGroups) {
      const direct = isDirectModularPricingGroup(group);
      const rule = modularCompositionRule(group);
      const options: ProductConfigurationOption[] = (group.items ?? []).map((row, index) => {
        const id = (typeof row.id === "string" && row.id) || `modular-row-${index}`;
        const qty = modularQuantityForRow(id);
        const unitPrice = direct ? numberValue(row.price) : numberValue(resolvedFabricCategory ? row.prices?.[resolvedFabricCategory] : 0);
        if (qty > 0) selectedModularItems.push({ groupId: group.id ?? "", row: row as Record<string, unknown>, id, qty, total: roundSourceAmount(qty * unitPrice) });
        return {
          id,
          label: rowLabel(row as Record<string, unknown>, id),
          dimension: rowDimension(row as Record<string, unknown>),
          priceContribution: roundSourceAmount(unitPrice),
          priceCurrency: rowCurrency(row as Record<string, unknown>, template),
        };
      });
      const groupHasSelection = options.some((option) => modularQuantityForRow(option.id) > 0);
      const required = Boolean(rule && rule.minStarters > 0);
      steps.push({
        key: `modular:${group.id}`,
        kind: "modular",
        label: group.group_name,
        required,
        resolved: !required || groupHasSelection,
        autoResolved: false,
        multi: true,
        options,
      });
    }
  }

  // ── Structural support compatibility target for the CURRENT Base/Model selection ────────────
  const currentSupportTargets: StructuralSupportCompatibleTarget[] = [];
  if (resolvedVariantRow?.id && resolvedVariantGroupId) {
    currentSupportTargets.push({ kind: "base_model", group_id: resolvedVariantGroupId, row_id: resolvedVariantRow.id });
  }
  if (resolvedSubgroupIdForRow && resolvedVariantGroupId) {
    currentSupportTargets.push({ kind: "base_model_subgroup", group_id: resolvedVariantGroupId, row_id: resolvedSubgroupIdForRow });
  }
  const currentSupportKeys = new Set(currentSupportTargets.map(structuralSupportCompatibleTargetKey));

  // ── Accessories (accessories, required companions, structural support - all one evaluation) ──
  const parsedAccessoryGroups = parseAccessoryConfigurationGroups(template.accessoryPricing ?? []).groups;
  const accessoryQuantities = selections.accessoryQuantities ?? {};

  const selectedModelTargets: AccessoryApplicabilityTarget[] = [
    ...nativeBaseModelTargets({
      mainGroupId: resolvedVariantGroupId,
      mainRowId: resolvedVariantRow?.id ?? null,
      systemGroupId: nativeSystem.selected?.group.id ?? null,
      systemRowId: nativeSystem.selected?.row.id ?? null,
    }),
    ...(resolvedCategoryRow?.group_id && resolvedCategoryRow.id ? [{ kind: "price_matrix" as const, group_id: resolvedCategoryRow.group_id, row_id: String(resolvedCategoryRow.id) }] : []),
    ...selectedModularItems.map((item) => ({ kind: "modular" as const, group_id: item.groupId, row_id: item.id })),
  ];
  const systemQuantity = normalizeSystemQuantity(selections.systemQuantity);
  const targetQuantities: Record<string, number> = {
    ...Object.fromEntries(selectedModularItems.map((item) => [accessoryApplicabilityTargetKey({ kind: "modular", group_id: item.groupId, row_id: item.id }), item.qty])),
    ...(nativeSystem.selected ? { [accessoryApplicabilityTargetKey({ kind: "base_model", group_id: nativeSystem.selected.group.id, row_id: nativeSystem.selected.row.id ?? "" })]: systemQuantity } : {}),
  };

  const accessoryEvaluation = evaluateProductAccessorySelection({
    accessoryGroups: template.accessoryPricing ?? [],
    selectedModelTargets,
    selectedModelTargetQuantities: targetQuantities,
    selectedQuantities: accessoryQuantities,
    allowRequiredCompanionOverrides: true,
  });

  for (const badId of accessoryEvaluation.unknownItemIds) {
    staleSelections.push({ key: "accessoryQuantities", id: badId, reason: "Accessory item no longer exists on this template." });
  }
  for (const group of accessoryEvaluation.groups) {
    for (const staleId of group.staleItemIds) {
      staleSelections.push({ key: "accessoryQuantities", id: staleId, reason: "Selected item is not applicable to the current configuration." });
    }
    if (!group.valid && group.validationMessage) {
      issues.push({ code: group.validationCode ?? "invalid_accessory_selection", message: group.validationMessage, stepKey: `accessory:${group.groupId}` });
    }
  }

  // ── 10. Required companions (AUTO-APPLIED, never asked) ─────────────────────────────────────
  const companionItems = requiredCompanionItems(accessoryEvaluation.groups);
  const requiredTrigger = requiredComponentTriggerKey(selectedModelTargets, targetQuantities);
  const requiredOverrides = selections.requiredOverrides ?? {};
  const effectiveCompanionQuantities = effectiveRequiredQuantities(accessoryEvaluation.groups, requiredOverrides, requiredTrigger);
  for (const companion of companionItems) {
    const effectiveQuantity = effectiveCompanionQuantities[companion.itemId] ?? companion.requiredQuantity;
    const isOverridden = requiredOverrides[companion.itemId]?.trigger === requiredTrigger;
    autoApplied.push({
      stepKey: `accessory:${companion.groupId}`,
      optionId: companion.itemId,
      reason: isOverridden
        ? `Required companion quantity overridden to ${effectiveQuantity} by an earlier selection.`
        : `Required companion applied automatically (quantity ${effectiveQuantity}).`,
    });
  }

  // ── 11/12. Structural support vs. optional accessories, split from the same evaluation ────────
  const itemById = new Map<string, AccessoryConfigurationItem>();
  const groupIdByItemId = new Map<string, string>();
  for (const group of parsedAccessoryGroups) {
    const groupId = typeof group.id === "string" && group.id ? group.id : "";
    for (const item of group.items ?? []) {
      if (typeof item.id === "string" && item.id) {
        itemById.set(item.id, item);
        groupIdByItemId.set(item.id, groupId);
      }
    }
  }
  const companionItemIds = new Set(companionItems.map((entry) => entry.itemId));

  function evaluationForItem(itemId: string): AccessoryGroupEvaluation | null {
    const groupId = groupIdByItemId.get(itemId);
    return accessoryEvaluation.groups.find((group) => group.groupId === groupId) ?? null;
  }

  const structuralSupportOptions: ProductConfigurationOption[] = [];
  let structuralSupportResolved = true;

  for (const [itemId, item] of itemById) {
    if (companionItemIds.has(itemId)) continue;
    const evaluation = evaluationForItem(itemId);
    if (!evaluation || !evaluation.visible || !evaluation.allowedItemIds.includes(itemId)) continue;
    const unitPrice = numberValue(item.price);
    const option: ProductConfigurationOption = {
      id: itemId,
      label: rowLabel(item as Record<string, unknown>, itemId),
      dimension: rowDimension(item as Record<string, unknown>),
      priceContribution: roundSourceAmount(unitPrice),
      priceCurrency: rowCurrency(item as Record<string, unknown>, template),
    };
    if (item.role === "structural_support") {
      const compatible = !item.compatible_targets?.length || currentSupportKeys.size === 0
        || item.compatible_targets.some((target) => currentSupportKeys.has(structuralSupportCompatibleTargetKey(target)));
      if (!compatible) continue;
      structuralSupportOptions.push(option);
      if (evaluation.required && !evaluation.selectedItemIds.includes(itemId) && evaluation.selectedItemIds.length === 0) {
        structuralSupportResolved = false;
      }
    }
  }

  if (structuralSupportOptions.length > 0) {
    steps.push({
      key: "structural_support",
      kind: "structural_support",
      label: "Structural support",
      required: false,
      resolved: structuralSupportResolved,
      autoResolved: false,
      multi: true,
      options: structuralSupportOptions,
    });
  }
  const skippedAccessoryGroupIds = new Set(selections.skippedAccessoryGroupIds ?? []);
  for (const evaluation of accessoryEvaluation.groups) {
    if (!evaluation.visible || evaluation.role === "companion") continue;
    const options = evaluation.allowedItemIds.flatMap((itemId) => {
      const item = itemById.get(itemId);
      return item ? [{
        id: itemId,
        label: rowLabel(item as Record<string, unknown>, itemId),
        dimension: rowDimension(item as Record<string, unknown>),
        priceContribution: roundSourceAmount(numberValue(item.price)),
        priceCurrency: rowCurrency(item as Record<string, unknown>, template),
      }] : [];
    });
    if (!options.length) continue;
    const skipped = skippedAccessoryGroupIds.has(evaluation.groupId);
    steps.push({
      key: `accessory:${evaluation.groupId}`,
      kind: "accessory",
      label: parsedAccessoryGroups.find((group) => group.id === evaluation.groupId)?.group_name?.trim() || "Accessory",
      required: evaluation.required,
      resolved: evaluation.required ? evaluation.valid : skipped || evaluation.selectedItemIds.length > 0,
      autoResolved: false,
      multi: evaluation.minSelections > 1,
      options,
      groupId: evaluation.groupId,
      minSelections: evaluation.minSelections,
      maxSelections: evaluation.maxSelections,
      selectedOptionIds: evaluation.selectedItemIds,
    });
  }

  // ── 14. Quantity ─────────────────────────────────────────────────────────────────────────────
  const quantity = Math.max(1, Math.trunc(numberValue(selections.quantity, 1)) || 1);
  steps.push({
    key: "quantity",
    kind: "quantity",
    label: "Quantity",
    required: false,
    resolved: true,
    autoResolved: selections.quantity === undefined || selections.quantity === null,
    multi: false,
    options: [{ id: String(quantity), label: String(quantity) }],
  });

  // ── Price (exact existing priority chain, currency-matching only - never a converted guess) ──
  // Follows the server action's priority (desking -> modular -> category -> variant -> default),
  // the authoritative persisted-price boundary per GPC-0. The client selector's own inline chain
  // checks modular before desking; GPC-0 flagged this as a genuine, pre-existing discrepancy
  // between the two live callers, not something this engine should silently resolve either way.
  const modularTotal = roundSourceAmount(selectedModularItems.reduce((sum, item) => sum + item.total, 0));
  const base = resolvedWorkstationRow
    ? roundSourceAmount(numberValue(resolvedWorkstationRow.default_price, template.defaultUnitPrice))
    : usesModularPricing
      ? modularTotal
      : resolvedCategoryRow
        ? roundSourceAmount(numberValue(resolvedFabricCategory ? resolvedCategoryRow.prices?.[resolvedFabricCategory] : 0))
        : resolvedVariantRow
          ? roundSourceAmount(baseModelPriceOrDefault(numberValue(resolvedVariantRow.price, NaN) || null, template.defaultUnitPrice))
          : roundSourceAmount(template.defaultUnitPrice);
  const baseCurrency = normalizeCurrency(
    resolvedWorkstationRow?.currency as string | undefined
      ?? (selectedModularItems[0]?.row.currency as string | undefined)
      ?? resolvedCategoryRow?.currency as string | undefined
      ?? resolvedVariantRow?.currency as string | undefined
      ?? currency,
  );

  const systemContribution = nativeSystem.selected ? systemPriceContribution(nativeSystem.selected.row, baseCurrency, systemQuantity) : null;
  const systemAmount = roundSourceAmount(systemContribution?.matching ?? 0);

  const workstationVariantPrice = resolvedWorkstationVariantRow ? numberValue(resolvedWorkstationVariantRow.price) : 0;
  const workstationVariantCurrency = normalizeCurrency((resolvedWorkstationVariantRow?.currency as string | undefined) ?? baseCurrency);
  const workstationVariantAmount = workstationVariantCurrency === baseCurrency ? roundSourceAmount(workstationVariantPrice) : 0;

  const selectedAccessoryLines = Array.from(itemById.entries())
    .map(([itemId, item]) => ({
      item,
      qty: companionItemIds.has(itemId) ? numberValue(effectiveCompanionQuantities[itemId]) : Math.max(0, numberValue(accessoryQuantities[itemId])),
      currency: normalizeCurrency(item.currency ?? baseCurrency),
    }))
    .filter((line) => line.qty > 0 && (evaluationForItem(String(line.item.id))?.allowedItemIds.includes(String(line.item.id)) ?? false));
  const accessoriesAmount = roundSourceAmount(
    selectedAccessoryLines.filter((line) => line.currency === baseCurrency).reduce((sum, line) => sum + line.qty * numberValue(line.item.price), 0),
  );

  const mismatchedCurrencies = new Set<string>();
  if (systemContribution && systemContribution.amount > 0 && normalizeCurrency(systemContribution.currency) !== baseCurrency) mismatchedCurrencies.add(normalizeCurrency(systemContribution.currency));
  if (resolvedWorkstationVariantRow && workstationVariantPrice > 0 && workstationVariantCurrency !== baseCurrency) mismatchedCurrencies.add(workstationVariantCurrency);
  for (const line of selectedAccessoryLines) {
    if (line.currency !== baseCurrency) mismatchedCurrencies.add(line.currency);
  }

  const unit = sameCurrencyUnitSum({ base, system: systemAmount, workstationVariant: workstationVariantAmount, accessories: accessoriesAmount, linked: 0 });

  const price: ProductConfigurationPrice = {
    base,
    system: systemAmount,
    workstationVariant: workstationVariantAmount,
    accessories: accessoriesAmount,
    linked: 0,
    unit,
    currency: baseCurrency,
    missingExchangeRateCurrencies: Array.from(mismatchedCurrencies),
  };
  if (mismatchedCurrencies.size > 0) {
    issues.push({ code: "missing_exchange_rate", message: `An exchange rate is required for: ${Array.from(mismatchedCurrencies).join(", ")}.` });
  }

  // ── Specification + dimension (existing snapshot helpers only, never a second generator) ─────
  const accessorySnapshots: ProductSpecificationAccessoryInput[] = selectedAccessoryLines.map((line) => ({
    item_name: typeof line.item.item_name === "string" ? line.item.item_name : null,
    importantRequirements: Array.isArray(line.item.importantRequirements) ? line.item.importantRequirements : null,
    qty: line.qty,
    supplier_price_list_code: typeof line.item.supplier_price_list_code === "string" ? line.item.supplier_price_list_code : null,
    specification: typeof line.item.specification === "string" ? line.item.specification : null,
  }));

  let primarySpecification: string | null = null;
  if (usesModularPricing && selectedModularItems.length) {
    const modularDefaults = modularPricingDefaultsFromRows((template.categoryPricing as ModularCategoryPricingShape[] | null) ?? []);
    const activeModularGroup = modularGroups.find((group) => group.id === selectedModularItems[0]?.groupId) ?? null;
    primarySpecification = buildModularCompositionSpecification({
      items: selectedModularItems.map((item) => ({
        dimension: rowDimension(item.row),
        itemName: rowLabel(item.row, item.id),
        quantity: item.qty,
        importantRequirements: Array.isArray(item.row.importantRequirements) ? (item.row.importantRequirements as string[]) : null,
        specification: typeof item.row.specification === "string" ? item.row.specification : null,
      })),
      accessories: accessorySnapshots,
      modularDefaultSpecification: modularDefaults.defaultSpecification,
      modularPricingMode: activeModularGroup && isDirectModularPricingGroup(activeModularGroup) ? "direct" : "matrix",
      origin: template.origin,
      selectedCategory: resolvedFabricCategory,
      templateDefaultSpecification: template.defaultSpecification,
      templateDescription: template.description,
    });
  } else {
    primarySpecification = (typeof resolvedCategoryRow?.specification === "string" ? resolvedCategoryRow.specification : null)
      ?? (typeof resolvedVariantRow?.specification === "string" ? (resolvedVariantRow.specification as string) : null);
  }

  const companyStyleSpecification = buildCompanyStyleProductSpecification({
    accessorySnapshots,
    brand: template.brandName,
    linkedProductSnapshots: [],
    origin: template.origin,
    primarySpecification,
    selectedOptionSnapshots: [],
    selectedWorkstationVariant: resolvedWorkstationVariantRow
      ? { specification: typeof resolvedWorkstationVariantRow.specification === "string" ? resolvedWorkstationVariantRow.specification : null, variant_name: typeof resolvedWorkstationVariantRow.variant_name === "string" ? resolvedWorkstationVariantRow.variant_name : null }
      : null,
    template: { default_specification: template.defaultSpecification, description: template.description },
  });

  let specification = resolveProductSpecificationSnapshot({
    companyStyleSpecification,
    selectedCategorySpecification: typeof resolvedCategoryRow?.specification === "string" ? resolvedCategoryRow.specification : null,
    selectedVariantSpecification: typeof resolvedVariantRow?.specification === "string" ? (resolvedVariantRow.specification as string) : null,
    selectedWorkstationVariantSpecification: typeof resolvedWorkstationVariantRow?.specification === "string" ? resolvedWorkstationVariantRow.specification : null,
    template: { default_specification: template.defaultSpecification, description: template.description },
  });
  if (nativeSystem.selected) {
    specification = composeSystemAndMainSpecification(
      typeof nativeSystem.selected.row.specification === "string" ? nativeSystem.selected.row.specification : null,
      specification,
    );
  }

  const dimension = resolveProductDimensionSnapshot({
    selectedCategoryDimension: rowDimension(resolvedCategoryRow),
    selectedVariantDimension: rowDimension(resolvedVariantRow),
    selectedWorkstationVariantDimension: rowDimension(resolvedWorkstationVariantRow),
    selectedSizeLabel: rowLabel(resolvedWorkstationRow as Record<string, unknown> | null, ""),
  });

  // ── next required step + optional steps ─────────────────────────────────────────────────────
  const requiredStepOrder: ProductConfigurationStepKind[] = [
    "system_base", "variant_group", "variant_subgroup", "variant_row",
    "workstation_size", "category_group", "category_row", "fabric_category", "modular", "accessory",
  ];
  const requiredUnresolved = steps.filter((step) => step.required && !step.resolved);
  const nextRequiredStep = requiredStepOrder
    .flatMap((kind) => requiredUnresolved.filter((step) => step.kind === kind))[0] ?? null;
  const optionalSteps = steps.filter((step) => step.kind === "accessory" && !step.required && !step.resolved);

  return {
    steps,
    nextRequiredStep,
    optionalSteps,
    autoApplied,
    issues,
    staleSelections,
    price,
    specification,
    dimension,
  };
}
