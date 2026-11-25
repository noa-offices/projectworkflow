// "Also update this group's rules and label" for an Add More JSON option group merged into an existing one.
// The existing group id and item ids are kept (pictures and links are keyed by them). Items, prices, pricing rows,
// matrices and images are not touched here: the ordinary merge has already decided the items.
import { parseAccessoryConfigurationGroups, type AccessoryConditionalConfiguration, type AccessoryModelApplicabilityRule } from "./accessory-conditional-configuration";
import { accessoryPricingReferenceIssues } from "./accessory-pricing-parser";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter";
import type { ProductTemplateDraft, ProductTemplateDraftOptionGroup } from "./product-template-draft";
import { validateSmartSetupReviewRouting, type SmartReviewRoute, type SmartReviewRule, type SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";

export type SmartRulesUpdatePreview = { before: number; after: number; added: number; unnamedExisting: number };

/**
 * Applies the incoming label, selection rule and conditional rules to the (already item-merged) existing group and its
 * review route; Save reads the route, so both change together. Mutates only the cloned workspace it is given.
 */
export function applySmartGroupRulesUpdate({ group, route, incoming, incomingRoute, finalIds }: {
  group: ProductTemplateDraftOptionGroup;
  route: SmartReviewRoute;
  incoming: ProductTemplateDraftOptionGroup;
  incomingRoute: SmartReviewRoute;
  /** incoming item id -> the id that item has in the merged group */
  finalIds: Readonly<Record<string, string>>;
}): { errors: string[] } {
  const name = incoming.label ?? incoming.id;
  const configuration = incoming.conditionalConfiguration;
  if (!configuration?.applicability.length || !incomingRoute.accessory) return { errors: [`"${name}" has no rules in the incoming JSON, so updating would remove the current rules. Untick the rules update for this group.`] };
  if (route.destination !== "accessory") return { errors: [`"${route.groupName}" is not routed to Accessories, so its rules cannot be updated.`] };
  const mergedIds = Object.values(finalIds);
  if (new Set(mergedIds).size !== mergedIds.length) return { errors: [`Two incoming items in "${name}" match the same item. Give them different supplier or reference codes, or untick the rules update.`] };

  // An incoming item matched under another id keeps the existing id, so every reference to it follows.
  const itemId = (id: string) => finalIds[id] ?? id;
  const ownTarget = <T extends { kind: string; group_id: string; row_id: string }>(target: T): T =>
    target.kind === "option_item" && target.group_id === incoming.id ? { ...target, group_id: group.id, row_id: itemId(target.row_id) } : target;
  const configurationRule = (rule: AccessoryModelApplicabilityRule): AccessoryModelApplicabilityRule => ({
    ...rule,
    ...(rule.target ? { target: ownTarget(rule.target) } : {}),
    ...(rule.allowed_item_ids ? { allowed_item_ids: rule.allowed_item_ids.map(itemId) } : {}),
  });
  const reviewRule = (rule: SmartReviewRule): SmartReviewRule => ({
    ...rule,
    ...(rule.target ? { target: ownTarget(rule.target) } : {}),
    ...(rule.allowedItemIds ? { allowedItemIds: rule.allowedItemIds.map(itemId) } : {}),
  });

  const label = incoming.label ?? group.label;
  group.label = label;
  group.selection = { ...incoming.selection, defaultItemIds: [...new Set(incoming.selection.defaultItemIds.map(itemId))] };
  group.conditionalConfiguration = { ...configuration, applicability: configuration.applicability.map(configurationRule) } satisfies AccessoryConditionalConfiguration;
  route.groupName = incomingRoute.groupName;
  route.sourceName = incomingRoute.sourceName;
  route.accessory = { ...incomingRoute.accessory, rules: incomingRoute.accessory.rules.map(reviewRule) };
  return { errors: [] };
}

/** Items of the merged group that no rule lists. Save offers such an item on every target that has an item list. */
export function smartUnnamedItemCount(group: ProductTemplateDraftOptionGroup) {
  const lists = (group.conditionalConfiguration?.applicability ?? []).flatMap((rule) => rule.allowed_item_ids ? [rule.allowed_item_ids] : []);
  if (!lists.length) return 0;
  const named = new Set(lists.flat());
  return group.items.filter((item) => !named.has(item.id)).length;
}

/** New item ids of an updated group must not already belong to another accessory group. */
export function smartReusedItemIdErrors(draft: ProductTemplateDraft, group: ProductTemplateDraftOptionGroup, addedIds: readonly string[]) {
  const ids = group.items.map((item) => item.id);
  const elsewhere = new Set(draft.optionGroups.filter((other) => other !== group).flatMap((other) => other.items.map((item) => item.id)));
  return [
    ...(new Set(ids).size !== ids.length ? [`"${group.label ?? group.id}" would contain the same item id twice.`] : []),
    ...addedIds.filter((id) => elsewhere.has(id)).map((id) => `Item id "${id}" is already used by another accessory group.`),
  ];
}

type Workspace = { draft: ProductTemplateDraft; plan: SmartSetupReviewRoutingPlan };

function existingValidatorMessages({ draft, plan }: Workspace) {
  const groups = mapDraftOptionGroupsToAccessories(draft, plan).groups;
  return [
    ...validateSmartSetupReviewRouting(draft, plan).errors,
    ...accessoryPricingReferenceIssues(groups).map((issue) => issue.message),
    ...parseAccessoryConfigurationGroups(groups).issues.map((issue) => issue.message),
  ];
}

/** What the existing validators report only because of the rules update; problems the plain merge already has stay as they were. */
export function smartRulesUpdateValidationErrors(updated: Workspace, plainMerge: Workspace) {
  const known = existingValidatorMessages(plainMerge);
  return [...new Set(existingValidatorMessages(updated).filter((message) => {
    const index = known.indexOf(message);
    if (index < 0) return true;
    known.splice(index, 1);
    return false;
  }))];
}
