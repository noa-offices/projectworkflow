import type { ProductTemplateDraft } from "./product-template-draft";
import type { SmartReviewAccessoryConfiguration, SmartReviewRoute, SmartReviewRule, SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";

type Draft = ProductTemplateDraft;
export function modelApplicabilityRules(rules: SmartReviewRule[]): SmartReviewRule[] {
  return rules.filter((rule) => rule.target?.kind !== "option_item");
}

export type ConnectedOptionSettings = { required: boolean; quantity: number; scaled: boolean };
export type ConnectedOptionChoice = {
  key: string; groupName: string; label: string; code: string; disabledReason: string | null;
  target: { kind: "option_item"; group_id: string; row_id: string };
};

export function connectedOptionKey(rule: SmartReviewRule): string {
  const target = rule.target;
  return target?.kind === "option_item" ? `${target.kind}\u0000${target.group_id}\u0000${target.row_id}` : "";
}

/** Read the review plan, including unsaved edits, rather than stale draft rules. */
function optionDependencies(draft: Draft, plan: SmartSetupReviewRoutingPlan, groupId: string): string[] {
  const route = plan.routes.find((entry) => entry.sourceKind === "option" && entry.sourceId === groupId);
  if (route?.destination !== "accessory") return [];
  return (route.accessory?.rules ?? draft.optionGroups.find((group) => group.id === groupId)?.conditionalConfiguration?.applicability ?? [])
    .flatMap((rule) => rule.target?.kind === "option_item" ? [rule.target.group_id] : []);
}

export function optionConnectionWouldLoop(draft: Draft, plan: SmartSetupReviewRoutingPlan, editedGroupId: string, targetGroupId: string): boolean {
  const visited = new Set<string>();
  const pending = [targetGroupId];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === editedGroupId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...optionDependencies(draft, plan, id));
  }
  return false;
}

/** Disabled choices explain exclusions; rebuild never adds a disabled choice. */
export function connectedOptionChoices(draft: Draft, plan: SmartSetupReviewRoutingPlan, editedGroupId: string): ConnectedOptionChoice[] {
  return draft.optionGroups.flatMap((group) => {
    const route = plan.routes.find((entry) => entry.sourceKind === "option" && entry.sourceId === group.id);
    const groupReason = group.id === editedGroupId ? "A group cannot connect to itself."
      : route?.destination !== "accessory" ? "This group must be routed to Options / Accessories."
        : optionConnectionWouldLoop(draft, plan, editedGroupId, group.id) ? "This group already depends on this item. Connecting it would create a loop." : null;
    return group.items.map((item) => {
      const target = { kind: "option_item" as const, group_id: group.id, row_id: item.id };
      return {
        key: connectedOptionKey({ target, required: false }), target,
        groupName: route?.groupName ?? group.label ?? group.id,
        label: item.displayName ?? item.label ?? item.id, code: item.supplierCodes[0] ?? "",
        disabledReason: item.role === "structural_support" ? "Structural support items use an older path." : groupReason,
      };
    });
  });
}

export function connectedOptionSettings(accessory: SmartReviewAccessoryConfiguration): ConnectedOptionSettings & { mixed: boolean } {
  const rules = accessory.rules.filter((rule) => rule.target?.kind === "option_item");
  const first = rules[0];
  const settings = { required: first?.required ?? accessory.role === "companion", quantity: first?.fixedQuantity ?? 1, scaled: first ? first.scaleWithTargetQuantity === true : true };
  const mixed = rules.some((rule) => rule.required !== settings.required || (rule.fixedQuantity ?? 1) !== settings.quantity || (rule.scaleWithTargetQuantity === true) !== settings.scaled || rule.visible === false);
  return { ...settings, mixed };
}

/** Picker owns only eligible choices. Unresolved/legacy rules remain until explicitly removed. */
export function rebuildConnectedOptionRules(accessory: SmartReviewAccessoryConfiguration, choices: ConnectedOptionChoice[], pending: Set<string>): SmartReviewRule[] {
  const eligible = choices.filter((choice) => !choice.disabledReason);
  const keys = new Set(eligible.map((choice) => choice.key));
  const existing = new Set(accessory.rules.map(connectedOptionKey));
  const settings = connectedOptionSettings(accessory);
  const kept = accessory.rules.filter((rule) => !keys.has(connectedOptionKey(rule)) || pending.has(connectedOptionKey(rule)));
  return [...kept, ...eligible.flatMap((choice) => pending.has(choice.key) && !existing.has(choice.key) ? [{
    target: choice.target, visible: true, required: settings.required,
    fixedQuantity: settings.quantity, scaleWithTargetQuantity: settings.required && settings.scaled,
  }] : [])];
}

/** Only an explicit owner edit normalises settings. Selection is never changed here. */
export function setConnectedOptionSettings(accessory: SmartReviewAccessoryConfiguration, settings: ConnectedOptionSettings): SmartReviewAccessoryConfiguration {
  return {
    ...accessory, role: settings.required ? "companion" : "conditional_option",
    rules: accessory.rules.map((rule) => rule.target?.kind === "option_item" ? {
      ...rule, visible: true, required: settings.required,
      fixedQuantity: settings.quantity, scaleWithTargetQuantity: settings.required && settings.scaled,
    } : rule),
  };
}

export const CONNECTED_SCALING_CONFLICT = "Exactly One cannot follow the number of selected options. Choose 'in total', or change the group to At least one.";
export const CONNECTED_TOTAL_CONFLICT = "Exactly One needs a total quantity of 1. Enter 1, or change the group to At least one.";

export function connectedOptionQuantityIssue(selection: SmartReviewAccessoryConfiguration["selection"], rules: SmartReviewRule[]): string | null {
  const connected = rules.filter((rule) => rule.target?.kind === "option_item");
  if (connected.some((rule) => rule.fixedQuantity !== undefined && (!Number.isInteger(rule.fixedQuantity) || rule.fixedQuantity <= 0))) return "Enter a positive whole number for the quantity.";
  if (selection !== "required_exactly_one" && selection !== "optional_exactly_one") return null;
  if (connected.some((rule) => rule.scaleWithTargetQuantity === true)) return CONNECTED_SCALING_CONFLICT;
  if (connected.some((rule) => rule.fixedQuantity !== undefined && rule.fixedQuantity !== 1)) return CONNECTED_TOTAL_CONFLICT;
  return null;
}

export function connectedOptionIssues(draft: Draft, plan: SmartSetupReviewRoutingPlan, route: SmartReviewRoute): string[] {
  const messages = route.accessory?.rules.flatMap((rule) => {
    const target = rule.target;
    if (target?.kind !== "option_item") return [];
    const group = draft.optionGroups.find((entry) => entry.id === target.group_id);
    const item = group?.items.find((entry) => entry.id === target.row_id);
    if (!item) return [`Connected option in ${group?.label ?? "a missing group"} no longer exists. Remove the connection or restore the item.`];
    const targetRoute = plan.routes.find((entry) => entry.sourceKind === "option" && entry.sourceId === target.group_id);
    if (targetRoute?.destination !== "accessory") return [`${group?.label ?? target.group_id} must be routed to Options / Accessories. Restore it or remove the connection.`];
    return [];
  }) ?? [];
  const quantity = route.accessory ? connectedOptionQuantityIssue(route.accessory.selection, route.accessory.rules) : null;
  return [...new Set([...messages, ...(quantity ? [quantity] : [])])];
}

/** Existing no-connection wording is kept verbatim. Counts never treat option items as models. */
export function optionApplicabilityText(draft: Draft, accessory: SmartReviewAccessoryConfiguration, totalModels: number) {
  const connected = accessory.rules.filter((rule) => rule.target?.kind === "option_item");
  const models = accessory.rules.length - connected.length;
  const modelItems = `${models} applicable model${models === 1 ? "" : "s"}`;
  if (!connected.length) return {
    availability: !models && accessory.role === "accessory" ? "available for all models" : `${models} of ${totalModels} models selected`,
    items: modelItems, modelNote: null,
  };
  const groups = [...new Set(connected.map((rule) => rule.target!.group_id))].map((id) => {
    const label = draft.optionGroups.find((group) => group.id === id)?.label ?? "Missing group";
    const count = connected.filter((rule) => rule.target!.group_id === id).length;
    return `${label} (${count} options)`;
  });
  return {
    availability: models ? `${models} models · ${connected.length} connected options` : `Needs: ${groups.join(", ")}`,
    items: `${models ? `${modelItems} · ` : ""}Connected to ${connected.length} options`,
    modelNote: models ? null : "Not limited by model. This item follows the connected options below.",
  };
}
