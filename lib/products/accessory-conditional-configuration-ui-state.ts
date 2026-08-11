import type {
  AccessoryConditionalConfiguration,
  AccessoryConfigurationGroup,
  AccessoryConfigurationRole,
  AccessoryModelApplicabilityRule,
  AccessorySelectionMode,
} from "./accessory-conditional-configuration";

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
  return withConfiguration(group, (configuration) => ({ ...configuration, role }));
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
