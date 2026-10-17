import type { AccessoryItemRole } from "./accessory-conditional-configuration";
import type { ProductTemplateDraft } from "./product-template-draft";
import { smartReviewRuleTarget, smartReviewSelectionContract, type SmartReviewAccessoryConfiguration, type SmartReviewRoute, type SmartReviewRule } from "./smart-product-review-routing";

export type SmartOptionRelationshipType = "structural_support" | "required_companion" | "optional_accessory";
export const SMART_OPTION_RELATIONSHIP_LABELS: Record<SmartOptionRelationshipType, string> = { structural_support: "Structural Support", required_companion: "Required Companion", optional_accessory: "Optional Accessory" };
export const SMART_OPTION_SECTION_LABELS: Record<SmartOptionRelationshipType, string> = { structural_support: "Structural Base / Support", required_companion: "Required Companions", optional_accessory: "Optional Accessories" };
const SECTION_ORDER: SmartOptionRelationshipType[] = ["structural_support", "required_companion", "optional_accessory"];

type OptionGroup = ProductTemplateDraft["optionGroups"][number];

/** Review-only classification over existing optionGroups data; it never changes the pricing route. */
export function optionGroupRelationshipType(group: { items: Array<{ role?: AccessoryItemRole }>; conditionalConfiguration?: OptionGroup["conditionalConfiguration"] } | undefined, route?: Pick<SmartReviewRoute, "accessory">): SmartOptionRelationshipType {
  if (group?.items.some((item) => item.role === "structural_support")) return "structural_support";
  if (route?.accessory?.role === "companion" || group?.conditionalConfiguration?.role === "companion" || group?.items.some((item) => item.role === "companion")) return "required_companion";
  return "optional_accessory";
}

export function optionItemRelationshipType(item: { role?: AccessoryItemRole }, groupType: SmartOptionRelationshipType): SmartOptionRelationshipType {
  if (item.role === "structural_support") return "structural_support";
  if (item.role === "companion" || groupType === "required_companion") return "required_companion";
  return "optional_accessory";
}

/** Role edit touches only `role`; "normal" restores the legacy role-less shape. */
export function optionItemRolePatch(role: "normal" | "companion" | "structural_support"): { role: AccessoryItemRole | undefined } {
  return { role: role === "normal" ? undefined : role };
}

/** Presentation order only: option routes are re-sequenced among the slots option routes already occupy; every other route keeps its position. */
export function orderSmartOptionRoutes<T extends SmartReviewRoute>(routes: T[], draft: ProductTemplateDraft): T[] {
  const typeOf = (route: T) => optionGroupRelationshipType(draft.optionGroups.find((group) => group.id === route.sourceId), route);
  const options = routes.filter((route) => route.sourceKind === "option");
  const sorted = [...options].sort((a, b) => SECTION_ORDER.indexOf(typeOf(a)) - SECTION_ORDER.indexOf(typeOf(b)));
  let next = 0;
  return routes.map((route) => route.sourceKind === "option" ? sorted[next++] : route);
}

export type SmartOptionRelationshipRow = { triggeredBy: string; resolved: boolean; required: boolean; fixedQuantity: number | null; scaled: boolean; targetKind: "Option item" };

/** Readable summary of option_item applicability rules; labels are resolved from the reviewed draft, never raw ids. */
export function describeOptionItemRelationships(draft: ProductTemplateDraft, rules: SmartReviewRule[]): SmartOptionRelationshipRow[] {
  return rules.flatMap((rule) => {
    const target = rule.target;
    if (target?.kind !== "option_item") return [];
    const group = draft.optionGroups.find((item) => item.id === target.group_id);
    const item = group?.items.find((entry) => entry.id === target.row_id);
    const triggeredBy = group && item ? `${group.label ?? group.id} › ${item.displayName ?? item.label ?? item.id}` : "Unresolved target (item no longer exists)";
    return [{ triggeredBy, resolved: Boolean(group && item), required: rule.required, fixedQuantity: rule.fixedQuantity ?? null, scaled: rule.scaleWithTargetQuantity === true, targetKind: "Option item" as const }];
  });
}

const applicableRuleKey = (rule: SmartReviewRule) => { const target = smartReviewRuleTarget(rule); return target ? `${target.kind}\u0000${target.group_id}\u0000${target.row_id}` : ""; };

/**
 * The picker only owns targets present in its choices. Other rules, including
 * unresolved targets, must survive so their validation blockers remain visible.
 */
export function rebuildApplicableModelRules(accessory: SmartReviewAccessoryConfiguration, choices: Array<{ key: string; target: { kind: "base_model" | "price_matrix" | "modular"; group_id: string; row_id: string } }>, pendingKeys: Set<string>): SmartReviewRule[] {
  const choiceKeys = new Set(choices.map((choice) => choice.key));
  const retained = accessory.rules.filter((rule) => !choiceKeys.has(applicableRuleKey(rule)) || pendingKeys.has(applicableRuleKey(rule)));
  const currentKeys = new Set(accessory.rules.map(applicableRuleKey));
  const required = smartReviewSelectionContract(accessory.selection).required;
  const fixed = accessory.selection === "required_exactly_one" ? { fixedQuantity: 1 } : {};
  const additions = choices.flatMap((choice) => pendingKeys.has(choice.key) && !currentKeys.has(choice.key)
    ? [choice.target.kind === "base_model" ? { baseModelGroupId: choice.target.group_id, baseModelRowId: choice.target.row_id, required, ...fixed } : { target: choice.target, required, ...fixed }]
    : []);
  const rules = [...retained, ...additions];
  if (accessory.role !== "accessory" && !rules.length) {
    throw new Error("All Models is not supported for companions or conditional options without explicit applicability rules. Keep at least one target, or use the existing configuration controls to change the role explicitly.");
  }
  return rules;
}
