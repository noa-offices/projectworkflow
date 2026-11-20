/**
 * My Collection replay (PR 1b-2). PURE: no React, no server-only, no database, no prices.
 *
 * evaluateSetup() re-resolves a saved recipe against the CURRENT template and returns
 *   - a validation result: ok / needs_review (plain-words problem list) / unavailable
 *   - the plain selector state to hydrate with: everything that CAN be restored; ids that no longer
 *     exist are dropped from the restored state but ALWAYS reported as a problem (never dropped silently).
 * Prices are never read, restored or returned: the existing Add path prices from the current price lists.
 *
 * What it CAN check: base/model, system, category/matrix, workstation size, modular rows, accessory ids and
 * applicability, finish category, unresolved required steps (via resolveProductConfigurationState), plus
 * option components, finishes (brand material ids), linked-family links and accessory category choices.
 * What it CANNOT check: rows inside linked child products, and the specification (only the browser knows the
 * freshly generated text; see specificationDrift), and whether a finish material is still allowed for the template.
 */
import {
  resolveProductConfigurationState,
  type ProductConfigurationSelections,
  type ProductConfigurationTemplateInput,
} from "../product-configuration-state";
import { baseModelPlacementFromTemplate } from "./base-model-placement";
import {
  hashSpecificationText,
  restorePlainState,
  type SavedSetupPlainState,
  type SavedSetupRecipeV1,
  type SavedSetupSpecOverrides,
} from "./recipe";

export type SetupProblemKind =
  | "model_removed"
  | "option_removed"
  | "accessory_removed"
  | "finish_gone"
  | "required_step"
  | "rule_changed"
  | "linked_removed"
  | "unverified";

export type SetupProblem = { kind: SetupProblemKind; label: string };
export type SetupValidation = {
  status: "ok" | "needs_review" | "unavailable";
  problems: SetupProblem[];
};

/** The current template, as much as the replay needs (the builders only load active templates). */
export type SetupTemplateInput = {
  id: string;
  template_name: string;
  internal_selection_name?: string | null;
  item_code?: string | null;
  template_code?: string | null;
  supplier_name?: string | null;
  origin?: string | null;
  currency: string;
  default_unit_price: number;
  default_specification?: string | null;
  description?: string | null;
  variant_pricing?: unknown;
  category_pricing?: unknown;
  accessory_pricing?: unknown;
  desking_size_pricing?: unknown;
  is_active?: boolean | null;
  lifecycle_status?: string | null;
};

/** Ids that exist TODAY outside the template's own pricing JSON. Omit a list to skip that check. */
export type SetupReplayContext = {
  componentIds?: readonly string[];
  materialIds?: readonly string[];
  linkedFamilyIds?: readonly string[];
};

export type SetupEvaluation = { validation: SetupValidation; state: SavedSetupPlainState | null };

function isUsableTemplate(template: SetupTemplateInput | null | undefined): template is SetupTemplateInput {
  if (!template) return false;
  if (template.is_active === false) return false;
  return template.lifecycle_status == null || template.lifecycle_status === "active";
}

function collectIds(value: unknown, into: Set<string>, depth = 0) {
  if (depth > 8 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string") into.add(record.id);
  for (const child of Object.values(record)) collectIds(child, into, depth + 1);
}

function toEngineTemplate(template: SetupTemplateInput): ProductConfigurationTemplateInput {
  return {
    id: template.id,
    templateName: template.template_name,
    internalSelectionName: template.internal_selection_name ?? null,
    itemCode: template.item_code ?? null,
    templateCode: template.template_code ?? null,
    supplierName: template.supplier_name ?? null,
    origin: template.origin ?? null,
    currency: template.currency,
    defaultUnitPrice: template.default_unit_price,
    defaultSpecification: template.default_specification ?? null,
    description: template.description ?? null,
    variantPricing: template.variant_pricing,
    categoryPricing: template.category_pricing,
    accessoryPricing: template.accessory_pricing,
    deskingSizePricing: template.desking_size_pricing,
  };
}

const KIND_BY_STALE_KEY: Record<string, SetupProblemKind> = {
  systemRowId: "model_removed",
  variantGroupId: "model_removed",
  subgroupId: "model_removed",
  variantRowId: "model_removed",
  deskingSizeId: "model_removed",
  workstationVariantRowId: "model_removed",
  categoryGroupId: "model_removed",
  categoryRowId: "model_removed",
  modularQuantities: "model_removed",
  fabricCategory: "rule_changed",
  accessoryQuantities: "accessory_removed",
};

// The engine lists Base / Model, Price Matrix AND modular steps as required whenever the template has those rows. The configurator uses ONE
// pricing mode per line (see configuratorModes in lib/quotations/configurator-choosers.ts):
//   - modular items (or a workstation size), or
//   - a Base / Model row / Price Matrix choice.
// So for a template that offers both, the modular step is required only when no Base / Model or Price Matrix choice is made, and the
// Base / Model and Price Matrix steps only when no modular item is selected. A template with nothing selected still reports what is needed
// (the modular step, as before). A modular-only or base-only template keeps its own rules (modular-only: a modular selection; base-only: the
// engine's answer unchanged). A workstation product never offers Base / Model or Price Matrix (its Base / Model rows are workstation variants).
// A saved choice of the other mode is simply ignored (a modular line that also carries a legacy variant_row_id still prices as modular).
const BASE_MODEL_STEP_KINDS = new Set(["variant_group", "variant_subgroup", "variant_row"]);
const PRICE_MATRIX_STEP_KINDS = new Set(["category_group", "category_row"]);
const REPLAY_STEP_ORDER = ["system_base", "workstation_size", "category_group", "category_row", "fabric_category", "modular", "accessory"];
const BASE_MODE_STEP_ORDER = ["system_base", "variant_group", "variant_subgroup", "variant_row", "category_group", "category_row", "fabric_category", "accessory"];

/**
 * Modular groups are alternatives: once any modular item has a quantity (its step is resolved), the other modular groups are not required.
 * With no modular item selected they stay required exactly as before. Shared with the Gallery popup's completeness check.
 */
export const modularAlternativeSelected = (steps: ReadonlyArray<{ kind: string; resolved: boolean }>) =>
  steps.some((step) => step.kind === "modular" && step.resolved);

type ReplayStep = { kind: string; label: string; required: boolean; resolved: boolean; options: ReadonlyArray<{ id: string }> };

function nextRequiredForReplay(
  steps: ReadonlyArray<ReplayStep>,
  engineNext: { kind: string; label: string } | null,
  modularQuantities: Record<string, number>,
  baseChoice: { variantRowId?: string | null; categoryRowId?: string | null } = {},
): { label: string } | null {
  const modularSteps = steps.filter((step) => step.kind === "modular");
  const usesWorkstation = steps.some((step) => step.kind === "workstation_size");
  if (modularSteps.length === 0 && !usesWorkstation) return engineNext;
  const hasBaseSteps = steps.some((step) => BASE_MODEL_STEP_KINDS.has(step.kind) || PRICE_MATRIX_STEP_KINDS.has(step.kind));
  const modularSelected = modularSteps.some((step) => step.options.some((option) => Number(modularQuantities[option.id] ?? 0) > 0));
  const baseChosen = steps.some((step) =>
    (step.kind === "variant_row" && Boolean(baseChoice.variantRowId) && step.options.some((option) => option.id === baseChoice.variantRowId)) ||
    (step.kind === "category_row" && Boolean(baseChoice.categoryRowId) && step.options.some((option) => option.id === baseChoice.categoryRowId)));

  // Base mode on a template that also offers modular items: the modular step is not required; the base steps are.
  if (modularSteps.length > 0 && hasBaseSteps && !modularSelected && baseChosen) {
    // A Base / Model row wins over the Price Matrix (price order), so its steps do not ask for the other one, and the other way round.
    const variantChosen = steps.some((step) => step.kind === "variant_row" && Boolean(baseChoice.variantRowId) && step.options.some((option) => option.id === baseChoice.variantRowId));
    const skipped = (kind: string) => kind === "modular" || (variantChosen ? PRICE_MATRIX_STEP_KINDS.has(kind) || kind === "fabric_category" : BASE_MODEL_STEP_KINDS.has(kind));
    const unresolvedBase = steps.filter((step) => step.required && !step.resolved && !skipped(step.kind));
    for (const kind of BASE_MODE_STEP_ORDER) {
      const found = unresolvedBase.find((step) => step.kind === kind);
      if (found) return found;
    }
    return null;
  }

  // The finish category that belongs to a standalone Price Matrix row is not required while the line uses modular items.
  const hasCategoryRowStep = steps.some((step) => step.kind === "category_row");
  const hidden = (kind: string) => (kind === "modular" && modularSelected) || BASE_MODEL_STEP_KINDS.has(kind) || PRICE_MATRIX_STEP_KINDS.has(kind) || (usesWorkstation && modularSteps.length === 0 && kind === "fabric_category") || (modularSteps.length > 0 && hasCategoryRowStep && kind === "fabric_category");
  const unresolved = steps.filter((step) => step.required && !step.resolved && !hidden(step.kind));
  for (const kind of REPLAY_STEP_ORDER) {
    const found = unresolved.find((step) => step.kind === kind);
    if (found) return found;
  }
  if (modularSteps.length === 0) return null;
  return modularSelected ? null : modularSteps[0];
}

export function evaluateSetup(
  recipe: SavedSetupRecipeV1,
  specOverrides: SavedSetupSpecOverrides | null | undefined,
  template: SetupTemplateInput | null | undefined,
  context: SetupReplayContext = {},
): SetupEvaluation {
  if (!isUsableTemplate(template)) {
    return {
      validation: { status: "unavailable", problems: [{ kind: "model_removed", label: "This product is no longer available." }] },
      state: null,
    };
  }

  const plain = restorePlainState(recipe, specOverrides);
  const problems: SetupProblem[] = [];
  const state: SavedSetupPlainState = { ...plain, templateId: template.id };

  // 1. Engine: stale ids, unresolved required steps, rule problems.
  // The Product Family / Configuration are derived from the row against the CURRENT template (so setups saved with
  // only a row id still work, and a row that moved is found where it is now). If the row no longer exists, the saved
  // ids (when present) are passed so the engine reports the removed model instead of a missing group.
  const placement = baseModelPlacementFromTemplate(template.variant_pricing, plain.variantRowId);
  const variantGroupId = placement?.groupId ?? plain.variantGroupId ?? undefined;
  const subgroupId = placement ? placement.subgroupId || undefined : plain.subgroupId ?? undefined;
  state.variantGroupId = variantGroupId ?? null;
  state.subgroupId = subgroupId ?? null;
  const selections: ProductConfigurationSelections = {
    variantRowId: plain.variantRowId ?? undefined,
    variantGroupId,
    subgroupId,
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
  try {
    const result = resolveProductConfigurationState(toEngineTemplate(template), selections);
    const dropped = new Map<string, Set<string>>();
    for (const stale of result.staleSelections) {
      problems.push({ kind: KIND_BY_STALE_KEY[stale.key] ?? "rule_changed", label: stale.reason });
      const ids = dropped.get(stale.key) ?? new Set<string>();
      ids.add(stale.id);
      dropped.set(stale.key, ids);
    }
    for (const issue of result.issues) problems.push({ kind: "rule_changed", label: issue.message });
    const nextRequired = nextRequiredForReplay(result.steps, result.nextRequiredStep, plain.modularQuantities ?? {}, { variantRowId: plain.variantRowId, categoryRowId: plain.categoryRowId });
    if (nextRequired) {
      problems.push({ kind: "required_step", label: `A required choice is not set: ${nextRequired.label}.` });
    }
    // Restore only what still resolves.
    const drop = (key: string) => dropped.get(key) ?? new Set<string>();
    if (drop("variantRowId").has(plain.variantRowId ?? "")) state.variantRowId = null;
    if (drop("systemRowId").has(plain.systemRowId ?? "")) { state.systemRowId = null; state.systemQuantity = null; }
    if (drop("categoryGroupId").has(plain.categoryGroupId ?? "")) { state.categoryGroupId = null; state.categoryRowId = null; }
    if (drop("categoryRowId").has(plain.categoryRowId ?? "")) state.categoryRowId = null;
    if (drop("fabricCategory").has(plain.fabricCategory ?? "")) state.fabricCategory = null;
    if (drop("deskingSizeId").has(plain.workstationSizeId ?? "")) state.workstationSizeId = null;
    const withoutIds = (values: Record<string, number> | undefined, ids: Set<string>) =>
      Object.fromEntries(Object.entries(values ?? {}).filter(([id]) => !ids.has(id)));
    state.modularQuantities = withoutIds(plain.modularQuantities, drop("modularQuantities"));
    state.pricingAccessoryQuantities = withoutIds(plain.pricingAccessoryQuantities, drop("accessoryQuantities"));
  } catch {
    problems.push({ kind: "unverified", label: "This setup could not be fully checked against the current product. Please review every choice." });
  }

  // 2. Things the engine excludes.
  if (context.componentIds) {
    const known = new Set(context.componentIds);
    const kept: Record<string, string | string[]> = {};
    for (const [group, value] of Object.entries(plain.componentOptionSelections ?? {})) {
      const ids = Array.isArray(value) ? value : [value];
      const present = ids.filter((id) => known.has(id));
      if (present.length !== ids.length) problems.push({ kind: "option_removed", label: `An option you chose in "${group.split(":")[0] || group}" no longer exists.` });
      if (present.length) kept[group] = Array.isArray(value) ? present : present[0];
    }
    state.componentOptionSelections = kept;
    const keptAccessories: Record<string, number> = {};
    for (const [id, quantity] of Object.entries(plain.componentAccessoryQuantities ?? {})) {
      if (known.has(id)) keptAccessories[id] = quantity;
      else problems.push({ kind: "accessory_removed", label: "An accessory you chose no longer exists on this product." });
    }
    state.componentAccessoryQuantities = keptAccessories;
  }

  if (context.materialIds) {
    const known = new Set(context.materialIds);
    state.finishes = (plain.finishes ?? []).filter((finish) => {
      const materialId = typeof finish.brand_material_id === "string" ? finish.brand_material_id : "";
      if (!materialId || known.has(materialId)) return true;
      const name = typeof finish.finish_name === "string" && finish.finish_name ? ` "${finish.finish_name}"` : "";
      problems.push({ kind: "finish_gone", label: `The finish${name} is no longer available.` });
      return false;
    });
  }

  if (context.linkedFamilyIds) {
    const known = new Set(context.linkedFamilyIds);
    const instances: Record<string, string[]> = {};
    const selectionsByKey: NonNullable<SavedSetupPlainState["linkedSelections"]> = {};
    for (const [linkId, ids] of Object.entries(plain.linkedInstances ?? {})) {
      if (!known.has(linkId)) {
        problems.push({ kind: "linked_removed", label: "A linked product you chose is no longer linked to this product." });
        continue;
      }
      instances[linkId] = ids;
      for (const id of ids) {
        const key = `${linkId}:${id}`;
        const selection = plain.linkedSelections?.[key];
        if (selection) selectionsByKey[key] = selection;
      }
    }
    state.linkedInstances = instances;
    state.linkedSelections = selectionsByKey;
  }

  // Accessory category choices: keys are `${templateId}:${groupId}:${itemId}`; the item must still exist.
  const accessoryIds = new Set<string>();
  collectIds(template.accessory_pricing, accessoryIds);
  const keptChoices: Record<string, string> = {};
  for (const [key, value] of Object.entries(plain.accessoryCategoryChoices ?? {})) {
    const itemId = key.split(":").pop() ?? "";
    if (accessoryIds.has(itemId)) keptChoices[key] = value;
    else problems.push({ kind: "accessory_removed", label: "An accessory price category you chose no longer exists." });
  }
  state.accessoryCategoryChoices = keptChoices;

  // Same message twice (for example two removed accessories) is listed once.
  const seen = new Set<string>();
  const unique = problems.filter((problem) => {
    const key = `${problem.kind}|${problem.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { validation: { status: unique.length ? "needs_review" : "ok", problems: unique }, state };
}

export function validateSetupAgainstTemplate(
  recipe: SavedSetupRecipeV1,
  template: SetupTemplateInput | null | undefined,
  context: SetupReplayContext = {},
  specOverrides?: SavedSetupSpecOverrides | null,
): SetupValidation {
  return evaluateSetup(recipe, specOverrides, template, context).validation;
}

/** The plain state used to hydrate the selector (null when the template is unavailable). */
export function recipeToSelectorState(
  recipe: SavedSetupRecipeV1,
  template: SetupTemplateInput | null | undefined,
  context: SetupReplayContext = {},
  specOverrides?: SavedSetupSpecOverrides | null,
): SavedSetupPlainState | null {
  return evaluateSetup(recipe, specOverrides, template, context).state;
}

/**
 * Compares the generated specification saved with the setup against the CURRENT generated one.
 * Nothing to compare (no saved hash) counts as "same".
 */
export function specificationDrift(
  specOverrides: Pick<SavedSetupSpecOverrides, "generated_specification_hash"> | null | undefined,
  currentGeneratedSpec: string | null | undefined,
): "same" | "changed" {
  const saved = specOverrides?.generated_specification_hash;
  if (!saved) return "same";
  return saved === hashSpecificationText(currentGeneratedSpec ?? "") ? "same" : "changed";
}
