import {
  evaluateAccessoryConfigurationForModel,
  parseAccessoryConfigurationGroups,
  type AccessoryConfigurationEvaluation,
  type AccessoryApplicabilityTarget,
} from "../products/accessory-conditional-configuration";

export type ProductAccessorySelectionEvaluation = AccessoryConfigurationEvaluation & {
  activeQuantities: Record<string, number>;
  hasConditionalConfiguration: boolean;
  unknownItemIds: string[];
};

export function parseSubmittedAccessoryQuantities(values: unknown[]) {
  const quantities: Record<string, number> = {};
  const errors: string[] = [];
  values.forEach((value) => {
    if (typeof value !== "string") {
      errors.push("Accessory quantity is invalid.");
      return;
    }
    const parts = value.split(":");
    const [itemId, rawQuantity] = parts;
    const quantity = Number(rawQuantity);
    if (parts.length !== 2 || !itemId || !Number.isInteger(quantity) || quantity <= 0 || itemId in quantities) {
      errors.push("Accessory selections must use unique item IDs and positive whole-number quantities.");
      return;
    }
    quantities[itemId] = quantity;
  });
  return { errors, quantities };
}

export function evaluateProductAccessorySelection({
  accessoryGroups,
  baseModelGroupId,
  baseModelRowId,
  selectedModelTarget,
  selectedModelTargets,
  selectedModelTargetQuantities,
  selectedQuantities = {},
  allowRequiredCompanionOverrides = false,
}: {
  allowRequiredCompanionOverrides?: boolean;
  accessoryGroups: unknown;
  baseModelGroupId?: string | null;
  baseModelRowId?: string | null;
  selectedModelTarget?: AccessoryApplicabilityTarget | null;
  selectedModelTargets?: AccessoryApplicabilityTarget[];
  selectedModelTargetQuantities?: Record<string, number>;
  selectedQuantities?: Record<string, number | null | undefined>;
}): ProductAccessorySelectionEvaluation {
  const parsed = parseAccessoryConfigurationGroups(accessoryGroups);
  const itemGroupIds = new Map<string, string>();
  parsed.groups.forEach((group, groupIndex) => {
    const groupId = typeof group.id === "string" && group.id ? group.id : `accessory-group-${groupIndex}`;
    (group.items ?? []).forEach((item) => {
      if (typeof item.id === "string" && item.id) itemGroupIds.set(item.id, groupId);
    });
  });

  const selectedQuantitiesByGroupId: Record<string, Record<string, number>> = {};
  const unknownItemIds: string[] = [];
  Object.entries(selectedQuantities).forEach(([itemId, quantity]) => {
    if (!(Number(quantity) > 0)) return;
    const groupId = itemGroupIds.get(itemId);
    if (!groupId) {
      unknownItemIds.push(itemId);
      return;
    }
    selectedQuantitiesByGroupId[groupId] = {
      ...(selectedQuantitiesByGroupId[groupId] ?? {}),
      [itemId]: Number(quantity),
    };
  });

  const evaluation = evaluateAccessoryConfigurationForModel({
    accessoryGroups: parsed.groups,
    baseModelGroupId,
    baseModelRowId,
    selectedModelTarget,
    selectedModelTargets,
    selectedModelTargetQuantities,
    selectedQuantitiesByGroupId,
    allowRequiredCompanionOverrides,
  });
  const activeQuantities = Object.fromEntries(
    evaluation.groups.flatMap((group) => group.visible
      ? group.selectedItemIds.map((itemId) => [itemId, Number(selectedQuantities[itemId])] as const)
      : []),
  );
  const unknownBlocking = unknownItemIds.map((itemId) => ({
    code: "unknown_item",
    groupId: "accessory_pricing",
    message: `Selected accessory item '${itemId}' does not exist.`,
  }));

  return {
    ...evaluation,
    activeQuantities,
    blockingRequirements: [...evaluation.blockingRequirements, ...unknownBlocking],
    hasConditionalConfiguration: parsed.groups.some((group) => Boolean(group.conditional_configuration)),
    unknownItemIds,
    valid: evaluation.valid && unknownItemIds.length === 0,
  };
}
