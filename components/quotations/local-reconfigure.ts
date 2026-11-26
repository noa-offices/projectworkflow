import type { LocalQuotationItem } from "@/lib/local/quotation-workspace";
import { parseLineConfigurationRecipe, recipeFromLine, type RecipeFromLine } from "@/lib/products/saved-setups/line-recipe";
import type { AppRole } from "@/lib/supabase/types";
import { ruleConvertedPrice, type PricingRule } from "@/lib/quotation-pricing";
import { formatMoney } from "@/lib/currencies";
import { isQuotationLocked } from "@/lib/quotations/quotation-lock";
import { roundSourceAmount } from "@/lib/quotations/source-price-components";

export type ReconfigureTarget = { line: LocalQuotationItem; setup: Extract<RecipeFromLine, { ok: true }> };
export type ReconfigureChanges = { linkedFinishes?: boolean; configuration: boolean; price: boolean; specification: boolean; dimension: boolean; image: boolean };

export function canReconfigureLocalQuotation(role: AppRole | null | undefined) {
  return role === "system_owner" || role === "admin_manager" || role === "procurement_manager" ||
    role === "sales_designer" || role === "sales_coordinator" || role === "designer";
}

export function reconfigureTarget(line: LocalQuotationItem, canWrite: boolean, layoutSettings: unknown): ReconfigureTarget | null {
  if (!canWrite || isQuotationLocked({ layout_settings: layoutSettings }) || line.is_active === false) return null;
  const setup = recipeFromLine(line);
  return setup.ok ? { line, setup } : null;
}

export function snapshotObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function configurationFingerprint(recipe: ReconfigureTarget["setup"]["recipe"]) {
  return JSON.stringify([recipe.selections, recipe.finishes, recipe.linked], (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value);
}

export function reconfigurationDraft(target: ReconfigureTarget, draft: LocalQuotationItem, changes: ReconfigureChanges) {
  const source = { ...snapshotObject(draft.source_component_data) };
  const savedSource = snapshotObject(target.line.source_component_data);
  const saved = parseLineConfigurationRecipe(savedSource.configuration_recipe, target.setup.templateId);
  const next = parseLineConfigurationRecipe(source.configuration_recipe, target.setup.templateId);
  if (saved && next) {
    const recipe = changes.configuration ? next.recipe : saved.recipe;
    const overrides = changes.configuration ? next.spec_overrides : saved.spec_overrides;
    source.configuration_recipe = {
      recipe: { ...recipe, selected_image: changes.image ? next.recipe.selected_image : saved.recipe.selected_image },
      spec_overrides: {
        ...overrides,
        dimension: changes.dimension ? next.spec_overrides.dimension : saved.spec_overrides.dimension,
        specification_edited: changes.specification ? next.spec_overrides.specification_edited : saved.spec_overrides.specification_edited,
        edited_specification: changes.specification ? next.spec_overrides.edited_specification : saved.spec_overrides.edited_specification,
        generated_specification_hash: changes.specification ? next.spec_overrides.generated_specification_hash : saved.spec_overrides.generated_specification_hash,
      },
    };
  }
  if (!changes.image) source.selected_proposed_image_url = savedSource.selected_proposed_image_url ?? null;
  if (changes.price) {
    source.source_price_reference = { ...snapshotObject(source.source_price_reference), converted_quotation_price: draft.unit_price, quotation_currency: draft.currency };
    if (source.currency_conversion) source.currency_conversion = { ...snapshotObject(source.currency_conversion), converted_total_aed: draft.unit_price };
  }
  return { ...draft, source_component_data: source };
}

export function clearReconfiguredPriceRounding(metadata: unknown, targetId: string) {
  const original = snapshotObject(metadata);
  const priceRounding = snapshotObject(original.price_rounding);
  const roundedPrices = snapshotObject(priceRounding.rounded_net_prices);
  if (!Object.hasOwn(roundedPrices, targetId)) return original;
  const nextPrices = { ...roundedPrices };
  delete nextPrices[targetId];
  return { ...original, price_rounding: { ...priceRounding, rounded_net_prices: nextPrices } };
}

const pricedSourceKeys = ["source_price_reference", "currency_conversion", "announced_price_change"];
const configurationSourceKeys = [
  "configuration_recipe", "template_code", "template_name", "brand_name", "brand", "brand_id", "origin",
  "origin_country", "country_of_origin", "supplier_name", "supplier", "supplier_price_list_code", "specification",
  "importantRequirements", "description", "default_specification", "dimension", "dimensions", "size_label",
  "default_image_url", "reference_image_url", ...Array.from({ length: 20 }, (_, index) => `proposed_image_url_${index + 1}`),
  "selected_proposed_image_url", "selected_option_ids", "selected_options", "selected_options_snapshot",
  "desking", "variant_pricing", "system_pricing", "required_component_overrides", "category_pricing",
  "modular_pricing", "add_ons", "linked_products",
];

export function reconfigureLocalRows(
  rows: LocalQuotationItem[], target: LocalQuotationItem, draft: LocalQuotationItem,
  changes: ReconfigureChanges = { configuration: true, price: true, specification: true, dimension: true, image: true },
) {
  return rows.map((row) => {
    if (row.id !== target.id || row.updated_at !== target.updated_at || row.source_template_id !== draft.source_template_id || row.is_active === false) return row;
    const source = { ...snapshotObject(row.source_component_data) };
    const nextSource = snapshotObject(draft.source_component_data);
    if (changes.linkedFinishes || changes.configuration) {
      if (Object.hasOwn(nextSource, "linked_finish_snapshot")) source.linked_finish_snapshot = nextSource.linked_finish_snapshot;
      else delete source.linked_finish_snapshot;
    }
    if (changes.linkedFinishes && !changes.configuration && !changes.price && !changes.specification && !changes.dimension && !changes.image) {
      return { ...row, source_component_data: source };
    }
    const keys = [
      ...(changes.configuration ? configurationSourceKeys : []),
      ...(changes.price ? pricedSourceKeys : []),
      ...(!changes.configuration && changes.specification ? ["configuration_recipe", "specification"] : []),
      ...(!changes.configuration && changes.dimension ? ["configuration_recipe", "dimension", "dimensions", "size_label"] : []),
      ...(!changes.configuration && changes.image ? ["configuration_recipe", "selected_proposed_image_url"] : []),
    ];
    for (const key of keys) {
      if (Object.hasOwn(nextSource, key)) source[key] = nextSource[key];
      else delete source[key];
    }
    const cellLayout = snapshotObject(row.cell_layout);
    const images = { ...snapshotObject(cellLayout.images) };
    if (changes.image) {
      const nextImages = snapshotObject(snapshotObject(draft.cell_layout).images);
      if (Object.hasOwn(nextImages, "proposed_image_url_snapshot")) images.proposed_image_url_snapshot = nextImages.proposed_image_url_snapshot;
      else delete images.proposed_image_url_snapshot;
    }
    return {
      ...row,
      source_component_data: source,
      ...(changes.configuration ? {
        selected_options_snapshot: draft.selected_options_snapshot,
        internal_components_snapshot: draft.internal_components_snapshot,
        finish_selections_snapshot: draft.finish_selections_snapshot,
        finish_snapshot: draft.finish_snapshot,
        model_snapshot: draft.model_snapshot,
        item_code_snapshot: draft.item_code_snapshot,
      } : {}),
      ...(changes.price ? { unit_price: draft.unit_price, currency: draft.currency } : {}),
      ...(changes.specification ? { specification_snapshot: draft.specification_snapshot } : {}),
      ...(changes.dimension ? { size_snapshot: draft.size_snapshot } : {}),
      ...(changes.image ? { proposed_image_url_snapshot: draft.proposed_image_url_snapshot, cell_layout: { ...cellLayout, images } } : {}),
      updated_at: draft.updated_at,
    };
  });
}

export function reconfigureUnitPrice(rule: PricingRule | undefined, saved: number, baseline: number, configured: number, changed: boolean, useCurrent: boolean) {
  if (useCurrent) return ruleConvertedPrice(rule, configured);
  if (!changed) return saved;
  const delta = roundSourceAmount(configured - baseline);
  return delta === 0 ? saved : ruleConvertedPrice(rule, Math.max(0, saved + delta));
}

export function formatReconfiguredMoney(rule: PricingRule | undefined, currency: string, amount: number) {
  return formatMoney(currency, amount, {
    minimumFractionDigits: rule === "whole_aed_v1" && !Number.isInteger(amount) ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function reconfigureWarnings({ savedPrice, currentPrice, specChanged, savedDimension, currentDimension, problems }: {
  savedPrice: string;
  currentPrice: string | null;
  specChanged: boolean;
  savedDimension: string | null | undefined;
  currentDimension: string | null | undefined;
  problems: string[];
}) {
  return [
    ...(currentPrice && currentPrice !== savedPrice ? [`Unit price: ${savedPrice} saved; ${currentPrice} now.`] : []),
    ...(specChanged ? ["The generated specification changed."] : []),
    ...((savedDimension || null) !== (currentDimension || null) ? [`Dimension: ${savedDimension || "none"} saved; ${currentDimension || "none"} now.`] : []),
    ...problems,
  ];
}
