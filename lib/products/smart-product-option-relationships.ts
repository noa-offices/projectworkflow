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
 * Applicable Models picker commit. The picker only owns pricing-row targets (its `choices`); option_item rules
 * have their own Relationship / Details presentation and are carried over untouched, even when nothing is selected.
 */
export function rebuildApplicableModelRules(accessory: SmartReviewAccessoryConfiguration, choices: Array<{ key: string; target: { kind: "base_model" | "price_matrix" | "modular"; group_id: string; row_id: string } }>, pendingKeys: Set<string>): SmartReviewRule[] {
  const preserved = accessory.rules.filter((rule) => smartReviewRuleTarget(rule)?.kind === "option_item");
  const currentByKey = new Map(accessory.rules.map((rule) => [applicableRuleKey(rule), rule]));
  const required = smartReviewSelectionContract(accessory.selection).required;
  const fixed = accessory.selection === "required_exactly_one" ? { fixedQuantity: 1 } : {};
  const selected = choices.flatMap((choice) => pendingKeys.has(choice.key)
    ? [currentByKey.get(choice.key) ?? (choice.target.kind === "base_model" ? { baseModelGroupId: choice.target.group_id, baseModelRowId: choice.target.row_id, required, ...fixed } : { target: choice.target, required, ...fixed })]
    : []);
  return [...preserved, ...selected];
}
