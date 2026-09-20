import { accessoryApplicabilityTargetKey, type AccessoryApplicabilityTarget, type AccessoryConfigurationRole, type AccessorySelectionMode } from "./accessory-conditional-configuration";
import { draftModularColumns, draftModularRows, type ProductTemplateDraft } from "./product-template-draft";
import { classifyDraftPriceMatrix } from "./product-template-draft-pricing-routing";
import type { DraftPriceMatrixRoute } from "./product-template-draft-pricing-routing";
import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";

export const SMART_REVIEW_DESTINATIONS = ["base_model", "workstation", "category_matrix", "modular", "accessory", "skip"] as const;
export type SmartReviewDestination = typeof SMART_REVIEW_DESTINATIONS[number];
export type SmartReviewSelection = "optional_multiple" | "optional_exactly_one" | "required_exactly_one" | "required_at_least_one" | "multiple";
export type SmartReviewRule = { baseModelGroupId?: string; baseModelRowId?: string; target?: AccessoryApplicabilityTarget; required: boolean; visible?: boolean; allowedItemIds?: string[]; fixedQuantity?: number; scaleWithTargetQuantity?: boolean };
export type SmartReviewAccessoryConfiguration = { role: AccessoryConfigurationRole; selection: SmartReviewSelection; rules: SmartReviewRule[] };
export type SmartReviewRoute = {
  key: string;
  sourceId: string;
  sourceKind: "matrix" | "option" | "workstation" | "base_model" | "modular";
  sourceName: string;
  groupName: string;
  rowCount: number;
  columnCount: number | null;
  recommendedDestination: SmartReviewDestination;
  destination: SmartReviewDestination;
  supportedDestinations: SmartReviewDestination[];
  accessory?: SmartReviewAccessoryConfiguration;
};
export type SmartSetupReviewRoutingPlan = { routes: SmartReviewRoute[] };

export function reorderSmartSetupReviewRoutes(plan: SmartSetupReviewRoutingPlan, key: string, direction: "up" | "down") {
  const index = plan.routes.findIndex((route) => route.key === key);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= plan.routes.length) return plan;
  const routes = [...plan.routes]; [routes[index], routes[target]] = [routes[target], routes[index]];
  return { ...plan, routes };
}

function explicitRequirement(specification: string | null, kind: "top" | "service") {
  if (!specification || !/\balways complete with\b/i.test(specification)) return false;
  return kind === "top" ? /\b1\s+top[- ]?access\b/i.test(specification) : /\b1\s+(?:support\s+)?service unit\b/i.test(specification);
}

function sourceSelectionDefaults(selection?: ProductTemplateDraft["optionGroups"][number]["selection"]): SmartReviewAccessoryConfiguration | null {
  if (!selection) return null;
  const exactlyOne = selection.maxSelections === 1;
  if (selection.minSelections === 0) {
    return {
      role: "accessory",
      selection: exactlyOne ? "optional_exactly_one" : selection.mode === "choose_multiple" ? "multiple" : "optional_multiple",
      rules: [],
    };
  }
  return {
    role: "companion",
    selection: exactlyOne ? "required_exactly_one" : "required_at_least_one",
    rules: [],
  };
}

function accessoryDefaults(name: string, selection?: ProductTemplateDraft["optionGroups"][number]["selection"]): SmartReviewAccessoryConfiguration {
  const sourceDefaults = sourceSelectionDefaults(selection);
  if (sourceDefaults) return sourceDefaults;
  const top = /\btop[- ]?access\b/i.test(name);
  const service = /\b(?:service|support)\s+units?\b/i.test(name);
  return { role: service ? "companion" : top ? "conditional_option" : "accessory", selection: service || top ? "required_exactly_one" : "optional_multiple", rules: [] };
}

function reviewedAccessoryConfiguration(group: ProductTemplateDraft["optionGroups"][number]): SmartReviewAccessoryConfiguration | null {
  const configuration = group.conditionalConfiguration;
  if (!configuration) return null;
  const required = configuration.applicability.some((rule) => rule.required);
  const selection = configuration.selection === "exactly_one" ? (required ? "required_exactly_one" : "optional_exactly_one")
    : configuration.selection === "at_least_one" ? "required_at_least_one"
      : configuration.selection === "choose_multiple" ? "multiple" : "optional_multiple";
  return { role: configuration.role, selection, rules: configuration.applicability.map((rule) => ({
    ...(rule.target ? { target: rule.target } : { baseModelGroupId: rule.base_model_group_id, baseModelRowId: rule.base_model_row_id }),
    required: rule.required,
    visible: rule.visible,
    ...(rule.allowed_item_ids ? { allowedItemIds: rule.allowed_item_ids } : {}),
    ...(rule.fixed_quantity !== undefined ? { fixedQuantity: rule.fixed_quantity } : {}),
    ...(rule.scale_with_target_quantity === true ? { scaleWithTargetQuantity: true } : {}),
  })) };
}

export function createSmartSetupReviewRouting(draft: ProductTemplateDraft): SmartSetupReviewRoutingPlan {
  const matrixRoutes: SmartReviewRoute[] = draft.pricing.priceMatrices.map((matrix) => {
    const recommendation = classifyDraftPriceMatrix(matrix);
    const recommendedDestination = recommendation.kind === "base_model" ? "base_model" : recommendation.kind === "companion" ? "accessory" : "category_matrix";
    const oneColumn = matrix.columns.length === 1;
    return { key: `matrix:${matrix.id}`, sourceId: matrix.id, sourceKind: "matrix", sourceName: matrix.label ?? matrix.id, groupName: matrix.label ?? matrix.id, rowCount: matrix.rows.length, columnCount: matrix.columns.length, recommendedDestination, destination: recommendedDestination, supportedDestinations: [...(oneColumn ? ["base_model", "category_matrix", "accessory"] as SmartReviewDestination[] : ["category_matrix"] as SmartReviewDestination[]), "skip"], ...(recommendedDestination === "accessory" ? { accessory: accessoryDefaults(matrix.label ?? matrix.id) } : {}) };
  });
  const optionRoutes: SmartReviewRoute[] = draft.optionGroups.map((group) => ({ key: `option:${group.id}`, sourceId: group.id, sourceKind: "option", sourceName: group.label ?? group.id, groupName: group.label ?? group.id, rowCount: group.items.length, columnCount: null, recommendedDestination: "accessory", destination: "accessory", supportedDestinations: ["accessory", "skip"], accessory: reviewedAccessoryConfiguration(group) ?? accessoryDefaults(group.label ?? group.id, group.selection) }));
  const routes: SmartReviewRoute[] = [
    ...(draft.pricing.workstationRows.length ? [{ key: "workstation:rows", sourceId: "workstationRows", sourceKind: "workstation" as const, sourceName: "Workstation Pricing", groupName: "Workstation Pricing", rowCount: draft.pricing.workstationRows.length, columnCount: null, recommendedDestination: "workstation" as const, destination: "workstation" as const, supportedDestinations: ["workstation", "skip"] as SmartReviewDestination[] }] : []),
    ...(draft.pricing.baseModelRows.length ? [{ key: "base_model:rows", sourceId: "baseModelRows", sourceKind: "base_model" as const, sourceName: "Base / Model Pricing", groupName: "Base / Model Pricing", rowCount: draft.pricing.baseModelRows.length, columnCount: null, recommendedDestination: "base_model" as const, destination: "base_model" as const, supportedDestinations: ["base_model", "skip"] as SmartReviewDestination[] }] : []),
    ...matrixRoutes,
    ...draft.pricing.modularGroups.map((group) => ({ key: `modular:${group.id}`, sourceId: group.id, sourceKind: "modular" as const, sourceName: group.label ?? group.id, groupName: group.label ?? group.id, rowCount: draftModularRows(group).length, columnCount: draftModularColumns(group).length, recommendedDestination: "modular" as const, destination: "modular" as const, supportedDestinations: ["modular", "skip"] as SmartReviewDestination[] })),
    ...optionRoutes,
  ];
  const baseModels = [
    ...draft.pricing.baseModelRows.map((row) => ({ groupId: LEGACY_BASE_MODEL_GROUP_ID, rowId: row.id, specification: row.specification })),
    ...draft.pricing.priceMatrices.flatMap((matrix) => matrixRoutes.find((route) => route.sourceId === matrix.id)?.destination === "base_model" ? matrix.rows.map((row) => ({ groupId: matrix.id, rowId: row.id, specification: row.specification })) : []),
  ];
  routes.forEach((route) => {
    if (!route.accessory || !["conditional_option", "companion"].includes(route.accessory.role)) return;
    // Draft-supplied applicability wins: this legacy specification heuristic exists only to
    // invent rules for groups that arrived without any, and must never overwrite an extracted
    // conditionalConfiguration (targets, allowed_item_ids, fixed_quantity, quantity scaling).
    if (route.accessory.rules.length) return;
    const kind = route.accessory.role === "companion" ? "service" : "top";
    route.accessory.rules = baseModels.filter((model) => explicitRequirement(model.specification, kind)).map((model) => ({ baseModelGroupId: model.groupId, baseModelRowId: model.rowId, required: true, fixedQuantity: 1 }));
  });
  return { routes };
}

export function smartReviewSelectionContract(selection: SmartReviewSelection): { selection: AccessorySelectionMode; required: boolean } {
  if (selection === "optional_exactly_one") return { selection: "exactly_one", required: false };
  if (selection === "required_exactly_one") return { selection: "exactly_one", required: true };
  if (selection === "required_at_least_one") return { selection: "at_least_one", required: true };
  if (selection === "multiple") return { selection: "choose_multiple", required: false };
  return { selection: "unrestricted", required: false };
}

export function smartReviewRuleTarget(rule: SmartReviewRule): AccessoryApplicabilityTarget | null {
  if (rule.target) return rule.target;
  return rule.baseModelGroupId && rule.baseModelRowId
    ? { kind: "base_model", group_id: rule.baseModelGroupId, row_id: rule.baseModelRowId }
    : null;
}

export function validateSmartSetupReviewRouting(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan) {
  const errors: string[] = [];
  const routeKeys = new Set(plan.routes.map((route) => route.key));
  if (routeKeys.size !== plan.routes.length) errors.push("Duplicate reviewed routing groups were found.");
  const modelTargets = new Set([
    ...(plan.routes.find((route) => route.key === "base_model:rows")?.destination === "base_model" ? draft.pricing.baseModelRows.map((row) => accessoryApplicabilityTargetKey({ kind: "base_model", group_id: LEGACY_BASE_MODEL_GROUP_ID, row_id: row.id })) : []),
    ...draft.pricing.priceMatrices.flatMap((matrix) => {
      const destination = plan.routes.find((route) => route.key === `matrix:${matrix.id}`)?.destination;
      const kind = destination === "base_model" ? "base_model" : destination === "category_matrix" ? "price_matrix" : null;
      return kind ? matrix.rows.map((row) => accessoryApplicabilityTargetKey({ kind, group_id: matrix.id, row_id: row.id })) : [];
    }),
    ...draft.pricing.modularGroups.flatMap((group) => plan.routes.find((route) => route.key === `modular:${group.id}`)?.destination === "modular"
      ? draftModularRows(group).map((row) => accessoryApplicabilityTargetKey({ kind: "modular", group_id: group.id, row_id: row.id }))
      : []),
  ]);
  plan.routes.forEach((route) => {
    if (!route.supportedDestinations.includes(route.destination)) errors.push(`${route.sourceName} cannot be applied to the selected destination.`);
    if (route.destination !== "skip" && !route.groupName.trim()) errors.push(`${route.sourceName} requires a destination group name.`);
    if (route.destination !== "accessory") return;
    if (!route.accessory) errors.push(`${route.sourceName} requires Accessory / Configuration settings.`);
    const itemIds = new Set(route.sourceKind === "option"
      ? draft.optionGroups.find((group) => group.id === route.sourceId)?.items.map((item) => item.id) ?? []
      : draft.pricing.priceMatrices.find((matrix) => matrix.id === route.sourceId)?.rows.map((row) => row.id) ?? []);
    const ruleKeys = new Set<string>();
    route.accessory?.rules.forEach((rule) => {
      const target = smartReviewRuleTarget(rule);
      const key = target ? accessoryApplicabilityTargetKey(target) : "";
      if (!target) errors.push(`${route.sourceName} has an incomplete applicable model target.`);
      if (ruleKeys.has(key)) errors.push(`${route.sourceName} has a duplicate applicable model rule.`);
      if (key) ruleKeys.add(key);
      if (target?.kind === "option_item") {
        const optionRoute = plan.routes.find((item) => item.sourceKind === "option" && item.sourceId === target.group_id);
        const optionGroup = draft.optionGroups.find((group) => group.id === target.group_id);
        if (!optionRoute || optionRoute.destination === "skip" || !optionGroup?.items.some((item) => item.id === target.row_id)) errors.push(`${route.sourceName} references an option item that does not exist in its Accessory / Configuration group.`);
      } else if (target && !modelTargets.has(key)) errors.push(`${route.sourceName} references a row not routed to Base / Model, Category / Matrix, or Modular Pricing.`);
      if (rule.fixedQuantity !== undefined && (!Number.isInteger(rule.fixedQuantity) || rule.fixedQuantity <= 0)) errors.push(`${route.sourceName} has an invalid fixed quantity.`);
      if (rule.scaleWithTargetQuantity === true && rule.fixedQuantity === undefined) errors.push(`${route.sourceName} quantity scaling requires a fixed quantity.`);
      if (rule.scaleWithTargetQuantity === true && target?.kind !== "modular" && target?.kind !== "option_item") errors.push(`${route.sourceName} quantity scaling is only supported for Modular or option item targets.`);
      if (route.accessory?.selection === "required_exactly_one" && rule.scaleWithTargetQuantity !== true && rule.fixedQuantity !== undefined && rule.fixedQuantity !== 1) errors.push(`${route.sourceName} must use fixed quantity 1 for Required / Exactly One.`);
      if (route.accessory?.selection === "required_exactly_one" && rule.scaleWithTargetQuantity === true) errors.push(`${route.sourceName} quantity scaling cannot use Required / Exactly One.`);
      if (rule.allowedItemIds?.length === 0) errors.push(`${route.sourceName} requires at least one allowed item when Specific Items is selected.`);
      if (rule.allowedItemIds?.some((id) => !itemIds.has(id))) errors.push(`${route.sourceName} has an allowed item that is not part of the reviewed group.`);
    });
  });
  return { errors, valid: errors.length === 0 };
}

export function smartSetupRoutingSummary(plan: SmartSetupReviewRoutingPlan) {
  return SMART_REVIEW_DESTINATIONS.map((destination) => ({ destination, count: plan.routes.filter((route) => route.destination === destination).length }));
}

export function smartReviewMatrixOverrides(plan: SmartSetupReviewRoutingPlan) {
  return Object.fromEntries(plan.routes.filter((route) => route.sourceKind === "matrix").map((route) => [route.sourceId, route.destination === "base_model" ? "base_model" : route.destination === "category_matrix" ? "category_matrix" : route.destination === "accessory" ? "companion" : "skip"])) as Record<string, DraftPriceMatrixRoute["kind"]>;
}

export function draftForSmartSetupReviewApply(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan): ProductTemplateDraft {
  const route = (key: string) => plan.routes.find((item) => item.key === key);
  const ordered = <T extends { id: string }>(items: T[], sourceKind: SmartReviewRoute["sourceKind"]) => plan.routes.filter((item) => item.sourceKind === sourceKind).flatMap((item) => items.find((entry) => entry.id === item.sourceId) ?? []);
  return {
    ...draft,
    pricing: {
      ...draft.pricing,
      workstationRows: route("workstation:rows")?.destination === "workstation" ? draft.pricing.workstationRows : [],
      baseModelRows: route("base_model:rows")?.destination === "base_model" ? draft.pricing.baseModelRows : [],
      priceMatrices: ordered(draft.pricing.priceMatrices, "matrix").map((matrix) => ({ ...matrix, label: route(`matrix:${matrix.id}`)?.groupName ?? matrix.label })),
      modularGroups: ordered(draft.pricing.modularGroups, "modular").filter((group) => route(`modular:${group.id}`)?.destination === "modular").map((group) => ({ ...group, label: route(`modular:${group.id}`)?.groupName ?? group.label })),
    },
    optionGroups: ordered(draft.optionGroups, "option").filter((group) => route(`option:${group.id}`)?.destination === "accessory").map((group) => ({ ...group, label: route(`option:${group.id}`)?.groupName ?? group.label })),
  };
}
