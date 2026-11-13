import type {
  AccessoryConditionalConfiguration,
  AccessoryConfigurationGroup,
  AccessoryConfigurationRole,
  AccessoryModelApplicabilityRule,
  AccessorySelectionMode,
} from "./accessory-conditional-configuration";
import { accessoryApplicabilityTargetKey, resolveAccessoryApplicabilityTarget } from "./accessory-conditional-configuration";
import type { ApplicabilityTargetChoice } from "./applicability-target-choices";

function withConfiguration(
  group: AccessoryConfigurationGroup,
  update: (configuration: AccessoryConditionalConfiguration) => AccessoryConditionalConfiguration,
): AccessoryConfigurationGroup {
  if (!group.conditional_configuration) return group;
  return { ...group, conditional_configuration: update(group.conditional_configuration) };
}

export function setAccessoryConditionalEnabled(group: AccessoryConfigurationGroup, enabled: boolean): AccessoryConfigurationGroup {
  if (!enabled) {
    if (!group.conditional_configuration) return group;
    const legacyGroup = { ...group };
    delete legacyGroup.conditional_configuration;
    return legacyGroup;
  }
  if (group.conditional_configuration) return group;
  return {
    ...group,
    conditional_configuration: {
      role: "accessory" as const,
      selection: "unrestricted" as const,
      applicability: [],
    },
  };
}

export function setAccessoryConfigurationRole(group: AccessoryConfigurationGroup, role: AccessoryConfigurationRole): AccessoryConfigurationGroup {
  return withConfiguration(group, (configuration) => ({ ...configuration, role, ...(role === "companion" ? { applicability: configuration.applicability.map((rule) => ({ ...rule, required: true })) } : {}) }));
}

export function setAccessorySelectionMode(group: AccessoryConfigurationGroup, selection: AccessorySelectionMode): AccessoryConfigurationGroup {
  return withConfiguration(group, (configuration) => ({ ...configuration, selection }));
}

export function addAccessoryApplicabilityRule(
  group: AccessoryConfigurationGroup,
  baseModelGroupId: string,
  baseModelRowId: string,
): AccessoryConfigurationGroup {
  return withConfiguration(group, (configuration) => {
    if (configuration.applicability.some((rule) =>
      rule.base_model_group_id === baseModelGroupId && rule.base_model_row_id === baseModelRowId)) {
      return configuration;
    }
    return {
      ...configuration,
      applicability: [...configuration.applicability, {
        base_model_group_id: baseModelGroupId,
        base_model_row_id: baseModelRowId,
        required: false,
        visible: true,
      }],
    };
  });
}

export function setAccessoryApplicabilityTargets(
  group: AccessoryConfigurationGroup,
  choices: ApplicabilityTargetChoice[],
  selectedKeys: Set<string>,
): AccessoryConfigurationGroup {
  return withConfiguration(group, (configuration) => {
    const choiceByKey = new Map(choices.map((choice) => [choice.key, choice]));
    const existingKeys = new Set<string>();
    const retained = configuration.applicability.filter((rule) => {
      const target = resolveAccessoryApplicabilityTarget(rule);
      if (!target) return true;
      const key = accessoryApplicabilityTargetKey(target);
      if (!choiceByKey.has(key)) return true;
      if (!selectedKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    const additions: AccessoryModelApplicabilityRule[] = choices.flatMap<AccessoryModelApplicabilityRule>((choice) => {
      if (!selectedKeys.has(choice.key) || existingKeys.has(choice.key)) return [];
      const required = configuration.role === "companion";
      return choice.kind === "base_model"
        ? [{ base_model_group_id: choice.groupId, base_model_row_id: choice.rowId, required, visible: true }]
        : [{ target: { kind: choice.kind, group_id: choice.groupId, row_id: choice.rowId }, required, visible: true }];
    });
    return { ...configuration, applicability: [...retained, ...additions] };
  });
}

export function updateAccessoryApplicabilityRule(
  group: AccessoryConfigurationGroup,
  ruleIndex: number,
  patch: Partial<AccessoryModelApplicabilityRule>,
): AccessoryConfigurationGroup {
  return withConfiguration(group, (configuration) => ({
    ...configuration,
    applicability: configuration.applicability.map((rule, index) => index === ruleIndex ? { ...rule, ...patch } : rule),
  }));
}

export function removeAccessoryApplicabilityRule(group: AccessoryConfigurationGroup, ruleIndex: number): AccessoryConfigurationGroup {
  return withConfiguration(group, (configuration) => ({
    ...configuration,
    applicability: configuration.applicability.filter((_, index) => index !== ruleIndex),
  }));
}

export function setAccessoryRuleAllowedItems(
  group: AccessoryConfigurationGroup,
  ruleIndex: number,
  itemIds: string[] | null,
): AccessoryConfigurationGroup {
  return withConfiguration(group, (configuration) => ({
    ...configuration,
    applicability: configuration.applicability.map((rule, index) => {
      if (index !== ruleIndex) return rule;
      const unrestrictedRule = { ...rule };
      delete unrestrictedRule.allowed_item_ids;
      return itemIds === null ? unrestrictedRule : { ...unrestrictedRule, allowed_item_ids: [...new Set(itemIds)] };
    }),
  }));
}

export function staleAccessoryRuleItemIds(group: AccessoryConfigurationGroup) {
  const itemIds = new Set((group.items ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)));
  return [...new Set((group.conditional_configuration?.applicability ?? [])
    .flatMap((rule) => rule.allowed_item_ids ?? [])
    .filter((id) => !itemIds.has(id)))];
}

/**
 * Allowed-item lists of applicability rules. A rule WITH a list shows only those items on the product page; a rule without one allows every
 * item of the group. These helpers keep a list in step with the group's items and never create a list: a rule without one stays without.
 * An empty list is left alone (it is an error the review already reports, not an "all items" rule).
 */
export const allowedListWithItem = (list: string[] | undefined, itemId: string): string[] | undefined => list?.length && !list.includes(itemId) ? [...list, itemId] : list;
export const allowedListWithoutItem = (list: string[] | undefined, itemId: string): string[] | undefined => list?.includes(itemId) ? list.filter((id) => id !== itemId) : list;
type RuleWithList = { allowed_item_ids?: string[] };
const mapLists = <R extends RuleWithList>(rules: R[], change: (list: string[] | undefined) => string[] | undefined): R[] => rules.map((rule) => {
  const next = change(rule.allowed_item_ids);
  return next === rule.allowed_item_ids ? rule : { ...rule, allowed_item_ids: next };
});
export const addItemToRuleLists = <R extends RuleWithList>(rules: R[], itemId: string): R[] => mapLists(rules, (list) => allowedListWithItem(list, itemId));
export const removeItemFromRuleLists = <R extends RuleWithList>(rules: R[], itemId: string): R[] => mapLists(rules, (list) => allowedListWithoutItem(list, itemId));
/** Post-save editor: a hand-added item joins every explicit list of its group. */
export function addAccessoryItemToRuleLists(group: AccessoryConfigurationGroup, itemId: string): AccessoryConfigurationGroup {
  return withConfiguration(group, (configuration) => ({ ...configuration, applicability: addItemToRuleLists(configuration.applicability, itemId) }));
}
/** Post-save editor: a removed item leaves every explicit list of its group. */
export function removeAccessoryItemFromRuleLists(group: AccessoryConfigurationGroup, itemId: string): AccessoryConfigurationGroup {
  return withConfiguration(group, (configuration) => ({ ...configuration, applicability: removeItemFromRuleLists(configuration.applicability, itemId) }));
}
/**
 * Apply safety net: when a group has explicit lists, an item that is in NO list at all would be hidden on every model. Such an item is added to
 * every list. Items that are in at least one list, and groups without any list, are never touched.
 */
export function allowUnlistedItems<R extends RuleWithList>(rules: R[], itemIds: string[]): R[] {
  const lists = rules.map((rule) => rule.allowed_item_ids).filter((list): list is string[] => Boolean(list?.length));
  if (!lists.length) return rules;
  const listed = new Set(lists.flat());
  const hidden = itemIds.filter((id) => !listed.has(id));
  return hidden.length ? hidden.reduce((current, id) => addItemToRuleLists(current, id), rules) : rules;
}
